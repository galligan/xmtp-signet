import { describe, expect, test } from "bun:test";
import { determineVerdict, determineVerifiedTier } from "../verdict.js";

describe("determineVerdict", () => {
  test("returns verified when all checks pass", () => {
    expect(determineVerdict(["pass", "pass", "pass"])).toBe("verified");
  });

  test("returns partial when some checks pass and some skip", () => {
    expect(determineVerdict(["pass", "skip", "pass"])).toBe("partial");
  });

  test("returns rejected when any check fails", () => {
    expect(determineVerdict(["pass", "fail", "pass"])).toBe("rejected");
  });

  test("returns rejected when fail and skip both present", () => {
    expect(determineVerdict(["pass", "fail", "skip"])).toBe("rejected");
  });

  test("returns partial when all checks skip", () => {
    expect(determineVerdict(["skip", "skip"])).toBe("partial");
  });

  test("returns verified for single passing check", () => {
    expect(determineVerdict(["pass"])).toBe("verified");
  });
});

describe("determineVerifiedTier", () => {
  test("returns source-verified for verified verdict", () => {
    expect(determineVerifiedTier("verified", "source-verified")).toBe(
      "source-verified",
    );
  });

  test("returns unverified for partial verdict", () => {
    expect(determineVerifiedTier("partial", "source-verified")).toBe(
      "unverified",
    );
  });

  test("returns unverified for rejected verdict", () => {
    expect(determineVerifiedTier("rejected", "source-verified")).toBe(
      "unverified",
    );
  });

  test("caps at source-verified even if higher tier requested", () => {
    expect(determineVerifiedTier("verified", "runtime-attested")).toBe(
      "source-verified",
    );
  });

  test("returns unverified when unverified tier requested and partial", () => {
    expect(determineVerifiedTier("partial", "unverified")).toBe("unverified");
  });
});
