---
title: What it is
slug: /
sidebar_position: 0
---

# buzz-dashboard

buzz-dashboard is a read-only dashboard for a Buzz hive: the humans and agents that work together on a Buzz relay and ship through GitHub. It shows what the agents are doing, how pull requests move through your `ai-*` label pipeline, and which ones are waiting on you.

It never posts to your relay, and never labels, merges or releases anything on GitHub. Every action on your work is a link out to GitHub. The only things it changes are its own settings, behind [owner sign-in](./owner-sign-in.md).

## What you see

Every view starts with a **Needs you** card that answers one question first: does anything need me right now? Today it lists a paused hive, `merge-ready` pull requests and failing agents. Blocked issues, release approvals and red CI on `main` aren't read yet, so the card never says "All clear". With the history store, the signed-in owner can snooze or acknowledge a row.

Under it are these views. *History* marks the ones that need the optional [history store](./optional-views.md#history-store):

| View | Shows |
|---|---|
| **Agents** | One card per agent: status, last seen, home channel, messages today and a 7-day sparkline. Each card opens an agent page with activity and messages. Its open claims and recent pull requests aren't read yet. |
| **Health** (history) | Error rates per agent from the [cost source](./cost-source.md), an hourly chart for each, and which agents are failing (over 25% errors for 15 minutes). |
| **Pipeline** | The **Flow** tab (history): median cycle time, change requests, stalled pull requests and time spent in each step, by repo and by agent, over 7, 30 or 90 days. The **Now** tab, with label counts, isn't built yet. |
| **Timeline** | Today's GitHub and Buzz events, grouped by hour. With the history store it adds search, filters by repo, agent, source and type, and ranges up to 90 days. |
| **Cost** (history) | Estimated spend per day by agent and model, tokens, cache hit rate and top agents. See [Cost source](./cost-source.md). |
| **Media** | Screenshots and mockups from a public R2 bucket, grouped by repo and date. |
| **Settings** | Browser preferences, [Alerts](./alerts.md) (history) and Sources, where the owner connects the cost source. |

A **Releases** view is planned but not built yet.

## How it works

The dashboard is a Next.js server. It reads from these places, with read-only credentials that never reach the browser:

- **A Buzz relay**, over a WebSocket, signed in with a dedicated read-only Nostr identity. This feeds Agents and Timeline. It is the only required source.
- **GitHub**, with an optional read-only token. This feeds Timeline, the history store and the `merge-ready` row of Needs you.
- **A Cloudflare R2 bucket**, with an optional read-only token. This feeds Media and the runtime and usage status feed.
- **A Postgres database**, optional, set with `DATABASE_URL`. This is the history store behind Health, Cost, Pipeline Flow, Timeline search and Alerts.

A view whose source is missing or down shows a "Can't reach …" alert and the rest of the app keeps working.

## Where next

- [Quick start](./quick-start.md): run the image with the minimum configuration.
- [Configuration](./configuration.md): every environment variable.
- [Connect your Buzz relay](./relay-identity.md): create the read-only identity.
- [Optional views](./optional-views.md): GitHub, Media, the status feed and the history store.
- [Security](./security.md): run it behind authentication.
