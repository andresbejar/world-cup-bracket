import { describe, it, expect } from "vitest";
import { chunk } from "./chunk";

describe("chunk", () => {
  it("returns [] for an empty array", () => {
    expect(chunk([], 8)).toEqual([]);
  });

  it("splits exact multiples evenly", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("puts the remainder in a final short batch", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single batch when size >= length", () => {
    expect(chunk([1, 2, 3], 8)).toEqual([[1, 2, 3]]);
  });

  it("returns singletons when size is 1", () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("preserves order across batches", () => {
    const flat = chunk([0, 1, 2, 3, 4, 5, 6], 3).flat();
    expect(flat).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("throws on a non-positive or non-integer size", () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], -1)).toThrow();
    expect(() => chunk([1], 1.5)).toThrow();
  });
});
