import { describe, expect, it } from "vitest";
import { backoffSeconds } from "./backoff";

describe("backoffSeconds", () => {
  it.each([
    [1, 10],
    [2, 40],
    [3, 120], // 160 would be next, but the cap is 120
    [4, 120],
    [50, 120],
  ])("receive count %i -> wait %i s", (receiveCount, seconds) => {
    expect(backoffSeconds(receiveCount)).toBe(seconds);
  });

  it.each([0, -1, Number.NaN])("an odd receive count (%s) counts as the first try", (receiveCount) => {
    expect(backoffSeconds(receiveCount)).toBe(10);
  });
});
