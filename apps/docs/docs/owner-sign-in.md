---
title: Owner sign-in
sidebar_position: 6
---

# Owner sign-in

The views are read-only and stay open to anyone who can reach the dashboard, so keep it behind your own access layer (see [Security](./security.md)). Sign-in only matters for the dashboard's own state, and only the owner can change that: snoozing and acknowledging Needs-you items, alert channels and rules, and the cost source. Signed out, the same controls are shown read-only.

There are no passwords and no stored keys. A signed-in owner gets a session cookie that is `httpOnly`, `SameSite=Lax`, `Secure` over HTTPS, signed by the server and valid for 7 days.

Sign-in is off until you set `AUTH_MODE`. It has two modes.

## Nostr extension (`AUTH_MODE=nostr`)

"Sign in with Nostr" in the sidebar asks your NIP-07 browser extension (Alby, nos2x and the like) to sign a one-time challenge. Your key never leaves the extension. The dashboard checks the signature, that the challenge is fresh and signed for `AUTH_PUBLIC_URL`, and that the key is one of `BUZZ_OWNER_PUBKEY`.

`AUTH_PUBLIC_URL` is required in this mode: set it to the exact URL you open the dashboard at, scheme and port included. The dashboard never trusts the request's `Host` or `X-Forwarded-Host` for this, because a client can set them. Opening it at any other address (another hostname, or plain `http://` when the URL is `https://`) fails with "Open the dashboard at its AUTH_PUBLIC_URL".

```sh
AUTH_MODE=nostr
AUTH_PUBLIC_URL=https://hive.example.com
# Your hex pubkey. A comma list lets more than one key sign in; the first
# one is still the owner whose attestations mark agents.
BUZZ_OWNER_PUBKEY=<owner-hex>
```

The session is signed with a key derived from `BUZZ_PRIVATE_KEY`, so changing that key signs everyone out. Removing a key from `BUZZ_OWNER_PUBKEY` ends its session on the next request.

## Behind an authenticating proxy (`AUTH_MODE=proxy`)

If a reverse proxy already signs people in (Authentik forward auth, oauth2-proxy and the like), the dashboard can trust the user it names in a header. There's no sign-in button in this mode, and you sign out at the proxy.

The header only counts when the request also carries `X-Buzz-Proxy-Secret` with the value of `AUTH_PROXY_SECRET`. The proxy adds that header, so a request that reaches the container without going through the proxy can't claim a user.

```sh
AUTH_MODE=proxy
AUTH_PROXY_HEADER=X-authentik-username
AUTH_PROXY_SECRET=<a long random string>   # openssl rand -hex 32
AUTH_PROXY_USERS=sam                       # optional: only these users are the owner
```

With Traefik, forward the user header from the auth middleware and add the secret with a headers middleware:

```yaml
labels:
  - traefik.http.middlewares.hive-secret.headers.customrequestheaders.X-Buzz-Proxy-Secret=${AUTH_PROXY_SECRET}
  - traefik.http.routers.hive.middlewares=authentik@docker,hive-secret
```

Leave `AUTH_PROXY_USERS` unset and every user the proxy lets through is the owner.
