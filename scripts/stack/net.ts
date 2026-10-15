import net from "node:net";

// 1. Is anything listening on host:port? Opens a TCP connection and closes it right away.
//    autoSelectFamily: "localhost" can mean 127.0.0.1 (IPv4) or ::1 (IPv6); try both, like a
//    browser does, so a server bound to only one of them is still found.
export function isPortOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, autoSelectFamily: true });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

// 2. Send one Redis command and return the first line of the answer ("+PONG", "-NOAUTH ...").
//    Redis speaks a simple text protocol (RESP): an array of strings, each with its length.
//    Good enough for a PING; the app itself uses the ioredis library.
export function redisCommand(host: string, port: number, args: string[], timeoutMs = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, autoSelectFamily: true });
    let answer = "";
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error(`no answer within ${timeoutMs} ms`));
    });
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      answer += chunk.toString("utf8");
      if (answer.includes("\r\n")) {
        socket.destroy();
        resolve(answer.split("\r\n")[0]);
      }
    });
    socket.write(`*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join("")}`);
  });
}
