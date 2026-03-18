import { z } from "zod";
import { KeyPolicySchema } from "./config.js";

/** Response from `signet-signer create`. */
export const SeCreateResponseSchema = z.object({
  keyRef: z.string().describe("Base64-encoded SE data representation"),
  publicKey: z
    .string()
    .describe("Hex-encoded uncompressed P-256 public key (no 0x prefix)"),
  policy: KeyPolicySchema,
});

export type SeCreateResponse = z.infer<typeof SeCreateResponseSchema>;

/** Response from `signet-signer sign`. */
export const SeSignResponseSchema = z.object({
  signature: z
    .string()
    .describe("Hex-encoded DER signature with low-S normalization"),
});

export type SeSignResponse = z.infer<typeof SeSignResponseSchema>;

/** Response from `signet-signer info --system`. */
export const SeSystemInfoResponseSchema = z.object({
  available: z.boolean(),
  chip: z.string().nullable().optional(),
  macOS: z.string().nullable().optional(),
});

export type SeSystemInfoResponse = z.infer<typeof SeSystemInfoResponseSchema>;

/** Response from `signet-signer info --key-ref`. */
export const SeKeyInfoResponseSchema = z.object({
  exists: z.boolean(),
});

export type SeKeyInfoResponse = z.infer<typeof SeKeyInfoResponseSchema>;
