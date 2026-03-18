import { z } from "zod";
import { Result } from "better-result";

// -- Schemas for Sigstore bundle structure --

const DsseSignatureSchema = z.object({
  sig: z.string(),
  keyid: z.string(),
});

const DsseEnvelopeSchema = z.object({
  payload: z.string(),
  payloadType: z.string(),
  signatures: z.array(DsseSignatureSchema).min(1),
});

const CertificateSchema = z.object({
  rawBytes: z.string(),
});

const VerificationMaterialSchema = z.object({
  certificate: CertificateSchema,
  tlogEntries: z.array(z.unknown()).optional(),
});

const SigstoreBundleSchema = z.object({
  mediaType: z.string(),
  verificationMaterial: VerificationMaterialSchema,
  dsseEnvelope: DsseEnvelopeSchema,
});

// -- Types (explicit for isolatedDeclarations) --

export type SigstoreBundle = {
  mediaType: string;
  verificationMaterial: {
    certificate: { rawBytes: string };
    tlogEntries?: Array<unknown> | undefined;
  };
  dsseEnvelope: {
    payload: string;
    payloadType: string;
    signatures: Array<{ sig: string; keyid: string }>;
  };
};

export type InTotoStatement = {
  _type: "https://in-toto.io/Statement/v1";
  subject: Array<{ name: string; digest: { sha256: string } }>;
  predicateType: string;
  predicate?: unknown;
};

// -- Schemas for in-toto statement --

const SubjectDigestSchema = z.object({
  sha256: z.string(),
});

const SubjectSchema = z.object({
  name: z.string(),
  digest: SubjectDigestSchema,
});

const InTotoStatementSchema = z.object({
  _type: z.literal("https://in-toto.io/Statement/v1"),
  subject: z.array(SubjectSchema).min(1),
  predicateType: z.string(),
  predicate: z.unknown(),
});

// -- Parsed bundle result --

export type ParsedBundle = {
  bundle: SigstoreBundle;
  statement: InTotoStatement;
  certificateRawBytes: string;
};

// -- Parse and validate --

/**
 * Decodes a base64-encoded Sigstore bundle and validates its structure.
 * Returns the parsed bundle, extracted in-toto statement, and certificate.
 */
export function parseSigstoreBundle(
  base64Bundle: string,
): Result<ParsedBundle, string> {
  // Step 1: Decode base64
  let decoded: string;
  try {
    decoded = atob(base64Bundle);
  } catch {
    return Result.err("Bundle is not valid base64");
  }

  // Step 2: Parse JSON
  let raw: unknown;
  try {
    raw = JSON.parse(decoded);
  } catch {
    return Result.err("Bundle is not valid JSON");
  }

  // Step 3: Validate bundle structure
  const bundleResult = SigstoreBundleSchema.safeParse(raw);
  if (!bundleResult.success) {
    const issues = bundleResult.error.issues;
    // Produce a targeted error message based on what's missing
    const paths = issues.map((i) => i.path.join("."));
    if (paths.some((p) => p.startsWith("dsseEnvelope"))) {
      return Result.err("Bundle is missing required DSSE envelope");
    }
    if (paths.some((p) => p.startsWith("verificationMaterial"))) {
      return Result.err("Bundle is missing required verification material");
    }
    return Result.err(`Invalid bundle structure: ${issues[0]?.message}`);
  }

  const bundle = bundleResult.data;

  // Step 4: Decode and validate the DSSE payload as in-toto statement
  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(atob(bundle.dsseEnvelope.payload));
  } catch {
    return Result.err("DSSE envelope payload is not valid base64 JSON");
  }

  const statementResult = InTotoStatementSchema.safeParse(payloadJson);
  if (!statementResult.success) {
    return Result.err("DSSE payload is not a valid in-toto statement");
  }

  return Result.ok({
    bundle,
    statement: statementResult.data,
    certificateRawBytes: bundle.verificationMaterial.certificate.rawBytes,
  });
}

/**
 * Checks whether any subject in the in-toto statement matches
 * the expected artifact SHA-256 digest.
 */
export function findMatchingSubject(
  statement: InTotoStatement,
  expectedDigest: string,
): { name: string; digest: string } | null {
  const normalized = expectedDigest.toLowerCase();
  for (const subject of statement.subject) {
    if (subject.digest.sha256.toLowerCase() === normalized) {
      return { name: subject.name, digest: subject.digest.sha256 };
    }
  }
  return null;
}
