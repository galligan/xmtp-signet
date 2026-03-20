import { describe, expect, test } from "bun:test";
import { createBuildProvenanceCheck } from "../checks/build-provenance.js";
import { createTestVerificationRequest } from "./fixtures.js";
import { createCryptoBundle } from "./crypto-helpers.js";

/**
 * Creates a minimal valid Sigstore bundle structure for testing.
 * Uses fake signatures — structural checks pass but crypto
 * verification will fail.
 */
function createTestBundle(overrides?: {
  subjectDigest?: string;
  subjectName?: string;
  oidcIssuer?: string;
  workflowRef?: string;
}): string {
  const digest =
    overrides?.subjectDigest ??
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
  const subjectName = overrides?.subjectName ?? "artifact.tar.gz";

  // In-toto statement with subject digests
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: subjectName, digest: { sha256: digest } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://actions.github.io/buildtypes/workflow/v1",
      },
      runDetails: {
        builder: {
          id: "https://github.com/actions/runner",
        },
      },
    },
  };

  const payloadBase64 = btoa(JSON.stringify(statement));

  // Self-signed test certificate (not a real cert, just structural)
  // In real bundles this is a DER-encoded X.509 cert in base64
  const testCertBase64 = btoa("test-certificate-placeholder");

  const bundle = {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: {
      certificate: {
        rawBytes: testCertBase64,
      },
      tlogEntries: [],
    },
    dsseEnvelope: {
      payload: payloadBase64,
      payloadType: "application/vnd.in-toto+json",
      signatures: [
        {
          sig: btoa("test-signature"),
          keyid: "",
        },
      ],
    },
  };

  return btoa(JSON.stringify(bundle));
}

describe("build_provenance check", () => {
  test("skips when no bundle provided", async () => {
    const check = createBuildProvenanceCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        buildProvenanceBundle: null,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.checkId).toBe("build_provenance");
    }
  });

  test("fails when bundle is not valid base64", async () => {
    const check = createBuildProvenanceCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        buildProvenanceBundle: "!!!not-base64!!!",
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("base64");
    }
  });

  test("fails when bundle is not valid JSON", async () => {
    const check = createBuildProvenanceCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        buildProvenanceBundle: btoa("not-json{{{"),
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("JSON");
    }
  });

  test("fails when bundle is missing DSSE envelope", async () => {
    const check = createBuildProvenanceCheck();
    const bundleWithoutEnvelope = btoa(
      JSON.stringify({
        mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
        verificationMaterial: {
          certificate: { rawBytes: btoa("cert") },
        },
        // no dsseEnvelope
      }),
    );
    const result = await check.execute(
      createTestVerificationRequest({
        buildProvenanceBundle: bundleWithoutEnvelope,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("DSSE envelope");
    }
  });

  test("fails when bundle is missing verification material", async () => {
    const check = createBuildProvenanceCheck();
    const bundleWithoutMaterial = btoa(
      JSON.stringify({
        mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
        dsseEnvelope: {
          payload: btoa("{}"),
          payloadType: "application/vnd.in-toto+json",
          signatures: [{ sig: btoa("sig"), keyid: "" }],
        },
        // no verificationMaterial
      }),
    );
    const result = await check.execute(
      createTestVerificationRequest({
        buildProvenanceBundle: bundleWithoutMaterial,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("verification material");
    }
  });

  test("fails when artifact digest does not match", async () => {
    const check = createBuildProvenanceCheck();
    const bundle = createTestBundle({
      subjectDigest:
        "aaaa0000bbbb1111cccc2222dddd3333eeee4444ffff5555aaaa0000bbbb1111",
    });
    const result = await check.execute(
      createTestVerificationRequest({
        buildProvenanceBundle: bundle,
        // default artifactDigest differs from bundle subject
        artifactDigest:
          "different0000000000000000000000000000000000000000000000000000dead",
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("digest");
    }
  });

  test("fails when DSSE payload is not valid in-toto statement", async () => {
    const check = createBuildProvenanceCheck();
    const invalidBundle = btoa(
      JSON.stringify({
        mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
        verificationMaterial: {
          certificate: { rawBytes: btoa("cert") },
          tlogEntries: [],
        },
        dsseEnvelope: {
          payload: btoa(JSON.stringify({ notAnInTotoStatement: true })),
          payloadType: "application/vnd.in-toto+json",
          signatures: [{ sig: btoa("sig"), keyid: "" }],
        },
      }),
    );
    const result = await check.execute(
      createTestVerificationRequest({
        buildProvenanceBundle: invalidBundle,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("in-toto");
    }
  });

  test("fails when fake bundle has invalid certificate", async () => {
    const matchingDigest =
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const check = createBuildProvenanceCheck();
    const bundle = createTestBundle({
      subjectDigest: matchingDigest,
    });
    const result = await check.execute(
      createTestVerificationRequest({
        buildProvenanceBundle: bundle,
        artifactDigest: matchingDigest,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain(
        "Certificate key extraction failed",
      );
    }
  });

  test("skips with cryptographically valid bundle (Fulcio/Rekor not yet verified)", async () => {
    const matchingDigest =
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const check = createBuildProvenanceCheck();
    const bundle = createCryptoBundle({
      subjectDigest: matchingDigest,
    });
    const result = await check.execute(
      createTestVerificationRequest({
        buildProvenanceBundle: bundle,
        artifactDigest: matchingDigest,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.checkId).toBe("build_provenance");
      expect(result.value.reason).toContain("Fulcio");
      expect(result.value.evidence).not.toBeNull();
      const evidence = result.value.evidence as Record<string, unknown>;
      expect(evidence["cryptoVerified"]).toBe(true);
    }
  });

  test("fails when digest matches but signature is invalid", async () => {
    const matchingDigest =
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    // Create a bundle with multiple subjects but fake cert/sig
    const statement = {
      _type: "https://in-toto.io/Statement/v1",
      subject: [
        {
          name: "other-artifact.tar.gz",
          digest: {
            sha256:
              "0000000000000000000000000000000000000000000000000000000000000000",
          },
        },
        {
          name: "target-artifact.tar.gz",
          digest: { sha256: matchingDigest },
        },
      ],
      predicateType: "https://slsa.dev/provenance/v1",
      predicate: {},
    };
    const bundle = btoa(
      JSON.stringify({
        mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
        verificationMaterial: {
          certificate: { rawBytes: btoa("cert") },
          tlogEntries: [],
        },
        dsseEnvelope: {
          payload: btoa(JSON.stringify(statement)),
          payloadType: "application/vnd.in-toto+json",
          signatures: [{ sig: btoa("sig"), keyid: "" }],
        },
      }),
    );

    const check = createBuildProvenanceCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        buildProvenanceBundle: bundle,
        artifactDigest: matchingDigest,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Crypto verification fails on fake certificate
      expect(result.value.verdict).toBe("fail");
    }
  });
});
