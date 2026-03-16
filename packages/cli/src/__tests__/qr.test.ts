import { describe, test, expect } from "bun:test";
import { renderQrToTerminal, renderQrToDataUrl } from "../invite/qr.js";

describe("QR code rendering", () => {
  test("renderQrToTerminal returns a non-empty string", async () => {
    const result = await renderQrToTerminal("test-data");
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result).toBe("string");
  });

  test("renderQrToDataUrl returns a data URL", async () => {
    const result = await renderQrToDataUrl("test-data");
    expect(result).toMatch(/^data:image\/png;base64,/);
  });
});
