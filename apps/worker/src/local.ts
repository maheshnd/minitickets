import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient, type Message } from "@aws-sdk/client-sqs";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { ZodError } from "zod";
import { env } from "./config";
import { handler } from "./lambda";

// The LOCAL runner (`pnpm worker:dev`). On AWS, Lambda reads the queue for us and calls
// handler(event). Locally nothing does that, so this file plays Lambda's part: it reads the queue,
// builds the SAME SQSEvent shape, and calls the SAME handler. So the code that runs here is the
// code that will run on Lambda.

const sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.SQS_ENDPOINT });
let stopping = false;

// 1. Turn a queue message into the record shape Lambda would give the handler (only the fields we use).
function toRecord(message: Message): SQSRecord {
  return { messageId: message.MessageId ?? "", receiptHandle: message.ReceiptHandle ?? "", body: message.Body ?? "" } as SQSRecord;
}

// Short, safe text for a log line: for a bad message only the names of the wrong fields.
function describe(err: unknown): string {
  if (err instanceof ZodError) return `invalid message, wrong fields: ${err.issues.map((i) => i.path.join(".")).join(", ")}`;
  // JSON.parse errors quote a piece of the body, so we do not print theirs.
  if (err instanceof SyntaxError) return "message body is not valid JSON";
  return err instanceof Error ? err.message : String(err);
}

async function poll() {
  console.log(`[worker] listening on ${env.JOBS_QUEUE_URL}`);
  while (!stopping) {
    try {
      // 2. LONG POLLING: WaitTimeSeconds 20 makes the request wait up to 20 s for a message and
      //    return the moment one arrives. Short polling would ask over and over ("anything yet?")
      //    and burn requests (on AWS, money) while the queue is empty. One message at a time keeps
      //    the demo easy to follow (Lambda would send a batch).
      const result = await sqs.send(
        new ReceiveMessageCommand({ QueueUrl: env.JOBS_QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 20 }),
      );
      for (const message of result.Messages ?? []) {
        console.log(`[worker] received message ${message.MessageId}`);
        try {
          // 3. The same call Lambda makes.
          await handler({ Records: [toRecord(message)] } as SQSEvent);
        } catch (err) {
          // 4. DELETE ONLY AFTER SUCCESS. On failure we do NOT delete: the message stays hidden for
          //    its visibility timeout (30 s, docker/elasticmq.conf), then comes back and is tried
          //    again. A bad message would come back forever; the dead-letter queue (S1c) is the fix.
          //    We log WHICH fields were wrong, never the message: it holds an email address.
          console.error(`[worker] failed, message ${message.MessageId} stays in the queue: ${describe(err)}`);
          continue;
        }
        await sqs.send(new DeleteMessageCommand({ QueueUrl: env.JOBS_QUEUE_URL, ReceiptHandle: message.ReceiptHandle }));
        console.log(`[worker] done, message ${message.MessageId} deleted`);
      }
    } catch (err) {
      // 5. The queue itself is unreachable: say so, wait a little, and try again (do not spin).
      console.error("[worker] cannot read the queue:", err instanceof Error ? err.message : err);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

// 6. Ctrl+C / kill: stop asking for more. A poll in flight may take up to 20 s to end, so exit now
//    unless a message is being handled; the unfinished message simply comes back (nothing is lost).
process.on("SIGINT", () => { stopping = true; process.exit(0); });
process.on("SIGTERM", () => { stopping = true; process.exit(0); });

await poll();
