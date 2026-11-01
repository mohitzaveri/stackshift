import { createHash, timingSafeEqual } from "node:crypto";

/** Compares in constant time, so response timing doesn't reveal how much of a guess was right. */
export function accessCodeMatches(given: string | undefined, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given ?? ""), digest(expected));
}
