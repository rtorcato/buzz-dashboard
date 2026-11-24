---
title: Event ingest
sidebar_position: 10
---

# Event ingest

Agents and scripts on any platform can post events to the dashboard: a failed turn, a blocked issue, a watcher's note, a release or security verdict. Each event shows on the [Timeline](./optional-views.md) next to GitHub and Buzz activity. Set **Source → Agent events** to see only these, or add `?kind=failed_turn` to the Timeline URL to see one kind.

Event ingest needs the [history store](./optional-views.md#history-store) (`DATABASE_URL`) and a configured relay. Ingested events follow the same retention as every other event (`HISTORY_RETENTION_DAYS`, 90 days by default).

## Tokens: one per platform

Every platform that posts events (for example `buzz`, `claude-code` or `github-actions`) has its own token, so you can rotate or revoke one without touching the others. The server takes the platform from the token. A request body can't set it.

Tokens start with `hive_evt_`. They are separate from the OpenTelemetry token (`hive_otel_`) used by the [cost source](./cost-source.md). Each token is shown once, and the dashboard keeps only its hash.

Each platform also has a **link allowlist**: the exact hostnames an event's `link` may point to. A new platform starts with `github.com` and your relay's host.

Only the owner can manage tokens ([Owner sign-in](./owner-sign-in.md)):

| Call | What it does |
|---|---|
| `GET /api/sources/platforms` | Lists the platforms, with masked tokens and link hosts |
| `POST /api/sources/platforms` `{"platform":"claude-code"}` | Creates or rotates that platform's token. The old token stops working at once. The response holds the full token, and no later response does. An optional `linkHosts` array seeds a new platform's allowlist. A rotation keeps the stored list. |
| `PATCH /api/sources/platforms/<platform>` `{"linkHosts":["github.com"]}` | Replaces the link allowlist (up to 32 hosts) |
| `DELETE /api/sources/platforms/<platform>` | Revokes the token. Events it already posted stay. |

## Posting an event

```sh
curl https://<your dashboard>/api/events \
  -H "Authorization: Bearer $HIVE_EVT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "turn-6f1c",
    "agentId": "6d9c76a1…",
    "agent": "Shockwave",
    "kind": "failed_turn",
    "title": "Turn failed: max_tokens",
    "repo": "owner/repo",
    "link": "https://github.com/owner/repo/pull/12"
  }'
```

| Field | Required | Rule |
|---|---|---|
| `agentId` | Yes | The agent's id on its platform: a Nostr pubkey, a session name, a GitHub actor. 1–128 printable characters, no spaces. |
| `agent` | Yes | Display name, 1–64 characters |
| `kind` | Yes | Lowercase snake case, up to 48 characters, such as `failed_turn`, `blocked`, `note`, `release_verdict` or `security_verdict`. The set is open, so a new kind needs no change on the dashboard. |
| `title` | Yes | 1–200 characters |
| `detail` | No | Up to 4000 characters |
| `id` | No | Idempotency key, `A-Z a-z 0-9 . _ : -`, up to 128 characters. Posting the same `id` again is a no-op. Without one, every post is a new event. |
| `repo` | No | `owner/name`, stored lowercase |
| `link` | No | An `https://` URL of up to 2048 characters, whose host is on the platform's allowlist |
| `occurredAt` | No | An ISO 8601 time with an offset. Defaults to now. It can't be more than 5 minutes in the future or older than the retention window. |

Any other field, including `platform` or `source`, is a 400.

## Responses

A success uses the `@rtorcato/api-common` envelope:

```json
{ "success": true, "data": { "id": "claude-code:turn-6f1c", "duplicate": false } }
```

| Status | When |
|---|---|
| 201 | Stored |
| 200 | Already stored under that `id` (`duplicate: true`) |
| 400 | The JSON is malformed, or the event is invalid. The body lists `issues`. |
| 401 | The token is missing, wrong, rotated or revoked |
| 413 | The body is over 16 KB |
| 415 | The `Content-Type` isn't `application/json` |
| 429 | More than 30 requests a minute on this token. Retry after the `Retry-After` seconds. |
| 503 | The database is unavailable. Retry later. |

An error body is `{ "error", "code", "message" }`.
