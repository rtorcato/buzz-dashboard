// Owner-signed writes from the browser (#169). The NIP-07 extension signs;
// this module only builds what it signs and posts the result. No key is ever
// in the page or on the server.

import type { EventTemplate } from "./channel-admin";

export type SignedEvent = EventTemplate & {
  id: string;
  pubkey: string;
  sig: string;
};

type Nip07 = {
  getPublicKey: () => Promise<string>;
  signEvent: (e: EventTemplate) => Promise<SignedEvent>;
};

/** The page's NIP-07 extension, or null when there is none. */
export const nostrExtension = (): Nip07 | null =>
  typeof window === "undefined"
    ? null
    : ((window as { nostr?: Nip07 }).nostr ?? null);

/** Thrown with a sentence the owner can act on. */
export class SignError extends Error {}

const now = () => Math.floor(Date.now() / 1000);

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const base64 = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));

async function sign(n: Nip07, template: EventTemplate): Promise<SignedEvent> {
  try {
    return await n.signEvent(template);
  } catch {
    throw new SignError("The extension didn't sign it. Nothing more was sent.");
  }
}

/** `Nostr <base64>`: NIP-98 HTTP auth for a POST of `body` to `url`. */
export async function httpAuth(
  n: Nip07,
  url: string,
  body: string,
): Promise<string> {
  const event = await sign(n, {
    kind: 27235,
    created_at: now(),
    tags: [
      ["u", url],
      ["method", "POST"],
      ["nonce", crypto.randomUUID()],
      ["payload", await sha256Hex(body)],
    ],
    content: "",
  });
  return `Nostr ${base64(JSON.stringify(event))}`;
}

const errorOf = async (res: Response, fallback: string) => {
  const body = (await res.json().catch(() => null)) as { error?: unknown };
  return typeof body?.error === "string" ? body.error : fallback;
};

/**
 * Signs one channel admin event and its relay auth, then hands both to the
 * dashboard, which checks them and passes them to the relay unchanged.
 */
export async function relayWrite(
  n: Nip07,
  relayEventsUrl: string,
  template: EventTemplate,
): Promise<void> {
  const body = JSON.stringify(await sign(n, template));
  const authorization = await httpAuth(n, relayEventsUrl, body);
  const res = await fetch("/api/channels/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body, authorization }),
  });
  if (!res.ok) {
    throw new SignError(await errorOf(res, "The relay refused the change."));
  }
}

/**
 * One owner-signed agent config read (#194): signs the relay's HTTP auth for
 * `[filter]` and has the dashboard pass both to `<relay>/<path>` unchanged.
 */
export async function configRead(
  n: Nip07,
  relay: string,
  path: "query" | "count",
  filter: Record<string, unknown>,
): Promise<unknown> {
  const body = JSON.stringify([filter]);
  const authorization = await httpAuth(n, `${relay}/${path}`, body);
  const res = await fetch("/api/agent-config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, body, authorization }),
  });
  if (!res.ok) {
    throw new SignError(await errorOf(res, "The relay didn't answer."));
  }
  return res.json();
}

/** A signed registry write (#166): a NIP-98 event for this URL and body. */
export async function registryWrite(
  n: Nip07,
  path: string,
  payload: unknown,
): Promise<unknown> {
  const body = JSON.stringify(payload);
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await httpAuth(n, `${location.origin}${path}`, body),
    },
    body,
  });
  if (!res.ok) {
    throw new SignError(await errorOf(res, "The dashboard didn't save it."));
  }
  return res.json().catch(() => null);
}
