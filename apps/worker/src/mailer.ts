// The worker's way to send an email. The handler only knows this interface, so tests pass a fake,
// and the real sender (Amazon SES) can replace LogMailer in step S1c without touching the handler.
export type Email = { to: string; subject: string; body: string };

export interface Mailer {
  send(email: Email): Promise<void>;
}

// For now: "send" by writing a log line. It logs the subject and only the DOMAIN of the recipient
// (gmail.com), never the full address or the body: logs are kept longer and read by more people
// than a queue, and an address is personal data.
export class LogMailer implements Mailer {
  async send(email: Email): Promise<void> {
    const domain = email.to.split("@")[1] ?? "unknown";
    console.log(`[mailer] would send email to *@${domain}: "${email.subject}"`);
  }
}
