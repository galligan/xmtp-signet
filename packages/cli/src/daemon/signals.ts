/**
 * Signal handler setup for graceful daemon shutdown.
 *
 * SIGTERM and SIGINT both trigger graceful shutdown.
 * A second signal during shutdown forces immediate exit.
 */
export function setupSignalHandlers(
  onShutdown: () => Promise<void>,
): () => void {
  let shutdownInProgress = false;

  const handler = async (signal: string): Promise<void> => {
    if (shutdownInProgress) {
      // Second signal: force exit (128 + signal number)
      process.exit(128 + (signal === "SIGTERM" ? 15 : 2));
    }
    shutdownInProgress = true;
    console.error(`\nReceived ${signal}, shutting down...`);
    await onShutdown();
  };

  const sigterm = (): void => {
    void handler("SIGTERM").catch((error: unknown) => {
      console.error(
        "[signal] shutdown error:",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    });
  };
  const sigint = (): void => {
    void handler("SIGINT").catch((error: unknown) => {
      console.error(
        "[signal] shutdown error:",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    });
  };

  process.on("SIGTERM", sigterm);
  process.on("SIGINT", sigint);

  return () => {
    process.off("SIGTERM", sigterm);
    process.off("SIGINT", sigint);
  };
}
