import { describe, expect, it } from "vitest";
import {
  cashappLink,
  paymentLinkFor,
  paypalLink,
  venmoLink,
} from "./links";

describe("venmoLink", () => {
  it("builds a prefilled venmo URL with amount + note", () => {
    expect(venmoLink("andres-bejar", 20)).toBe(
      "https://venmo.com/andres-bejar?txn=pay&amount=20&note=World%20Cup%20Bracket%20buy-in",
    );
  });
  it("strips a leading @ from the handle", () => {
    expect(venmoLink("@andres-bejar", 20)).toBe(
      "https://venmo.com/andres-bejar?txn=pay&amount=20&note=World%20Cup%20Bracket%20buy-in",
    );
  });
});

describe("cashappLink", () => {
  it("builds a cash.app URL with $cashtag + amount in path", () => {
    expect(cashappLink("andresbejar", 20)).toBe(
      "https://cash.app/$andresbejar/20",
    );
  });
  it("strips a leading $ from the handle", () => {
    expect(cashappLink("$andresbejar", 50)).toBe(
      "https://cash.app/$andresbejar/50",
    );
  });
});

describe("paypalLink", () => {
  it("builds paypal.me URL with amount in path", () => {
    expect(paypalLink("andresbejar", 20)).toBe(
      "https://paypal.me/andresbejar/20",
    );
  });
  it("falls back to generic transfer page when handle is an email", () => {
    // paypal.me doesn't accept raw emails; UI surfaces the address via
    // the `hint`/`handle` fields instead.
    expect(paypalLink("andresbejar@gmail.com", 20)).toBe(
      "https://www.paypal.com/myaccount/transfer/homepage/pay",
    );
  });
});

describe("paymentLinkFor", () => {
  const handles = {
    venmo: "andres-bejar",
    zelle: "andresbejar@gmail.com",
    cashapp: "andresbejar",
    paypal: "andresbejar@gmail.com",
  };

  it("returns null when the method's handle is unset", () => {
    expect(paymentLinkFor("venmo", { handles: {} }, 20)).toBeNull();
    expect(paymentLinkFor("zelle", { handles: {} }, 20)).toBeNull();
    expect(paymentLinkFor("cashapp", { handles: {} }, 20)).toBeNull();
    expect(paymentLinkFor("paypal", { handles: {} }, 20)).toBeNull();
  });

  it("returns no URL for Zelle but exposes the handle + bank-app hint", () => {
    const link = paymentLinkFor("zelle", { handles }, 20);
    expect(link).not.toBeNull();
    expect(link?.url).toBeNull();
    expect(link?.handle).toBe("andresbejar@gmail.com");
    expect(link?.hint).toMatch(/bank app/i);
  });

  it("returns a Venmo deep link with @-prefixed handle for display", () => {
    const link = paymentLinkFor("venmo", { handles }, 25);
    expect(link?.url).toContain("https://venmo.com/andres-bejar");
    expect(link?.url).toContain("amount=25");
    expect(link?.handle).toBe("@andres-bejar");
  });

  it("returns the F&F instruction in the PayPal hint when only a handle is set", () => {
    const link = paymentLinkFor("paypal", { handles }, 20);
    expect(link?.hint).toMatch(/friends & family/i);
  });

  it("uses the PayPal Pool URL when set, overriding the handle", () => {
    const poolUrl = "https://www.paypal.com/pool/9pgRQw6qaU?sr=wccr";
    const link = paymentLinkFor(
      "paypal",
      { handles, paypalPoolUrl: poolUrl },
      20,
    );
    expect(link?.url).toBe(poolUrl);
    expect(link?.handle).toMatch(/pool/i);
    expect(link?.hint).toMatch(/\$20/);
  });

  it("exposes the PayPal Pool even when no paypal.me handle is configured", () => {
    const poolUrl = "https://www.paypal.com/pool/9pgRQw6qaU?sr=wccr";
    const link = paymentLinkFor(
      "paypal",
      { handles: {}, paypalPoolUrl: poolUrl },
      20,
    );
    expect(link?.url).toBe(poolUrl);
  });

  it("returns 'other' as a free-text escape hatch with no URL", () => {
    const link = paymentLinkFor("other", { handles }, 20);
    expect(link?.url).toBeNull();
    expect(link?.handle).toMatch(/wise|cash|international/i);
  });
});
