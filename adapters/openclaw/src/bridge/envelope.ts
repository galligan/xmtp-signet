import { z } from "zod";
import { SignetEvent } from "@xmtp/signet-schemas";
import type { SignetEvent as SignetEventType } from "@xmtp/signet-schemas";
import { OPENCLAW_ADAPTER_NAME } from "../config/index.js";

/** Local delivery envelope emitted by the read-only OpenClaw bridge. */
export const OpenClawBridgeEnvelope: z.ZodType<{
  adapter: string;
  deliveryMode: "local";
  credentialId: string;
  operatorId: string;
  seq: number;
  dedupeKey: string;
  receivedAt: string;
  checkpointPath: string;
  event: SignetEventType;
}> = z
  .object({
    adapter: z.literal(OPENCLAW_ADAPTER_NAME),
    deliveryMode: z.literal("local"),
    credentialId: z.string().min(1),
    operatorId: z.string().min(1),
    seq: z.number().int().positive(),
    dedupeKey: z.string().min(1),
    receivedAt: z.string().datetime(),
    checkpointPath: z.string().min(1),
    event: SignetEvent,
  })
  .strict();

/** Inferred local delivery envelope type. */
export type OpenClawBridgeEnvelopeType = z.infer<typeof OpenClawBridgeEnvelope>;

/** Create the canonical local delivery envelope for one sequenced frame. */
export function createOpenClawBridgeEnvelope(options: {
  readonly credentialId: string;
  readonly operatorId: string;
  readonly seq: number;
  readonly checkpointPath: string;
  readonly event: SignetEventType;
}): OpenClawBridgeEnvelopeType {
  return OpenClawBridgeEnvelope.parse({
    adapter: OPENCLAW_ADAPTER_NAME,
    deliveryMode: "local",
    credentialId: options.credentialId,
    operatorId: options.operatorId,
    seq: options.seq,
    dedupeKey: `${options.credentialId}:${options.seq}`,
    receivedAt: new Date().toISOString(),
    checkpointPath: options.checkpointPath,
    event: options.event,
  });
}
