import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SesMailer } from "./ses-mailer";

// SesMailer with a fake SES client: we check WHAT it asks SES, and what it logs.
const email = { to: "ada@example.com", subject: "Your booking is confirmed: Jazz Night", body: "Hi,\n\nSee you there!" };

describe("SesMailer", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("sends one Simple email from MAIL_FROM to the recipient, UTF-8 subject and text body", async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: "ses-1" });

    await new SesMailer({ send } as never, "no-reply@minitickets.example").send(email);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toEqual({
      FromEmailAddress: "no-reply@minitickets.example",
      Destination: { ToAddresses: ["ada@example.com"] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: "UTF-8" },
          Body: { Text: { Data: email.body, Charset: "UTF-8" } },
        },
      },
    });
  });

  it("logs SES's message id and only the recipient's domain", async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: "ses-1" });

    await new SesMailer({ send } as never, "no-reply@minitickets.example").send(email);

    const logged = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(logged).toContain("ses-1");
    expect(logged).toContain("*@example.com");
    expect(logged).not.toContain("ada@");
  });

  it("an SES refusal (e.g. sandbox recipient) is passed on, so the message is retried", async () => {
    const refused = Object.assign(new Error("Email address is not verified."), { name: "MessageRejected" });
    const send = vi.fn().mockRejectedValue(refused);

    await expect(new SesMailer({ send } as never, "no-reply@minitickets.example").send(email)).rejects.toThrow("not verified");
  });
});
