/**
 * Connection module -- re-exports from handler.
 * The handler.ts file contains the WebSocket lifecycle management
 * integrated with the handler factory for simpler state sharing.
 */
export { createSignetHandler } from "./handler.js";
