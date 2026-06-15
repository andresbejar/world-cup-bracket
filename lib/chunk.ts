/**
 * Split `items` into consecutive sub-arrays of at most `size`. Used to run
 * independent async work in bounded-concurrency batches (e.g. per-user score
 * recompute) via `for (const batch of chunk(items, N)) await Promise.all(...)`.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunk size must be a positive integer, got ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
