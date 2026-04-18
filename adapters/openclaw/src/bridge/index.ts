export type {
  OpenClawBridgeConfigType,
  OpenClawAdapterPaths,
  OpenClawRuntimePresence,
} from "./config.js";
export {
  OpenClawBridgeConfig,
  OpenClawBridgeDeliveryMode,
  inspectOpenClawRuntimePresence,
  resolveOpenClawAdapterPaths,
} from "./config.js";
export type {
  OpenClawBridgeCheckpointType,
  OpenClawCheckpointStore,
} from "./checkpoint-store.js";
export {
  OpenClawBridgeCheckpoint,
  createOpenClawCheckpointStore,
} from "./checkpoint-store.js";
export type { OpenClawBridgeEnvelopeType } from "./envelope.js";
export {
  OpenClawBridgeEnvelope,
  createOpenClawBridgeEnvelope,
} from "./envelope.js";
export type {
  OpenClawBridgeState,
  OpenClawBridgeMetrics,
  OpenClawReadOnlyBridge,
} from "./runtime.js";
export { createOpenClawReadOnlyBridge } from "./runtime.js";

/** Current bridge phase for the OpenClaw adapter. */
export const OPENCLAW_BRIDGE_PHASE = "read-only";

/** Whether the first read-only bridge slice is now implemented. */
export function isOpenClawBridgeReady(): boolean {
  return true;
}
