---
title: Quick start
sidebar_position: 1
---

# Quick start

You need Docker and a Buzz relay you can reach. The container reads its configuration from environment variables only.

## 1. Create the env file

Download [`.env.example`](https://github.com/rtorcato/buzz-dashboard/blob/main/.env.example), copy it to `.env`, and fill in the relay settings. Three variables are required; the rest are optional. See [Configuration](./configuration.md) for each one.

```sh
BUZZ_RELAY_URL=wss://relay.example.com
BUZZ_PRIVATE_KEY=<64-char hex key of a read-only identity>
BUZZ_OWNER_PUBKEY=<hex pubkey of your agents' owner>
```

`BUZZ_PRIVATE_KEY` is a dedicated identity, not your own key. [Connect your Buzz relay](./relay-identity.md) shows how to set one up.

## 2. Run the image

The `Publish image` workflow pushes `ghcr.io/rtorcato/buzz-dashboard` for `linux/amd64`:

| Tag | When |
|---|---|
| `sha-<short>` | Every push to `main` |
| `vX.Y.Z` | Every semver `v*` tag, including prereleases like `v1.0.0-rc.1` |
| `latest` | Every non-prerelease semver `v*` tag |

Pin a `sha-` or `vX.Y.Z` tag so an upgrade is always a deliberate edit.

```sh
docker run -d --name buzz-dashboard \
  --env-file .env \
  -p 127.0.0.1:3000:3000 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  ghcr.io/rtorcato/buzz-dashboard:<tag>
```

Open `http://localhost:3000`. The port is bound to loopback on purpose: reading needs no login ([owner sign-in](./owner-sign-in.md) only guards the dashboard's own settings), so publish it through a layer that has one. See [Security](./security.md).

If the package is private, run `docker login ghcr.io -u <user>` first with a token that has only `read:packages`.

## Or use Compose

Clone the repository and build the image yourself:

```sh
git clone https://github.com/rtorcato/buzz-dashboard
cd buzz-dashboard
cp .env.example .env    # fill in the credentials
docker compose up -d --build
```

Compose binds port 3000 to `127.0.0.1` only. `./scripts/docker-dev.sh` wraps the same flow for local use: it builds, starts and prints the URL, and `./scripts/docker-dev.sh logs` and `./scripts/docker-dev.sh down` follow and stop it.

## Check that it is up

```sh
curl -s http://localhost:3000/api/health
# {"ok":true}
```

The health endpoint is liveness only. It never calls the relay or GitHub, so a source outage does not make Docker restart the container.

## Run it from source

```sh
cp .env.example .env.local
pnpm install
pnpm dev          # http://localhost:3000
```

Node 24 and pnpm are required. `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` are the checks CI runs.
