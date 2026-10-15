import type { Email, Mailer } from "./mailer";

// FAULT INJECTION, for demos only. This exists to SHOW the failure handling working (retries with
// backoff, the dead-letter queue) without breaking a real email service. It wraps the real mailer
// and throws instead of sending, as set by MAILER_FAIL_MODE (validated in config.ts, which also
// refuses to start with it in production):
//   "always"      every send fails             -> the message ends in the DLQ after 3 tries
//   "first-n:<n>" the first n sends fail, then all succeed -> shows retries recovering
// The count lives in this process's memory: restarting the worker starts it again.
export class FaultyMailer implements Mailer {
  private readonly inner: Mailer;
  private failuresLeft: number;

  constructor(inner: Mailer, mode: string) {
    this.inner = inner;
    // 1. Turn the mode text into "how many sends still fail". "off" = 0 (nothing fails).
    if (mode === "always") this.failuresLeft = Infinity;
    else if (mode.startsWith("first-n:")) this.failuresLeft = Number(mode.slice("first-n:".length));
    else this.failuresLeft = 0;
  }

  async send(email: Email): Promise<void> {
    // 2. Still failing? Use one failure up and throw, like a mail server that is down would.
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error("mail server unavailable (MAILER_FAIL_MODE, injected on purpose)");
    }
    await this.inner.send(email);
  }
}
