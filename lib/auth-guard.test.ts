import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAdminUserId } from "./auth-guard";

describe("isAdminUserId", () => {
  const ORIGINAL = process.env.ADMIN_USER_IDS;

  beforeEach(() => {
    delete process.env.ADMIN_USER_IDS;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = ORIGINAL;
  });

  it("returns false when env is unset or empty", () => {
    expect(isAdminUserId("anyone")).toBe(false);
    process.env.ADMIN_USER_IDS = "";
    expect(isAdminUserId("anyone")).toBe(false);
    process.env.ADMIN_USER_IDS = "   ";
    expect(isAdminUserId("anyone")).toBe(false);
  });

  it("returns false for null/undefined/empty caller id", () => {
    process.env.ADMIN_USER_IDS = "abc,def";
    expect(isAdminUserId(null)).toBe(false);
    expect(isAdminUserId(undefined)).toBe(false);
    expect(isAdminUserId("")).toBe(false);
  });

  it("matches a single id exactly", () => {
    process.env.ADMIN_USER_IDS = "abc-123";
    expect(isAdminUserId("abc-123")).toBe(true);
    expect(isAdminUserId("abc")).toBe(false);
    expect(isAdminUserId("abc-1234")).toBe(false);
  });

  it("splits on commas and ignores surrounding whitespace", () => {
    process.env.ADMIN_USER_IDS = " abc , def , ghi ";
    expect(isAdminUserId("abc")).toBe(true);
    expect(isAdminUserId("def")).toBe(true);
    expect(isAdminUserId("ghi")).toBe(true);
    expect(isAdminUserId("xyz")).toBe(false);
  });
});
