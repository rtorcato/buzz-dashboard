import "server-only";

// Public facts about the hive's relay, read on the server.

const SEND_MS = 10_000;

/** The relay's own signing key, from its NIP-11 `self`, or null. */
export async function relaySelf(
  relay: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(relay, {
      headers: { accept: "application/nostr+json" },
      redirect: "error",
      signal: AbortSignal.timeout(SEND_MS),
      next: { revalidate: 600 },
    } as RequestInit);
    if (!res.ok) return null;
    const self = ((await res.json()) as { self?: unknown }).self;
    return typeof self === "string" && /^[0-9a-f]{64}$/.test(self)
      ? self
      : null;
  } catch {
    return null;
  }
}
