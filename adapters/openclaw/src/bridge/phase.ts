/** Current bridge phase for the OpenClaw adapter. */
export const OPENCLAW_BRIDGE_PHASE = "read-only";

/** Whether the first read-only bridge slice is now implemented. */
export function isOpenClawBridgeReady(): boolean {
  return true;
}
