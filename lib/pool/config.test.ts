import { describe, expect, it } from "vitest";
import { enabledMethods, type PoolConfig } from "./config";

function makeConfig(overrides: Partial<PoolConfig> = {}): PoolConfig {
  return {
    buyInUsd: 40,
    deadline: null,
    methods: {},
    paypalPoolUrl: null,
    ...overrides,
  };
}

describe("enabledMethods", () => {
  it("always exposes 'other' as the last method, even with no handles", () => {
    expect(enabledMethods(makeConfig())).toEqual(["other"]);
  });

  it("includes each handle-based method only when its handle is set", () => {
    const cfg = makeConfig({
      methods: { venmo: "@a", zelle: "z@b.com", cashapp: "$c" },
    });
    expect(enabledMethods(cfg)).toEqual(["venmo", "zelle", "cashapp", "other"]);
  });

  // APT-48 regression: PayPal is enabled by a pool URL ALONE — there is no
  // paypal.me handle in production. The claim route delegates to this function,
  // so if PayPal weren't included here the tile would render but "I just paid"
  // would 400 with "paypal is not enabled for this pool".
  it("enables paypal when only the pool URL is set (no handle)", () => {
    const cfg = makeConfig({ paypalPoolUrl: "https://paypal.com/pool/abc" });
    expect(enabledMethods(cfg)).toContain("paypal");
  });

  it("enables paypal when only the paypal.me handle is set (no pool URL)", () => {
    const cfg = makeConfig({ methods: { paypal: "andres" } });
    expect(enabledMethods(cfg)).toContain("paypal");
  });

  it("does not enable paypal when neither handle nor pool URL is set", () => {
    expect(enabledMethods(makeConfig())).not.toContain("paypal");
  });
});
