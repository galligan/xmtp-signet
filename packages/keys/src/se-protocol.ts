import { z } from "zod";
import type { KeyPolicy } from "./config.js";
import { KeyPolicySchema } from "./config.js";

/** Response from `signet-signer create`. */
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

export type SeCreateResponse = {
  keyRef: string;
  publicKey: string;
  policy: KeyPolicy;
};

/** Response from `signet-signer sign`. */
export const SeSignResponseSchema: z.ZodObject<{
  signature: z.ZodString;
}> = z.object({
  signature: z
    .string()
    .describe("Hex-encoded DER signature with low-S normalization"),
});

export type SeSignResponse = {
  signature: string;
};

/** Response from `signet-signer info --system`. */
export const SeSystemInfoResponseSchema: z.ZodObject<{
  available: z.ZodBoolean;
  chip: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  macOS: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}> = z.object({
  available: z.boolean(),
  chip: z.string().nullable().optional(),
  macOS: z.string().nullable().optional(),
});

export type SeSystemInfoResponse = {
  available: boolean;
  chip?: string | null | undefined;
  macOS?: string | null | undefined;
};

/** Response from `signet-signer info --key-ref`. */
export const SeKeyInfoResponseSchema: z.ZodObject<{
  exists: z.ZodBoolean;
}> = z.object({
  exists: z.boolean(),
});

export type SeKeyInfoResponse = {
  exists: boolean;
};
