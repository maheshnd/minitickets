import { describe, expect, it, vi } from "vitest";
import { FaultyMailer } from "./faulty-mailer";

const email = { to: "ada@example.com", subject: "s", body: "b" };

describe("FaultyMailer (demo fault injection)", () => {
  it("first-n:2: the first 2 sends fail, the 3rd reaches the real mailer", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const mailer = new FaultyMailer({ send }, "first-n:2");

    await expect(mailer.send(email)).rejects.toThrow("injected on purpose");
    await expect(mailer.send(email)).rejects.toThrow("injected on purpose");
    await mailer.send(email);

    expect(send).toHaveBeenCalledExactlyOnceWith(email);
  });

  it("always: every send fails", async () => {
    const send = vi.fn();
    const mailer = new FaultyMailer({ send }, "always");
    for (let i = 0; i < 5; i++) await expect(mailer.send(email)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("off: passes every send through", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await new FaultyMailer({ send }, "off").send(email);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
