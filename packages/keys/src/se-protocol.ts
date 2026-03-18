import { z } from "zod";
import type { KeyPolicy } from "./config.js";
import { KeyPolicySchema } from "./config.js";

/** Shape of the `signet-signer create` response. */
export const SeCreateResponseSchema: z.ZodObject<{
  keyRef: z.ZodString;
  publicKey: z.ZodString;
  policy: z.ZodEnum<["biometric", "passcode", "open"]>;
}> = z.object({
  keyRef: z.string().describe("Base64-encoded SE data representation"),
  publicKey: z
    .string()
    .describe("Hex-encoded uncompressed P-256 public key (no 0x prefix)"),
  policy: KeyPolicySchema,
});

/** Parsed `signet-signer create` response payload. */
export type SeCreateResponse = {
  keyRef: string;
  publicKey: string;
  policy: KeyPolicy;
};

/** Shape of the `signet-signer sign` response. */
export const SeSignResponseSchema: z.ZodObject<{
  signature: z.ZodString;
}> = z.object({
  signature: z
    .string()
    .describe("Hex-encoded DER signature with low-S normalization"),
});

/** Parsed `signet-signer sign` response payload. */
export type SeSignResponse = {
  signature: string;
};

/** Shape of the `signet-signer info --system` response. */
export const SeSystemInfoResponseSchema: z.ZodObject<{
  available: z.ZodBoolean;
  chip: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  macOS: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}> = z.object({
  available: z.boolean(),
  chip: z.string().nullable().optional(),
  macOS: z.string().nullable().optional(),
});

/** Parsed `signet-signer info --system` response payload. */
export type SeSystemInfoResponse = {
  available: boolean;
  chip?: string | null | undefined;
  macOS?: string | null | undefined;
};

/** Shape of the `signet-signer info --key-ref` response. */
export const SeKeyInfoResponseSchema: z.ZodObject<{
  exists: z.ZodBoolean;
}> = z.object({
  exists: z.boolean(),
});

/** Parsed `signet-signer info --key-ref` response payload. */
export type SeKeyInfoResponse = {
  exists: boolean;
};
