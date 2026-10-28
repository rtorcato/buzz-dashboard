---
title: Optional views
sidebar_position: 4
---

# Optional views

The relay is the only required source. GitHub, R2 and Postgres each add views, and each fails on its own: when one is missing or down, an alert names it and the rest of the app keeps working.

## GitHub

`GITHUB_TOKEN` feeds the GitHub events on Timeline, the pull requests the history store keeps for Pipeline Flow, and the `merge-ready` row of the Needs-you card.

Create a **fine-grained personal access token** with read-only access and nothing else:

- Repository permissions: **Metadata**, **Issues**, **Pull requests**, **Actions** and **Deployments**, all set to *Read*.
- Repository access: only the repositories you want shown.

The dashboard reads the `ai-*` labels on issues and pull requests, so it expects a pipeline like this one:

| Label | On | Meaning |
|---|---|---|
| `ai-ready` | issue | Eligible for an agent. |
| `ai-wip` | issue | Claimed by an agent. |
| `ai-review` | pull request | Waiting for review. |
| `ai-changes` | pull request | A reviewer asked for changes. |
| `ai-blocked` | issue | The agent gave up and needs a human. |
| `merge-ready` | pull request | Reviewed and waiting for a merge. |

An agent is named from the header its comments and pull request bodies open with: a robot emoji, then the agent's name in backticks, as in `🤖 *Automated — `@Name` 🐝 (Buzz agent)*`. Pull requests without that header are listed under "Unattributed". The header only counts when a login in `GITHUB_TRUSTED_AUTHORS` wrote it, because anyone can paste a header into a public repository. Leave it unset and nothing is attributed.

`GITHUB_OWNERS` sets which users or orgs the dashboard reads. See [Configuration](./configuration.md#github-optional).

## Media and the status feed

Five variables point the dashboard at one Cloudflare R2 bucket: `MEDIA_BASE_URL`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. The bucket feeds two things.

### Media tab

The server lists the bucket with a read-only S3 token, and the browser loads files from the public `MEDIA_BASE_URL`. Keys are expected as `<repo>/<YYYY-MM-DD>/<file>`; anything else is grouped under "other".

Create the R2 API token with **Object Read only**, scoped to this one bucket. The dashboard never writes to it.

`MEDIA_BASE_URL` must be an `https` URL.

### Status feed

Runtime state and usage meters come from one JSON file, `hive/status.json`, in the same bucket. A script on the machine that runs your agents publishes it, for example every 5 minutes. The dashboard reads it on the server and shows the result on the Agents cards, the Agent page and the "Paused for usage" row in Needs you. It must not contain secrets, environment values or log contents.

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

- `version` is the schema version, `1` today. A feed with a version the dashboard does not know counts as not reported.
- `runtime` is keyed by hex pubkey. `state` is `running` or `stopped`, and `since` is when it entered that state. `last_turn`, `model` and both reset times may be `null`.
- Percentages are integers from 0 to 100. Either `*_pause_at` may be missing, and the "Paused for usage" row then drops that threshold.
- Leave out `usage` and there is no "Paused for usage" row. An agent with no `runtime` entry is "not reported", and its card falls back to relay activity.
- The feed is **stale** when `published_at` is more than 10 minutes old. Stale data is still shown, with its age.

The feed is optional. Without it the dashboard still runs, and the runtime row says "not reported".

## History store

`DATABASE_URL` points the dashboard at a Postgres database it can own, e.g. `postgres://hive:hive@127.0.0.1:5432/hive`. It feeds:

- **Health** and **Cost**, which only appear with it,
- the **Flow** tab of Pipeline,
- search, filters and ranges up to 90 days on **Timeline**,
- [Alerts](./alerts.md) and snoozing Needs-you rows.

On start the server applies its migrations, then stores GitHub and Buzz events every minute and deletes those older than `HISTORY_RETENTION_DAYS` (90 by default). Without `DATABASE_URL` the dashboard stays live-only and never opens a connection. Health and Cost also need a [cost source](./cost-source.md).
