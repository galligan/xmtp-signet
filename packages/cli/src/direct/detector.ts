import { existsSync, statSync, unlinkSync } from "node:fs";
import type { ResolvedPaths } from "../config/paths.js";

export type CliMode = "daemon" | "direct";

export interface ModeDetectionResult {
  readonly mode: CliMode;
  readonly socketPath?: string;
}

/**
 * Detect whether the broker daemon is running and reachable.
 *
 * Checks if the admin socket file exists and a daemon is listening on it.
 * If the socket file is stale (daemon not running), it is cleaned up.
 */
export async function detectMode(
  paths: ResolvedPaths,
): Promise<ModeDetectionResult> {
  if (!existsSync(paths.adminSocket)) {
    return { mode: "direct" };
  }

  // Socket file exists -- try to connect
  const connectResult = await tryConnect(paths.adminSocket);
  if (connectResult === "connected") {
    return { mode: "daemon", socketPath: paths.adminSocket };
  }

  // Only unlink if it's a stale socket (ECONNREFUSED) and actually a socket
  if (connectResult === "refused") {
    try {
      const stats = statSync(paths.adminSocket);
      if (stats.isSocket()) {
        unlinkSync(paths.adminSocket);
      }
    } catch {
      // Ignore cleanup failure (e.g. already removed, stat failed)
    }
  }

  return { mode: "direct" };
}

type ConnectResult = "connected" | "refused" | "error";

/**
 * Attempt a TCP-level connect to the Unix socket.
 * Returns "connected" if daemon is alive, "refused" if connection was
 * refused (stale socket), or "error" for other failures.
 */
async function tryConnect(socketPath: string): Promise<ConnectResult> {
  return new Promise<ConnectResult>((resolve) => {
    try {
      const socket = Bun.connect({
        unix: socketPath,
        socket: {
          open(sock) {
            // Connected -- daemon is alive
            sock.end();
            resolve("connected");
          },
          data() {},
          close() {},
          error(_sock, err) {
            resolve(classifyError(err));
          },
        },
      });

      // Bun.connect returns a promise that rejects if the socket
      // cannot be opened (e.g. ENOENT, ECONNREFUSED).
      void (socket as Promise<unknown>).catch((err: unknown) => {
        resolve(classifyError(err));
      });
    } catch (err: unknown) {
      resolve(classifyError(err));
    }
  });
}

function classifyError(error: unknown): "refused" | "error" {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ECONNREFUSED"
  ) {
    return "refused";
  }
  // Also check Bun's error message format
  if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
    return "refused";
  }
  return "error";
}
