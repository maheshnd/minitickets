import { createHash, timingSafeEqual } from "node:crypto";

// Is `given` (from a request header) the same as `expected` (our secret)? In CONSTANT TIME.
//
// WHY NOT `given === expected`: === stops at the first character that differs. A wrong guess that
// starts with the right characters takes a tiny bit longer to reject. Measured over many requests,
// that difference can leak the secret one character at a time (a "timing attack").
// timingSafeEqual always compares EVERY byte, so the time says nothing about where they differ.
//
// 1. A missing header (null) is never equal: we stop at once (that leaks only "no header sent").
// 2. Hash both sides first (SHA-256, always 32 bytes). timingSafeEqual needs two buffers of the
//    SAME length and throws otherwise; comparing lengths first would leak the secret's length.
//    Equal hashes mean equal strings (a SHA-256 collision is not a real-world risk).
export function secretEquals(given: string | null, expected: string): boolean {
  if (given === null) return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}
