import { describe, expect, test } from "bun:test";
import { createVerifierService } from "../service.js";
import { canonicalize } from "../canonicalize.js";
import {
  createTestVerificationRequest,
  createTestConfig,
  createTestFetcher,
  mockSign,
} from "./fixtures.js";
import { createSourceAvailableCheck } from "../checks/source-available.js";
import { createBuildProvenanceCheck } from "../checks/build-provenance.js";
import { createReleaseSigningCheck } from "../checks/release-signing.js";
import { createSealSignatureCheck } from "../checks/seal-signature.js";
import { createSealChainCheck } from "../checks/seal-chain.js";
import { createSchemaComplianceCheck } from "../checks/schema-compliance.js";

function createTestService(overrides?: {
  config?: Partial<ReturnType<typeof createTestConfig>>;
  now?: () => number;
}) {
  const config = createTestConfig(overrides?.config);
  const now =
    overrides?.now ?? (() => new Date("2025-01-15T00:00:00.000Z").getTime());

  return createVerifierService({
    config,
    sign: mockSign,
    generateId: (() => {
      let counter = 0;
      return () => {
        counter++;
        return `stmt-${String(counter).padStart(3, "0")}`;
      };
    })(),
    now,
    checks: [
      createSourceAvailableCheck({
        fetcher: createTestFetcher({
          "https://github.com/xmtp/xmtp-signet": { status: 200 },
        }),
      }),
      createBuildProvenanceCheck(),
      createReleaseSigningCheck(),
      createSealSignatureCheck(),
      createSealChainCheck(),
      createSchemaComplianceCheck(),
    ],
  });
}

describe("VerifierService", () => {
  describe("handleRequest", () => {
    test("returns a verified statement when all checks pass", async () => {
      const service = createTestService();
      const request = createTestVerificationRequest();
      const result = await service.handleRequest(request, "sender-inbox-001");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // source_available passes, build_provenance skips (null),
        // release_signing skips (null), seal_* pass, schema passes
        // Some skip -> partial
        expect(result.value.verdict).toBe("partial");
        expect(result.value.verifiedTier).toBe("unverified");
        expect(result.value.requestId).toBe("req-001");
        expect(result.value.signatureAlgorithm).toBe("Ed25519");
      }
    });

    test("echoes challengeNonce from the request", async () => {
      const service = createTestService();
      const nonce = "cafebabe".repeat(8);
      const request = createTestVerificationRequest({
        challengeNonce: nonce,
      });
      const result = await service.handleRequest(request, "sender-inbox-001");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.challengeNonce).toBe(nonce);
      }
    });

    test("returns rejected when source is unavailable", async () => {
      const config = createTestConfig();
      const service = createVerifierService({
        config,
        sign: mockSign,
        generateId: () => "stmt-001",
        now: () => new Date("2025-01-15T00:00:00.000Z").getTime(),
        checks: [
          createSourceAvailableCheck({
            fetcher: createTestFetcher({
              "https://github.com/xmtp/xmtp-signet": { status: 404 },
            }),
          }),
          createBuildProvenanceCheck(),
          createReleaseSigningCheck(),
          createSealSignatureCheck(),
          createSealChainCheck(),
          createSchemaComplianceCheck(),
        ],
      });

      const result = await service.handleRequest(
        createTestVerificationRequest(),
        "sender-inbox-001",
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.verdict).toBe("rejected");
        expect(result.value.verifiedTier).toBe("unverified");
        const sourceCheck = result.value.checks.find(
          (c) => c.checkId === "source_available",
        );
        expect(sourceCheck?.verdict).toBe("fail");
      }
    });

    test("returns partial when only source passes and others skip", async () => {
      const service = createTestService();
      const request = createTestVerificationRequest({
        seal: null,
        buildProvenanceBundle: null,
        releaseTag: null,
      });

      const result = await service.handleRequest(request, "sender-inbox-001");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.verdict).toBe("partial");
      }
    });

    test("includes all check results in statement", async () => {
      const service = createTestService();
      const result = await service.handleRequest(
        createTestVerificationRequest(),
        "sender-inbox-001",
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.checks.length).toBe(6);
        const checkIds = result.value.checks.map((c) => c.checkId);
        expect(checkIds).toContain("source_available");
        expect(checkIds).toContain("build_provenance");
        expect(checkIds).toContain("release_signing");
        expect(checkIds).toContain("seal_signature");
        expect(checkIds).toContain("seal_chain");
        expect(checkIds).toContain("schema_compliance");
      }
    });

    test("signs the statement", async () => {
      const service = createTestService();
      const result = await service.handleRequest(
        createTestVerificationRequest(),
        "sender-inbox-001",
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.signature).toBe("bW9jay1zaWduYXR1cmU=");
        expect(result.value.signatureAlgorithm).toBe("Ed25519");
      }
    });

    test("sets issuedAt and expiresAt from config", async () => {
      const baseTime = new Date("2025-01-15T00:00:00.000Z").getTime();
      const service = createTestService({ now: () => baseTime });
      const result = await service.handleRequest(
        createTestVerificationRequest(),
        "sender-inbox-001",
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.issuedAt).toBe("2025-01-15T00:00:00.000Z");
        // Default TTL is 86400 seconds = 24 hours
        expect(result.value.expiresAt).toBe("2025-01-16T00:00:00.000Z");
      }
    });
  });

  describe("rate limiting", () => {
    test("rejects requests over the rate limit", async () => {
      const config = createTestConfig({
        maxRequestsPerRequesterPerHour: 2,
      });
      const service = createVerifierService({
        config,
        sign: mockSign,
        generateId: (() => {
          let c = 0;
          return () => {
            c++;
            return `stmt-${String(c)}`;
          };
        })(),
        now: () => new Date("2025-01-15T00:00:00.000Z").getTime(),
        checks: [
          createSourceAvailableCheck({
            fetcher: createTestFetcher({
              "https://github.com/xmtp/xmtp-signet": { status: 200 },
            }),
          }),
        ],
      });

      const request = createTestVerificationRequest();
      const sender = "sender-inbox-001";

      // First two should succeed
      const r1 = await service.handleRequest(request, sender);
      expect(r1.isOk()).toBe(true);
      const r2 = await service.handleRequest(request, sender);
      expect(r2.isOk()).toBe(true);

      // Third should be rate-limited
      const r3 = await service.handleRequest(request, sender);
      expect(r3.isOk()).toBe(true);
      if (r3.isOk()) {
        expect(r3.value.verdict).toBe("rejected");
        const rateLimitCheck = r3.value.checks.find(
          (c) => c.checkId === "rate_limit_exceeded",
        );
        expect(rateLimitCheck).toBeDefined();
        expect(rateLimitCheck?.verdict).toBe("fail");
      }
    });

    test("rate limits per sender independently", async () => {
      const config = createTestConfig({
        maxRequestsPerRequesterPerHour: 1,
      });
      const service = createVerifierService({
        config,
        sign: mockSign,
        generateId: (() => {
          let c = 0;
          return () => {
            c++;
            return `stmt-${String(c)}`;
          };
        })(),
        now: () => new Date("2025-01-15T00:00:00.000Z").getTime(),
        checks: [
          createSourceAvailableCheck({
            fetcher: createTestFetcher({
              "https://github.com/xmtp/xmtp-signet": { status: 200 },
            }),
          }),
        ],
      });

      const request = createTestVerificationRequest();

      const r1 = await service.handleRequest(request, "sender-1");
      expect(r1.isOk()).toBe(true);

      const r2 = await service.handleRequest(request, "sender-2");
      expect(r2.isOk()).toBe(true);
      if (r2.isOk()) {
        // sender-2's first request should not be rate-limited
        expect(r2.value.verdict).not.toBe("rejected");
      }
    });
  });

  describe("selfSeal", () => {
    test("returns verifier capabilities", () => {
      const service = createTestService();
      const selfSeal = service.selfSeal();

      expect(selfSeal.verifierInboxId).toBe("verifier-inbox-001");
      expect(selfSeal.capabilities.supportedTiers).toEqual(["unverified"]);
      expect(selfSeal.capabilities.supportedChecks).toContain(
        "source_available",
      );
      expect(selfSeal.capabilities.maxRequestsPerHour).toBe(10);
      expect(selfSeal.sourceRepoUrl).toBe(
        "https://github.com/xmtp/xmtp-verifier",
      );
    });

    test("returns cached instance on subsequent calls", () => {
      const service = createTestService();
      const a1 = service.selfSeal();
      const a2 = service.selfSeal();
      expect(a1).toBe(a2); // same reference
    });
  });
});

describe("canonicalize", () => {
  test("produces deterministic output regardless of key order", () => {
    const a = { z: 1, a: 2 };
    const b = { a: 2, z: 1 };
    const bytesA = canonicalize(a);
    const bytesB = canonicalize(b);
    expect(bytesA).toEqual(bytesB);
  });

  test("excludes nothing — serializes all fields", () => {
    const obj = {
      statementId: "stmt-001",
      verdict: "verified",
      extra: "included",
    };

    const bytes = canonicalize(obj);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toContain("statementId");
    expect(decoded).toContain("verdict");
    expect(decoded).toContain("extra");
  });
});
