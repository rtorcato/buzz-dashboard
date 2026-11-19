---
title: Cost source
sidebar_position: 7
---

# Cost source

The Cost view shows what your agents spend per day, split by agent and model: estimated cost, tokens, cache hit rate and the top agents. A cost chip in the header shows the estimated cost so far today. Both stay hidden until a cost source is connected, and they never show a guessed number.

Every dollar figure is **estimated, at API list price**. That's the price the API would charge for the same tokens, not what a subscription plan bills. Token counts are exact.

Cost needs the [history store](./optional-views.md#history-store), because the reports are kept in Postgres. Without `DATABASE_URL` there is no Cost view and no cost source.

## OpenTelemetry

Each Claude Code agent sends its own token and cost reports straight to the dashboard over OpenTelemetry (OTLP/HTTP). No key leaves the machine the agents run on. It works for Claude Code agents only, for now.

1. **Sign in as the owner** ([Owner sign-in](./owner-sign-in.md)). Only the owner can connect a cost source.
2. **Create an ingest token** in **Settings → Sources**. Agents send it with every report, so nobody else who can reach the dashboard can post numbers. It's shown once: copy it before you leave the page. The dashboard keeps only its hash.
3. **Add this to each agent's environment** in Buzz Desktop, then restart the agent. Settings → Sources shows the block with your dashboard's address filled in, and with the token right after you create it.

```sh
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your dashboard>/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <your ingest token>
OTEL_RESOURCE_ATTRIBUTES=agent=<agent name>
```

The agent name must match the agent's Buzz display name, so its cost joins the right agent. A report without it shows as "Unattributed".

Agents must be able to reach the endpoint. Claude Code exports every minute, so the first numbers show up a minute or so after an agent's first turn. The Agents table in Settings → Sources lists each agent with its last report, and flags any agent that hasn't reported in the last hour.

### What the dashboard reads

The endpoint (`/otlp/v1/metrics`) takes two Claude Code metrics and ignores the rest:

- `claude_code.cost.usage`: the estimated cost of each API request, by model.
- `claude_code.token.usage`: input, output, cache read and cache creation tokens, by model.

It keeps the agent name, the model, the token type and the amount. It doesn't store any other attribute, such as the session id, account or email; it only uses them, hashed, to tell two reports at the same moment apart. Reports older than `HISTORY_RETENTION_DAYS` are deleted with the rest of the history.

The logs endpoint (`/otlp/v1/logs`, from `OTEL_LOGS_EXPORTER=otlp`) feeds Health's error rate. It takes two Claude Code events and drops every other log record:

- `api_request`: one per API request. It keeps the agent, the model and the time.
- `api_error`: one per failed request. It keeps the agent, the model, the time and the HTTP status code.

It never stores a prompt, a response or an error message. With OpenTelemetry the rate is errors per API request; the owner signer's per-turn reports give errors per turn instead. Leave `OTEL_LOGS_EXPORTER` out and Health shows no error rates for that agent; cost is unaffected.

Claude Code sends delta values by default. Leave `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` unset: the dashboard ignores cumulative reports, since counting them would add the same spend again on every export.

### The ingest token

- A report without a valid token gets a `401` with no detail. The token only lets an agent post metrics and log events. It can't read anything.
- **Rotate** in Settings → Sources makes a new token and stops the old one at once. Every agent's reports stop until you paste the new token into its environment.
- If you lose the token, rotate it. It can't be shown again.

## Owner signer (NIP-46)

Buzz already publishes a report for every agent turn (NIP-AM, `kind:44200`): tokens, an estimated cost, the model and the turn's channel. It works for every harness, with no agent changes. The relay serves those reports only to the hive owner, encrypted to the owner's key, so the dashboard can read them only through the owner's own Nostr signer: a NIP-46 "bunker" such as nsec.app, Amber, or a bunker on your own machine.

**It's off by default, and OpenTelemetry is the recommended source.** Read the trade-off before you turn it on.

### The trade-off: your signer could decrypt your DMs

A signer can't limit decryption to cost reports. Once it trusts the dashboard, it decrypts whatever the dashboard asks. If the dashboard were ever compromised, an attacker could ask your signer to decrypt your direct messages and anything else encrypted to your key. Your key itself never leaves the signer, and you can revoke the dashboard there at any time.

Use the owner signer only if your agents can't send OpenTelemetry, for example because they don't run Claude Code.

### Connect it

1. **Sign in as the owner** ([Owner sign-in](./owner-sign-in.md)). The signer must sign as a key in `BUZZ_OWNER_PUBKEY`; the dashboard checks that before it saves anything.
2. In your signer app, create a connection and copy its `bunker://` address. Only `bunker://` addresses with a `relay` are accepted, and the dashboard must be able to reach that relay.
3. In **Settings → Sources**, pick **Owner signer**, paste the address, tick the box that you understand the trade-off, and choose **Connect signer**. Approve the request in your signer app if it asks.

The dashboard keeps the signer's public key and relays, and a client key of its own that the signer knows it by. It doesn't keep the address's one-time secret, and the page never shows the address again. That client key is stored in the history database encrypted with a key derived from `BUZZ_PRIVATE_KEY`, so a copy of the database alone can't talk to your signer. Anyone who has both can, until you revoke the dashboard. Rotating `BUZZ_PRIVATE_KEY` disconnects the signer; connect it again.

In your signer app, have it ask before it decrypts for the dashboard, or limit what the dashboard's connection may do, if the app lets you.

### What it reads

Every minute, the dashboard signs in to the Buzz relay as you (your signer signs the relay's AUTH challenge), reads new turn reports, and asks the signer to decrypt each one. It checks every report's signature and that it came from an agent to you. It stores the agent, model, channel, tokens and estimated cost in the history database, the same way as OpenTelemetry reports, and skips reports it has already stored, so each turn is decrypted once.

- The first read starts after the newest report already stored, or `HISTORY_RETENTION_DAYS` back when there is none, so turns OpenTelemetry already counted aren't counted again. A big backlog is read 400 turns a minute.
- Per-turn reports carry the turn's channel, so the Cost view's **Cost per channel** card fills in.
- A report the signer can't decrypt, or whose numbers the agent couldn't measure, is skipped.

### Switch back

Pick **OpenTelemetry** in Settings → Sources and confirm. The dashboard forgets the signer at once. That doesn't revoke it in the signer app, so remove the dashboard there too.

## One cost source at a time

Settings → Sources keeps the two sources to one at a time, so the numbers never double-count. While the owner signer is the source, the OpenTelemetry endpoint refuses every report with a `401`, even with a valid ingest token. The token is kept, so switching back needs no agent changes.

## Not per issue

Cost is per agent, per model and per day. It isn't per issue: a report knows which agent and model it came from, not which issue the agent was working on. Cost per channel needs per-turn reports, which OpenTelemetry doesn't send, so with OpenTelemetry it shows as not connected.
