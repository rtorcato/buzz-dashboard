import "server-only";

import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import type { ServerEnv } from "./env";

export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type Filter = {
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[];
};

type RelayEnv = Pick<
  ServerEnv,
  "buzzRelayUrl" | "buzzPrivateKey" | "buzzAuthTag"
>;

const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

// The dashboard signs only auth events: NIP-42 AUTH (kind 22242) here and
// the Blossom media get (kind 24242) in avatar.ts. Neither is stored or
// relayed; nothing here can post to a channel.
export function signEvent(
  privateKey: string,
  kind: number,
  tags: string[][],
  content: string,
  now: number,
): NostrEvent {
  if (!/^[0-9a-f]{64}$/i.test(privateKey)) {
    throw new Error("BUZZ_PRIVATE_KEY must be a 64-character hex key");
  }
  const secret = Buffer.from(privateKey, "hex");
  const pubkey = toHex(schnorr.getPublicKey(secret));
  const id = createHash("sha256")
    .update(JSON.stringify([0, pubkey, now, kind, tags, content]))
    .digest("hex");
  const sig = toHex(schnorr.sign(Buffer.from(id, "hex"), secret));
  return { pubkey, created_at: now, kind, tags, content, id, sig };
}

// NIP-42 AUTH event. The relay refuses every REQ until this is accepted.
export function signAuthEvent(
  env: RelayEnv,
  challenge: string,
  now = Math.floor(Date.now() / 1000),
): NostrEvent {
  const tags = [
    ["relay", env.buzzRelayUrl],
    ["challenge", challenge],
  ];
  if (env.buzzAuthTag) tags.push(JSON.parse(env.buzzAuthTag));
  return signEvent(env.buzzPrivateKey, 22242, tags, "", now);
}

/** Signs the relay's AUTH challenge; the dashboard's own key by default. */
export type AuthSigner = (
  challenge: string,
) => NostrEvent | Promise<NostrEvent>;

// One connection, one AUTH, one REQ: resolves with every stored event that
// matches any of the filters once the relay sends EOSE.
// ponytail: trusts the relay's signature checks rather than re-verifying each
// event; add verification if the dashboard ever reads from a relay we don't run.
export function queryRelay(
  env: RelayEnv,
  filters: Filter[],
  timeoutMs = 10_000,
  sign: AuthSigner = (challenge) => signAuthEvent(env, challenge),
): Promise<NostrEvent[]> {
  return new Promise((resolve, reject) => {
    const events: NostrEvent[] = [];
    const ws = new WebSocket(env.buzzRelayUrl);
    const finish = (err?: Error) => {
      clearTimeout(timer);
      ws.close();
      if (err) reject(err);
      else resolve(events);
    };
    const timer = setTimeout(
      () => finish(new Error("Buzz relay timed out")),
      timeoutMs,
    );

    ws.onerror = () => finish(new Error("Can't reach the Buzz relay"));
    // A no-op after EOSE; otherwise the relay hung up mid-query.
    ws.onclose = () => finish(new Error("Buzz relay closed the connection"));
    ws.onmessage = (message) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(String(message.data));
      } catch {
        return;
      }
      switch (msg[0]) {
        case "AUTH":
          // Async for the owner signer (#43), which answers over NIP-46.
          Promise.resolve()
            .then(() => sign(String(msg[1])))
            .then(
              (auth) => ws.send(JSON.stringify(["AUTH", auth])),
              (err) => finish(err as Error),
            );
          break;
        case "OK":
          if (msg[2] !== true) {
            finish(new Error(`Buzz relay refused auth: ${String(msg[3])}`));
          } else {
            ws.send(JSON.stringify(["REQ", "dashboard", ...filters]));
          }
          break;
        case "EVENT":
          events.push(msg[2] as NostrEvent);
          break;
        case "EOSE":
          finish();
          break;
        case "CLOSED":
          finish(new Error(`Buzz relay closed the query: ${String(msg[2])}`));
          break;
      }
    };
  });
}
