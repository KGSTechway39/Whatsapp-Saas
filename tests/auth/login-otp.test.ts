import { beforeAll, describe, expect, it } from "vitest";
import { codeMatches, hashCode, maskPhone, normalizePhone } from "@/lib/login-otp";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

describe("normalizePhone", () => {
  it("adds 91 to a bare 10-digit Indian number", () => {
    expect(normalizePhone("98765 43210")).toBe("919876543210");
  });
  it("strips a trunk 0 prefix", () => {
    expect(normalizePhone("09876543210")).toBe("919876543210");
  });
  it("keeps an explicit country code and removes separators", () => {
    expect(normalizePhone("+91 (98765) 43-210")).toBe("919876543210");
    expect(normalizePhone("+1 415 555 0100")).toBe("14155550100");
  });
  it("rejects junk", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("+0 000 000 0000 0")).toBeNull();
  });
});

describe("code hashing", () => {
  it("matches only the same phone + code", () => {
    const h = hashCode("919876543210", "123456");
    expect(codeMatches("919876543210", "123456", h)).toBe(true);
    expect(codeMatches("919876543210", "123457", h)).toBe(false);
    expect(codeMatches("919876543211", "123456", h)).toBe(false);
  });
  it("tolerates a malformed stored hash", () => {
    expect(codeMatches("919876543210", "123456", "abc")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("shows only country code and last 4 digits", () => {
    expect(maskPhone("919876543210")).toBe("+91 ••••••3210");
  });
});
