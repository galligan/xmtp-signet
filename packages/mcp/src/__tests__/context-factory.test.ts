import { describe, test, expect } from "bun:test";
import { createHandlerContext } from "../context-factory.js";
import { makeSessionRecord, createMockSignerProvider } from "./fixtures.js";

describe("createHandlerContext", () => {
  const sessionRecord = makeSessionRecord();
  const signerProvider = createMockSignerProvider();

  test("context has requestId in UUID format", () => {
    const ctx = createHandlerContext({
      signetId: "signet_1",
      signerProvider,
      sessionId: sessionRecord.sessionId,
      requestTimeoutMs: 30_000,
    });

    expect(ctx.requestId).toBeDefined();
    // UUID v4 format
    expect(ctx.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test("context has signal as AbortSignal", () => {
    const ctx = createHandlerContext({
      signetId: "signet_1",
      signerProvider,
      sessionId: sessionRecord.sessionId,
      requestTimeoutMs: 30_000,
    });

    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(ctx.signal.aborted).toBe(false);
  });

  test("context has sessionId from session record", () => {
    const ctx = createHandlerContext({
      signetId: "signet_1",
      signerProvider,
      sessionId: "sess_custom",
      requestTimeoutMs: 30_000,
    });

    expect(ctx.sessionId).toBe("sess_custom");
  });

  test("context does NOT have adminAuth", () => {
    const ctx = createHandlerContext({
      signetId: "signet_1",
      signerProvider,
      sessionId: sessionRecord.sessionId,
      requestTimeoutMs: 30_000,
    });

    expect(ctx.adminAuth).toBeUndefined();
  });
});
