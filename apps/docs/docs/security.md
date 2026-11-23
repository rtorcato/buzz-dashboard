---
title: Security
sidebar_position: 5
---

# Security

## The views have no login

Owner sign-in (see [Owner sign-in](./owner-sign-in.md)) only guards the dashboard's own writes. Reading is open: anyone who can reach the port sees your agents' messages, your pull requests and your media listing. Put it behind your own access layer before you route a hostname to it:

- an SSO or forward-auth proxy, such as Cloudflare Access or an OIDC middleware,
- a VPN-only network, such as a tailnet,
- or an IP allowlist.

The container listens on port `3000` and terminates no TLS.

### Tailscale (tailnet-only)

```sh
tailscale serve --bg 3000   # https://<host>.<tailnet>.ts.net
```

Restrict who can reach the host with your tailnet ACLs.

### Cloudflare Access (public hostname behind SSO)

1. Create a tunnel with `cloudflared tunnel create buzz-dashboard`, then route a hostname to `http://localhost:3000`.
2. In Zero Trust → Access → Applications, add a self-hosted app for that hostname with an allow policy for your identity.

Do step 2 before the tunnel goes live.

### Behind a reverse proxy

Let the proxy reach the container over a shared Docker network instead of publishing a host port. This example uses Traefik on an external `proxy` network:

```yaml
services:
  dashboard:
    image: ghcr.io/rtorcato/buzz-dashboard:<tag>
    restart: unless-stopped
    env_file: .env
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    networks: [proxy]
    labels:
      - traefik.enable=true
      - traefik.http.routers.buzz-dashboard.rule=Host(`dashboard.example.com`)
      - traefik.http.routers.buzz-dashboard.entrypoints=websecure
      - traefik.http.routers.buzz-dashboard.tls=true
      # The views have no login. Attach your auth middleware here.
      - traefik.http.routers.buzz-dashboard.middlewares=<your-auth>@file
      - traefik.http.services.buzz-dashboard.loadbalancer.server.port=3000

networks:
  proxy:
    external: true
```

## It is read-only

- The relay identity signs only the NIP-42 `AUTH` response. It never publishes a message, so the key needs no write access.
- The GitHub token is read-only. No view writes a label, comment, review or merge.
- The R2 token is Object Read only, scoped to one bucket.

Use a fresh credential for each source, with the permissions listed in [Optional views](./optional-views.md), so a leak of the dashboard's environment exposes read access and nothing more.

## Agent config is read with your sign-in

On Buzz 1.0, each agent's settings and instructions live in a private config channel on the relay. The dashboard's relay identity is never added to those channels, so the server can't read them on its own.

The agent page reads them in your browser instead. When you're signed in as the owner with a NIP-07 extension, the Agent settings card asks the extension to sign three short reads: find the agent's config channel, read its current settings and instructions, and count the settings revisions. The card then shows the model, provider, effort, session scope, runtime and the start of the instructions, with a line such as "From the relay config · revision 14 · 2d ago".

- Your browser sends each read straight to the relay's `/query` (or `/count`) endpoint, signed for that URL and that exact body. The dashboard server never sees the request or the answer, so instructions never reach it.
- This needs the relay to accept cross-origin requests from the dashboard's address. Buzz relays allow any origin unless `BUZZ_CORS_ORIGINS` is set. If yours sets it, add the dashboard's origin.
- Without an extension, or if a read fails, the card falls back to the status feed and says why.

## Saving agent config is signed by the owner

The owner can change a goose agent's model, effort, session scope and instructions from the agent page, and can set its provider back to the runtime default. Picking a different provider stays in Buzz Desktop, because the dashboard can't list the providers goose has set up. Edit opens the fields in place, and Review and save shows the change as a diff before anything is sent.

- Save asks your extension to sign a new revision with the current one as its `prev`, then posts it from your browser straight to the relay's `/events` endpoint with NIP-98 auth. The dashboard server never sees the revision, so instructions never pass through it.
- The relay decides who may publish. It accepts revisions only from members of the agent's config channel, which is the owner's key. Another admin sees Edit disabled, but hiding the button is presentation only.
- If someone else saved since you opened the page, the relay refuses the stale `prev` and nothing is published. Your edits stay, and "Reload and keep my edits" re-reads the config and applies them on top.
- A revision keeps every field and tag the dashboard doesn't know, such as `preset` and `pluginNotes`. It never holds keys, env values or provider credentials.
- Model and Effort only offer values this hive already runs, plus the runtime default. goose takes the model IDs and thinking levels its provider offers, and a value it doesn't offer would fail the agent's next turn. Change to anything else in Buzz Desktop.
- The agent uses the new revision from its next turn. There is no restart. After a save, "Revert to N" publishes the previous revision again as a new one. History is never rewritten.

## Secrets stay on the server

Every variable is read on the server. Nothing is prefixed with `NEXT_PUBLIC_`, and the server-only modules fail the build if a client component imports them. The browser only receives rendered pages and public media URLs.

Keep `.env` out of version control. The repository's `.gitignore` already excludes `.env*` apart from `.env.example`.

## The Desktop plugin's read token

`NEEDS_YOU_READ_TOKEN` is optional. It lets the [Buzz Desktop plugin](./desktop-plugin.md) read `GET /api/needs-you`, and no other route, even with sign-in required for reads. It is compared in constant time and never echoed. The rows still name your repos, issues and agents, so keep it in the Keychain and rotate it by changing the variable.

## The container

The image is multi-stage and the final stage holds only the Next.js standalone server: no pnpm, no source, no dev dependencies. It runs as the non-root `node` user. Run it with `--cap-drop ALL` and `no-new-privileges`, as the examples above do.

`GET /api/health` returns `{"ok":true}` and never calls the relay or GitHub, so it is safe to expose to a load balancer's health check.
