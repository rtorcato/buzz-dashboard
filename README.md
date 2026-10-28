<!-- brand-kit:banner:start -->
<picture>
  <source media="(max-width: 640px)" srcset="./brand/banner-mobile.png">
  <img src="./brand/banner.png" alt="buzz-dashboard banner" width="1600">
</picture>
<!-- brand-kit:banner:end -->

# buzz-dashboard

[<img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" height="40">](https://buymeacoffee.com/rtorcato)

A self-hosted, read-only dashboard for a [Buzz](https://buzz.xyz) hive. It shows
what your agents are doing and which pull requests are waiting on you. It never
posts to your relay, and never labels, merges or releases anything on GitHub.
Every action on your work is a link out to GitHub. The only things it changes
are its own settings, behind [owner sign-in](#owner-sign-in).

[Buzz](https://buzz.xyz) is a messaging app where people and AI agents work
together in channels. It runs on a Nostr relay, and each agent has its own
Nostr identity. A **hive** is your set of agents on one relay, usually shipping
code through GitHub.

**Who it's for:** you run several Buzz agents that open issues and pull
requests, and you want one page that answers "does anything need me right
now?" without scrolling every channel.

## What works today

| View | Status | Shows |
|---|---|---|
| **Needs you** card | Live | A paused hive, `merge-ready` pull requests and failing agents. Sits on top of every view. Blocked issues, release approvals and red CI on `main` aren't read yet, so the card never says "All clear". With the history store, the signed-in owner can snooze or acknowledge a row. |
| **Agents** | Live | One card per agent: status, last seen, home channel, messages today and a 7-day sparkline. Each card opens an agent page. The page's open claims and recent pull requests aren't read yet. |
| **Health** | Live, history | Error rates per agent from the [cost source](https://docs.torcato.dev/buzz-dashboard/docs/cost-source), an hourly chart for each, and which agents are failing (over 25% errors for 15 minutes). |
| **Pipeline** | Partly built | The **Flow** tab (history): median cycle time, change requests, stalled pull requests and time spent in each step, by repo and by agent, over 7, 30 or 90 days. The **Now** tab (label counts) is a placeholder. |
| **Timeline** | Live | Today's GitHub and Buzz events, grouped by hour. With the history store it adds search across messages, issues, pull requests and labels, filters by repo, agent, source and type, and ranges up to 90 days. |
| **Cost** | Live, history | Estimated spend per day by agent and model, tokens, cache hit rate and top agents, from OpenTelemetry or the owner's signer. Cost per channel with the signer. |
| **Media** | Live | Screenshots and mockups from an R2 bucket, grouped by repo and date. |
| **Settings** | Live | **General**: browser preferences such as theme, density, start view and pinned agents. **Alerts** (history): send Needs-you rows to ntfy, Slack or a webhook. **Sources**: what each source reports, and where the owner connects the cost source. |
| **Releases** | Placeholder | Not built yet. |

*History* means the view needs the optional Postgres
[history store](#6-a-postgres-database-optional) (`DATABASE_URL`). Without it,
Health and Cost leave the sidebar, Pipeline shows only Now, and Alerts and
snoozing are off.

## Quick start

You need Docker and a Buzz relay you can reach. Pin a published image tag, then
point it at an env file.

1. Download [`.env.example`](.env.example) as `.env` and fill in the three
   required relay settings. [Get your credentials](#get-your-credentials) shows
   where each one comes from.

   ```sh
   BUZZ_RELAY_URL=wss://relay.example.com
   BUZZ_PRIVATE_KEY=<64-char hex key of a dedicated identity>
   BUZZ_OWNER_PUBKEY=<hex pubkey of your agents' owner>
   ```

2. Run the image:

   ```sh
   docker run -d --name buzz-dashboard \
     --env-file .env \
     -p 127.0.0.1:3000:3000 \
     --cap-drop ALL --security-opt no-new-privileges:true \
     ghcr.io/rtorcato/buzz-dashboard:<tag>
   ```

3. Open `http://localhost:3000`, or check it from the shell:

   ```sh
   curl -s http://localhost:3000/api/health   # {"ok":true}
   ```

The port is bound to `127.0.0.1` on purpose. Reading needs no login (owner
sign-in only guards the dashboard's own settings), so read
[Self-host](#self-host) before you expose it.

### Or with Compose

No clone needed. Put this next to your `.env`:

```yaml
# compose.yaml
services:
  dashboard:
    image: ghcr.io/rtorcato/buzz-dashboard:<tag>
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:3000:3000"
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
```

```sh
docker compose up -d
```

### Image tags

The `Publish image` workflow pushes `ghcr.io/rtorcato/buzz-dashboard` for
`linux/amd64`:

| Tag | When |
|---|---|
| `sha-<short>` | Every push to `main` |
| `vX.Y.Z` | Every semver `v*` tag, including prereleases like `v1.0.0-rc.1` |
| `latest` | Every non-prerelease semver `v*` tag |

Pin a `sha-` or `vX.Y.Z` tag so every upgrade is a deliberate edit.

## Get your credentials

Only the relay is required. GitHub and R2 each switch on more of the dashboard,
and a missing source shows a "Can't reach …" alert while the rest keeps working.

### 1. A dedicated Buzz identity (required)

Create a new Nostr keypair just for the dashboard. Don't reuse your own key or
an agent's. Any Nostr key tool works. With
[`nak`](https://github.com/fiatjaf/nak):

```sh
nak key generate            # private key, 64 hex chars → BUZZ_PRIVATE_KEY
nak key public <that-key>   # its pubkey, for step 2
```

The key must be plain hex, not an `nsec`. The dashboard only signs the relay's
NIP-42 `AUTH` challenge and never posts, so this identity needs no write
access.

### 2. Let it past relay auth (required)

The relay refuses every query until the connection authenticates. Pick one:

- **Make it a relay member** (simplest). Add the pubkey from step 1 as a member
  of your relay. Nothing else is needed.
- **Give it a NIP-OA owner attestation.** If you can't add members, a relay
  member can sign a tag that vouches for the dashboard's key. Put the tag in
  `BUZZ_AUTH_TAG` as JSON:

  ```sh
  BUZZ_AUTH_TAG=["auth","<owner-hex>","<conditions>","<sig>"]
  ```

### 3. Your owner pubkey (required)

A relay holds people and agents alike. The dashboard counts a profile as an
agent only when it carries a valid NIP-OA attestation from your **owner** key:
the identity your agents were created under, usually your own Buzz account. Set
its hex pubkey in `BUZZ_OWNER_PUBKEY`. If you have an `npub`, `nak decode
<npub>` gives the hex.

If you set `BUZZ_AUTH_TAG`, the owner in the tag is the default, so one of the
two is enough.

### 4. A GitHub token (optional)

Feeds the GitHub rows of Needs you. Create a **fine-grained personal access
token**:

- Repository access: only the repositories you want shown.
- Repository permissions: **Metadata**, **Issues**, **Pull requests**,
  **Actions** and **Deployments**, all *Read*. Nothing else.

Then set `GITHUB_OWNERS` to the users or orgs that own those repositories, and
`GITHUB_TRUSTED_AUTHORS` to the logins your agents post as (see
[Built for repo-ai's ai-loop](#built-for-repo-ais-ai-loop)).

### 5. An R2 bucket (optional)

Feeds the Media tab and the [status feed](#the-status-feed). Create a Cloudflare
R2 API token with **Object Read** only, scoped to that one bucket, and set all
five `MEDIA_BASE_URL` and `R2_*` variables. Media keys are expected as
`<repo>/<YYYY-MM-DD>/<file>`.

### 6. A Postgres database (optional)

Feeds the history store behind Health, Cost, Pipeline Flow, Timeline search,
Alerts and snoozing. Set `DATABASE_URL` to an empty Postgres database the
dashboard can own. On start it applies its migrations, then stores GitHub and
Buzz events every minute and drops those older than `HISTORY_RETENTION_DAYS`
(90 by default). Cost also needs a cost source, connected in Settings → Sources
(see [Cost source](https://docs.torcato.dev/buzz-dashboard/docs/cost-source)).

## Configuration

All configuration is environment-only and read on the server. Tokens never
reach the browser, and an empty value counts as unset. See
[`.env.example`](.env.example).

| Variable | Required | Purpose |
|---|---|---|
| `BUZZ_RELAY_URL` | Yes | WebSocket URL of your Buzz relay, e.g. `wss://relay.example.com` |
| `BUZZ_PRIVATE_KEY` | Yes | 64-char hex private key of the dashboard's dedicated identity |
| `BUZZ_OWNER_PUBKEY` | This or `BUZZ_AUTH_TAG` | Hex pubkey of your agents' owner. Defaults to the owner in `BUZZ_AUTH_TAG`, and wins when both are set |
| `BUZZ_AUTH_TAG` | If the identity isn't a relay member | NIP-OA owner attestation JSON |
| `AUTH_MODE` | No | Owner sign-in for the dashboard's own writes: `nostr` (NIP-07 extension, allowed keys are `BUZZ_OWNER_PUBKEY`, which may be a comma list) or `proxy`. Unset, sign-in is off and nothing can write. See [Owner sign-in](https://docs.torcato.dev/buzz-dashboard/docs/owner-sign-in) |
| `AUTH_PUBLIC_URL` | With `AUTH_MODE=nostr` | The URL you open the dashboard at, e.g. `https://hive.example.com`. Sign-in events must be signed for it. Without it Nostr sign-in stays off |
| `AUTH_PROXY_HEADER`, `AUTH_PROXY_SECRET` | With `AUTH_MODE=proxy` | The header your proxy names the user in, and the secret it sends as `X-Buzz-Proxy-Secret`. The user header only counts with that secret |
| `AUTH_PROXY_USERS` | No | Comma list of proxy users who are the owner. Unset, anyone the proxy lets through is |
| `GITHUB_TOKEN` | No | Fine-grained, read-only GitHub token. Without it the GitHub-backed views show "Can't reach GitHub" |
| `GITHUB_OWNERS` | With `GITHUB_TOKEN` | Comma list of GitHub users or orgs to read, e.g. `octo-org,octo-labs`. No default |
| `GITHUB_TRUSTED_AUTHORS` | No | Comma list of logins whose agent header counts, e.g. `octo-bot,octocat`. Unset trusts nobody, so everything shows as unattributed |
| `MEDIA_BASE_URL` | No | Public `https` URL of the media bucket |
| `R2_ACCOUNT_ID`, `R2_BUCKET` | No | Cloudflare account ID and the R2 bucket behind `MEDIA_BASE_URL` |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | No | S3 credentials of an R2 API token with Object Read only on that bucket |
| `AGENT_ALIASES` | No | JSON of renamed agents, former → current display name, e.g. `{"Fizz":"Prime"}`. The old profile folds into the current name and `/agents/<old-name>` redirects |
| `NEEDS_YOU_EXCLUDE_LABELS` | No | Comma list of labels to leave off Needs you. Set it to `merge-ready` if a merge bot handles those PRs |
| `DATABASE_URL` | No | Postgres URL of the optional history store, e.g. `postgres://hive:hive@127.0.0.1:5432/hive`. Unset keeps the live-only dashboard with the history views hidden. See [Local dev with history](#local-dev-with-history) |
| `HISTORY_RETENTION_DAYS` | No | Days of history to keep. Defaults to 90 |
| `TZ` | No | Time zone for "today" on the Agents view, e.g. `America/Toronto`. Defaults to the server clock |

The five `MEDIA_BASE_URL` and `R2_*` variables go together: if any is missing,
Media shows an alert and the status feed counts as not reported.

## Self-host

Reading needs no login. Anyone who can reach the port sees your agents'
messages and your pull requests. Put an access layer in front before you route
a hostname to it. [SECURITY.md](SECURITY.md) has the full checklist.

**Tailscale** (tailnet-only access):

```sh
tailscale serve --bg 3000   # https://<host>.<tailnet>.ts.net
```

Restrict who can reach the host with your tailnet ACLs.

**Cloudflare Access** (public hostname behind SSO):

1. Create a tunnel with `cloudflared tunnel create buzz-dashboard`, then route a
   hostname to `http://localhost:3000`.
2. In Zero Trust → Access → Applications, add a self-hosted app for that
   hostname with an allow policy for your identity.

Do step 2 before the tunnel goes live.

**Behind a reverse proxy.** Let the proxy reach the container over a shared
Docker network instead of publishing a host port. With Traefik on an external
`proxy` network:

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

The container listens on port 3000, terminates no TLS, and runs as the non-root
`node` user.

### Owner sign-in

Sign-in is separate from your access layer. It guards only the dashboard's own
writes: snoozing and acknowledging Needs-you rows, alert channels and rules,
and the cost source. Set `AUTH_MODE` to turn it on:

- **`nostr`**: you sign a one-time challenge with a NIP-07 browser extension.
  The allowed keys are `BUZZ_OWNER_PUBKEY`, and `AUTH_PUBLIC_URL` must be the
  URL you open the dashboard at.
- **`proxy`**: a reverse proxy that already signs you in (Authentik forward
  auth, for example) names the user in `AUTH_PROXY_HEADER` and sends
  `AUTH_PROXY_SECRET` as `X-Buzz-Proxy-Secret`. `AUTH_PROXY_USERS` limits who
  counts as the owner.

Unset, sign-in is off and those controls stay read-only. See
[Owner sign-in](https://docs.torcato.dev/buzz-dashboard/docs/owner-sign-in).

## Built for repo-ai's ai-loop

The GitHub views read the label and comment conventions of
[repo-ai](https://github.com/rtorcato/repo-ai)'s ai-loop. Your agents don't
have to run repo-ai, but they need to follow the same conventions for the
pipeline to show up.

**Labels:**

| Label | On | Meaning |
|---|---|---|
| `ai-ready` | issue | Eligible for an agent |
| `ai-wip` | issue | Claimed by an agent |
| `ai-review` | pull request | Waiting for review |
| `ai-changes` | pull request | A reviewer asked for changes |
| `ai-blocked` | issue | The agent gave up and needs a human |
| `merge-ready` | pull request | Reviewed and waiting for a merge |

**Agent header.** An agent is named from the line its comments and PR bodies
open with: a robot emoji, then the agent's name in backticks, e.g.

```text
🤖 *Automated — `@Name` 🐝 (Buzz agent) via ai-loop.*
```

A claim is a comment with that header saying `Claimed by`. The header only
counts when a login in `GITHUB_TRUSTED_AUTHORS` wrote it, because anyone can
paste one into a public repository. Pull requests without a trusted header show
as "Unattributed".

## The status feed

Agent runtime state (running or stopped, last turn, model) and the "Paused for
usage" Needs-you row come from one optional JSON file, `hive/status.json`, in the same
R2 bucket as Media. A script on the machine that runs your agents publishes it,
say every 5 minutes. The dashboard ships no publisher, so you write your own
against this contract:

```json
{
  "version": 1,
  "published_at": "2026-10-16T19:40:00Z",
  "runtime": {
    "<hex pubkey>": {
      "name": "Bumble",
      "state": "running",
      "since": "2026-10-16T13:28:00Z",
      "last_turn": "2026-10-16T19:36:00Z",
      "model": "claude-opus-5-5"
    }
  },
  "usage": {
    "five_h": 92,
    "seven_d": 61,
    "paused": true,
    "five_h_resets_at": "2026-10-16T21:00:00Z",
    "seven_d_resets_at": "2026-10-18T12:00:00Z",
    "five_h_pause_at": 90,
    "seven_d_pause_at": 95
  }
}
```

| Field | Rule |
|---|---|
| `version` | Schema version, `1`. Any other version counts as not reported. |
| `published_at` | ISO time. Older than 10 minutes and the feed shows as stale, with its age. |
| `runtime` | Optional. Keyed by hex pubkey. `state` is `running` or `stopped`; `since` is when it entered that state. `last_turn` and `model` may be `null`. An agent with no entry falls back to relay activity. |
| `usage` | Optional. Percentages are integers 0-100. Both `*_resets_at` may be `null`. Leave it out and the chip reads "Usage not reported". |
| `*_pause_at` | Optional. The pause thresholds drawn on the chip. Leave one out and that tick is hidden. |

Never put secrets, environment values or log contents in the feed.

## Develop

```sh
cp .env.example .env.local   # fill in the credentials
pnpm install
pnpm dev                     # http://localhost:3000
```

Node 24 and pnpm. Stack: Next.js (App Router), TypeScript, Tailwind and
shadcn/ui, built as a `standalone` server for a single Docker image.

```sh
pnpm lint        # Biome
pnpm typecheck   # tsc
pnpm test        # Vitest
pnpm build       # next build (standalone output)
```

CI runs all four on every pull request and push to `main`.

### Local dev with history

The history store (Timeline search, Health, Cost, Alerts, the Pipeline Flow
tab) is optional Postgres. Without `DATABASE_URL`, `pnpm dev` runs the
live-only dashboard and never touches Docker.

1. Set `DATABASE_URL=postgres://hive:hive@127.0.0.1:5432/hive` in
   `.env.local` (the commented line in `.env.example`).
2. Run `pnpm dev`. When `DATABASE_URL` points at this machine, `predev` runs
   `docker compose up -d --wait postgres` first, and stops with a one-line
   error if Docker isn't running. Running `docker compose up -d postgres`
   yourself beforehand is optional.
3. On start the server applies any pending migrations from `drizzle/`, then
   ingests GitHub and Buzz events every minute and drops events older than
   `HISTORY_RETENTION_DAYS` (90 by default).

The `postgres` service binds to `127.0.0.1:5432` only and keeps its data in
the `hive-history` volume. It sits behind the `history` compose profile, so a
plain `docker compose up` doesn't start it. Run `docker compose --profile
history up -d` for both services, with `DATABASE_URL` in `.env` pointing at
`postgres:5432`. Set `POSTGRES_PASSWORD` for anything reachable beyond your
machine.

```sh
pnpm db:generate   # write a migration after changing src/lib/history-schema.ts
pnpm db:migrate    # apply migrations by hand (the server also does it on start)
pnpm db:studio     # browse the store in Drizzle Studio
```

Commit the migration in the same change as the schema edit. CI runs
`pnpm db:generate` and fails if anything under `drizzle/` changes.

`pnpm-workspace.yaml` sets `verifyDepsBeforeRun: install`, so `pnpm dev` and
the other scripts reinstall first when `node_modules` is behind the lockfile.

### Docs screenshots

The docs site's screenshots in `apps/docs/static/img/screens/` come from the
real views running on made-up sample data (`src/lib/sample-data.ts`).
Regenerate the whole set after a UI change with:

```sh
pnpm exec playwright install chromium   # once
pnpm screens
```

It starts `next dev` with `BUZZ_SAMPLE_DATA=1` on port 3123 (`SCREENS_PORT`
to change it), captures each view in light and dark, writes WebP, and stops
the server. Sample data never loads in a production build, so setting the
variable on a deployed image does nothing.

To build and run your own image from a clone, `docker compose up -d --build`
uses the repository's [`compose.yaml`](compose.yaml).
`./scripts/docker-dev.sh` wraps the same flow, and `./scripts/docker-dev.sh
logs` and `./scripts/docker-dev.sh down` follow and stop it.

## Security

Read [SECURITY.md](SECURITY.md) before you deploy, and use it to report a
vulnerability privately.

## Alternatives

[assafshafran/buzz-agent-fleet](https://github.com/assafshafran/buzz-agent-fleet)
runs Buzz agents as systemd services on a VPS and ships a small Python portal
that can also manage agents (create, edit, start, stop) and show a live
tool-activity feed. buzz-dashboard is read-only by design.

## License

[MIT](LICENSE)
