import { Result } from "better-result";
import type { InternalError } from "@xmtp/signet-schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

/** Check ID for release signing verification. */
export const RELEASE_SIGNING_CHECK_ID = "release_signing" as const;

/** Timeout for GitHub API calls (ms). */
const GITHUB_FETCH_TIMEOUT_MS = 10_000;

/**
 * Extract GitHub owner/repo from a source repository URL.
 * Supports https://github.com/owner/repo and https://github.com/owner/repo.git
 */
function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const parts = parsed.pathname
      .replace(/^\//, "")
      .replace(/\.git$/, "")
      .split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

/** Check if a filename looks like a signing artifact for a specific digest. */
/** Check if a filename is a signing artifact that references the requested digest. */
function isSigningAssetForDigest(name: string, digest: string): boolean {
  const lower = name.toLowerCase();
  const shortDigest = digest.slice(0, 12).toLowerCase();
  // Must be a recognized signing file type
  const isSigningFile =
    lower.endsWith(".sig") ||
    lower.endsWith(".sigstore") ||
    lower.endsWith(".sigstore.json") ||
    lower.endsWith(".intoto.jsonl");
  // Must also contain the artifact digest — generic attestation filenames
  // that don't reference the digest are not proof for this specific artifact
  return isSigningFile && lower.includes(shortDigest);
}

/**
 * Verifies the release artifact is signed by checking for a GitHub
 * release matching the tag and inspecting its attestation artifacts.
 *
 * Checks:
 * - A GitHub release exists for the given tag
 * - The release is not draft
 * - The release has signing artifacts tied to the requested artifact digest
 * - Returns fail (not skip) when a release exists but has no signing artifacts
 */
export function createReleaseSigningCheck(): CheckHandler {
  return {
    checkId: RELEASE_SIGNING_CHECK_ID,

    async execute(
      request: VerificationRequest,
    ): Promise<Result<VerificationCheck, InternalError>> {
      if (request.releaseTag === null) {
        return Result.ok({
          checkId: RELEASE_SIGNING_CHECK_ID,
          verdict: "skip",
          reason: "No release tag provided",
          evidence: null,
        });
      }

      const ghRepo = parseGitHubRepo(request.sourceRepoUrl);
      if (ghRepo === null) {
        return Result.ok({
          checkId: RELEASE_SIGNING_CHECK_ID,
          verdict: "skip",
          reason:
            "Source repository is not a GitHub URL — release signing check requires GitHub",
          evidence: { sourceRepoUrl: request.sourceRepoUrl },
        });
      }

      // Fetch the release from GitHub API with timeout
      const releaseUrl = `https://api.github.com/repos/${ghRepo.owner}/${ghRepo.repo}/releases/tags/${encodeURIComponent(request.releaseTag)}`;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        GITHUB_FETCH_TIMEOUT_MS,
      );

      let releaseData: Record<string, unknown>;
      try {
        const response = await fetch(releaseUrl, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "xmtp-signet-verifier/1.0",
          },
          signal: controller.signal,
        });

        if (response.status === 404) {
          clearTimeout(timeout);
          return Result.ok({
            checkId: RELEASE_SIGNING_CHECK_ID,
            verdict: "fail",
            reason: `No GitHub release found for tag ${request.releaseTag}`,
            evidence: {
              releaseTag: request.releaseTag,
              repo: `${ghRepo.owner}/${ghRepo.repo}`,
            },
          });
        }

        if (!response.ok) {
          clearTimeout(timeout);
          return Result.ok({
            checkId: RELEASE_SIGNING_CHECK_ID,
            verdict: "skip",
            reason: `GitHub API returned ${response.status}`,
            evidence: {
              releaseTag: request.releaseTag,
              statusCode: response.status,
            },
          });
        }

        // Keep timeout active through body consumption — fetch resolves
        // on headers, but response.json() can stall on body streaming
        releaseData = (await response.json()) as Record<string, unknown>;
        clearTimeout(timeout);
      } catch {
        clearTimeout(timeout);
        return Result.ok({
          checkId: RELEASE_SIGNING_CHECK_ID,
          verdict: "skip",
          reason:
            "Failed to fetch release from GitHub API (timeout or network error)",
          evidence: { releaseTag: request.releaseTag },
        });
      }

      const isDraft = releaseData["draft"] === true;
      const isPrerelease = releaseData["prerelease"] === true;
      const assets = Array.isArray(releaseData["assets"])
        ? (releaseData["assets"] as Array<Record<string, unknown>>)
        : [];
      const tagName = String(releaseData["tag_name"] ?? "");

      if (isDraft) {
        return Result.ok({
          checkId: RELEASE_SIGNING_CHECK_ID,
          verdict: "fail",
          reason: "Release is still in draft — not published",
          evidence: {
            releaseTag: tagName,
            draft: true,
          },
        });
      }

      // Check for signing artifacts tied to the requested artifact digest
      const signingAssets = assets.filter((a) =>
        isSigningAssetForDigest(
          String(a["name"] ?? ""),
          request.artifactDigest,
        ),
      );

      if (signingAssets.length === 0) {
        // Release exists but has no signing artifacts — this is a fail,
        // not a skip. The release was published without signatures.
        return Result.ok({
          checkId: RELEASE_SIGNING_CHECK_ID,
          verdict: "fail",
          reason: `Release ${tagName} found but no signing artifacts for digest ${request.artifactDigest.slice(0, 12)}...`,
          evidence: {
            releaseTag: tagName,
            prerelease: isPrerelease,
            totalAssets: assets.length,
            allAssetNames: assets.map((a) => String(a["name"] ?? "")),
            artifactDigest: request.artifactDigest,
          },
        });
      }

      return Result.ok({
        checkId: RELEASE_SIGNING_CHECK_ID,
        verdict: "pass",
        reason: `Release ${tagName} found with ${signingAssets.length} signing artifact(s) for the requested digest`,
        evidence: {
          releaseTag: tagName,
          prerelease: isPrerelease,
          totalAssets: assets.length,
          signingAssets: signingAssets.map((a) => String(a["name"] ?? "")),
          artifactDigest: request.artifactDigest,
          htmlUrl: releaseData["html_url"] ?? null,
        },
      });
    },
  };
}
