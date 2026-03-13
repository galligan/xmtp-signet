import { describe, expect, test } from "bun:test";
import { createSourceAvailableCheck } from "../checks/source-available.js";
import {
  createTestVerificationRequest,
  createTestFetcher,
} from "./fixtures.js";

describe("source_available check", () => {
  test("passes when source repo returns 200", async () => {
    const check = createSourceAvailableCheck({
      fetcher: createTestFetcher({
        "https://github.com/xmtp/xmtp-broker": { status: 200 },
      }),
    });

    const result = await check.execute(createTestVerificationRequest());
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("pass");
      expect(result.value.checkId).toBe("source_available");
    }
  });

  test("fails when source repo returns 404", async () => {
    const check = createSourceAvailableCheck({
      fetcher: createTestFetcher({
        "https://github.com/xmtp/xmtp-broker": { status: 404 },
      }),
    });

    const result = await check.execute(createTestVerificationRequest());
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("404");
    }
  });

  test("fails when fetch throws (network error)", async () => {
    const check = createSourceAvailableCheck({
      fetcher: (async () => {
        throw new Error("Network error");
      }) as unknown as typeof fetch,
    });

    const result = await check.execute(createTestVerificationRequest());
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("Network error");
    }
  });

  test("clears the timeout when fetch fails early", async () => {
    const originalClearTimeout = globalThis.clearTimeout;
    let cleared = false;

    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      cleared = true;
      return originalClearTimeout(timer);
    }) as typeof clearTimeout;

    try {
      const check = createSourceAvailableCheck({
        timeoutMs: 10_000,
        fetcher: (async () => {
          throw new Error("Immediate failure");
        }) as unknown as typeof fetch,
      });

      const result = await check.execute(createTestVerificationRequest());
      expect(result.isOk()).toBe(true);
      expect(cleared).toBe(true);
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  test("includes evidence with url and timing", async () => {
    const check = createSourceAvailableCheck({
      fetcher: createTestFetcher({
        "https://github.com/xmtp/xmtp-broker": { status: 200 },
      }),
    });

    const result = await check.execute(createTestVerificationRequest());
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.evidence).not.toBeNull();
      const evidence = result.value.evidence as Record<string, unknown>;
      expect(evidence["url"]).toBe("https://github.com/xmtp/xmtp-broker");
      expect(typeof evidence["responseTimeMs"]).toBe("number");
    }
  });
});
