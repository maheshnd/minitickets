import { LocalTicketSettings, setupLocalTickets } from "../tickets/local-stack";

// 1. Startup setup is repeatable and local-only. Print counts, never secret values.
const settings = LocalTicketSettings.parse(process.env);
const stack = await setupLocalTickets(settings);
console.log("tickets ready: 1 SNS topic, 2 subscriptions, 2 queues + 2 DLQs, 1 table/GSI, 1 private bucket, 1 signing secret");
Object.values(stack.clients).forEach(client => client.destroy());
