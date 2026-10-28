# DESIGN.md

The design spec for buzz-dashboard. Read it before writing any UI code, and keep the UI in step with it. If the UI needs to change, update this file and the mockups in the same PR.

- **Status:** v1, approved by rtorcato on 2026-10-07. UI PRs can build against it.
- **Designer:** Zoey (2026-10-07)
- **Update:** runtime status (#24), the usage meter (#25), the agent page (#27) and Motion, approved by rtorcato on 2026-10-16. They read the status feed (#26), so build them after it.
- **Update:** the fixed sidebar and the Settings page (#58), approved by rtorcato on 2026-10-21.
- **Update:** the docs site home page (see Docs site), approved by rtorcato on 2026-10-22.
- **Update:** history and alerts (#39 to #47): Timeline with Buzz events, Health, Cost, Alerts, Needs-you snooze and ack, the generic Pipeline flow and the cost chip, approved by rtorcato on 2026-10-23. They all read the optional history store (#39), and anything that saves needs owner sign-in (#40), so build those two first.
- **Update:** Settings → Sources (#42, #43), approved by rtorcato on 2026-10-23: connected and not-connected states, the owner-signer confirm dialog, an ingest token on the OTel endpoint, one cost source at a time and no log source in v1.
- **Update:** the Releases view (#71) and the first-run setup wizard (#73), approved by rtorcato on 2026-10-23. The wizard saves to a config store that env always overrides, so build that store first.
- **Mockups:** kept outside the repo and not linked from it. This file is the spec, so build from the text below.

## Principle

It's a glanceable ops screen, and it answers one question first: **"does anything need me right now?"** The **Needs you** card sits above every view and is never hidden behind one. Everything else is detail.

The app is read-only toward the hive. Every action on GitHub, npm or Buzz is an outbound link, marked with the `external-link` icon, and the dashboard never posts to the relay or GitHub. The one exception to "never posts" is the opt-in Buzz DM alert channel (#45), which sends only to the owner with a posting key of its own, never the hive's. The other exception is the dashboard's own state, and only for the signed-in owner (#40): snooze and ack, alert channels and rules, custom stages, and the cost source with its ingest token. Signed out, no button writes anything.

**Without a database** (no `DATABASE_URL`, #39) the dashboard is today's live-only view. Health, Cost and the Pipeline Flow tab leave the sidebar, Timeline shows only the live feed, and Needs you loses its footer, history and snooze/ack. Nothing shows an "add a database" nag.

## Shell (every view)

- **Sidebar** (#58): see Sidebar below. It holds the Hive mark, the views and Settings.
- **Header** (`h-14`, sticky, inside `SidebarInset`): the `SidebarTrigger`, a 1px divider and the current view's title, then on the right the **cost chip** (below), the freshness line ("Updated 14s ago" with a green dot) and Refresh as a ghost icon button (`size-9`). The mark, "Read-only" and the theme toggle leave the header: the first two move to the sidebar, and the theme lives in Settings.
- **Cost chip** (#42): it replaces the 5h/7d usage chip (#25) in the same slot, to the left of the freshness line with a 1px divider between them. It is a `h-9` bordered chip: `coins` (muted), the estimated cost so far today ("$38.40", `font-semibold tabular-nums`), then "today · est." muted. It links to Cost. On phones it drops "today · est." and keeps the icon and amount, with an `aria-label` of "Estimated cost today, $38.40".
  - **No cost source connected:** there is no chip at all, not an empty one.
  - The usage pause still reaches the owner through the "Paused for usage" Needs-you row below, which reads the status feed as before.
- **Needs you** (`Card`): one row per item type, oldest first, each linking to its view. Snooze, ack, the footer and History are under Needs you: snooze and ack (#46).
  - An agent failing turns (#44): `destructive`, `heart-pulse` icon. "Gale is failing turns", then "6 of 14 turns ended in error in the last hour · 52m". When an alert went out, the line adds "· `bell` alerted via ntfy, Slack" (desktop only). It links to Health.
  - A release waiting for approval: `warning`, rocket icon.
  - Red CI on `main`: `destructive`, circle-x icon.
  - `ai-blocked` issues: `destructive`, octagon-alert icon.
  - An agent stopped with open claims (#24): `destructive`, `power-off` icon. "Agent stopped with open claims", then the name, how long it has been stopped and the claim keys in mono. It links to Agents.
  - Paused for usage (#25): `warning`, `circle-pause` icon. It names the limit that tripped ("5h window at 92% (pauses at 90%)", without the parenthesis when the feed has no threshold) and the reset time with a countdown ("resets 9:00 PM, in 1h 20m"). It links to Agents, since usage has no view of its own. Amber, not red, because it clears by itself at reset.
  - A muted "Heads-up" footer line that isn't counted: an agent has held a claim but been quiet for more than 2 hours, or the status feed is stale ("Runtime feed is 38m old (is the runtime host asleep?)").
  - With zero items, the card collapses to one green "All clear" line (see States).
  - Open `merge-ready` PRs: neutral (`border-border bg-muted text-foreground`), `git-merge` icon. A merge-ready PR is waiting on a click, not a fault, and green would read as cleared. "2 PRs ready to merge", then the repo#number keys. It links to Pipeline. For most deployments they wait on the owner; one with a merge bot hides the row with `NEEDS_YOU_EXCLUDE_LABELS=merge-ready`.
- **Needs you** stays above every view, at the top of the main column. Settings is the one page without it, because the sidebar counts already show.

## Sidebar (#58)

The `ViewTabs` pill row goes. Use the stock shadcn `Sidebar` with `collapsible="icon"`, wrapped in `SidebarProvider` with `SidebarInset` for the page.

- **Top** (`SidebarHeader`): the 32px Hive mark tile, "Hive" (semibold) and "buzz-dashboard" (muted, 12px) under it. It links to `/`.
- **Views** (`SidebarGroup` labelled "Views"): Agents, Health, Pipeline, Releases, Timeline, Cost and Media, as `SidebarMenuButton` links with their lucide icons (`bot`, `heart-pulse`, `git-pull-request`, `rocket`, `activity`, `coins`, `images`). The current route gets `isActive`. Health and Cost only appear when the history store is configured (#39).
- **"new" tag:** for 14 days after a view first appears, it carries a muted, outlined "new" pill in the badge slot, unless it has a count to show. It is decoration, so give it `aria-hidden`.
- **Counts:** a view that owns Needs-you items shows its count in a `SidebarMenuBadge`, as a red pill (same data as `countsByView`). In light mode the pill text is `red-700` on the `destructive/15` tint (about 4.9:1). Plain `text-destructive` is about 3.6:1 there and fails AA, which also fixes the old tab pills.
- **Bottom** (`SidebarFooter`): the sign-in block (#40, below), a muted "Read-only" line with the `eye` icon (not a link), then Settings (`settings` icon, `/settings`) as a menu button. When signed in, the line reads "Read-only · snooze and ack".
- **Sign-in block** (#40), only when sign-in is configured:
  - **Signed out:** an outlined menu button, `key-round` and "Sign in with Nostr" (NIP-07). In proxy-header mode there is no button, since the proxy already signed you in.
  - **Signed in:** a bordered row with a 32px initials `Avatar` (the profile picture when there is one), the name (500) and the truncated npub in mono 12px, then `chevrons-up-down`. In proxy mode the second line reads "via proxy · <the header's user>".
  - **Its menu** (`DropdownMenu`): name and npub, a muted "`key-round` Signed in with a Nostr extension", then Copy npub, "What sign-in unlocks" (`eye`, a link to the docs) and Sign out (`log-out`).
  - Signing in never unlocks anything outside the dashboard: no posting, no GitHub writes.
- **Collapsed to the icon rail:** each item shows its icon only. A count becomes a 6px red dot on the icon's top-right corner, and the item's `Tooltip` names it: "Pipeline · 3 need you". Items with no count just show their name. The tooltip opens on hover and on keyboard focus.
- **State:** the sidebar's own cookie remembers expanded or collapsed, and ⌘B / Ctrl+B toggles it (both are shadcn defaults). There is no "collapsed by default" setting.
- **Phones** (below `md`): the sidebar becomes a `Sheet` from the left, opened by the menu trigger in the header. Rows are at least 44px tall. Picking a view closes the sheet, and Esc or the close button closes it too.

## Views

| View | Components |
|---|---|
| **Agents** | 4 stat `Card`s (the first is **Running 12 / 14**, with the stopped names as its subline), then a `ToggleGroup` filter (All, Active, Quiet, Stopped) and a `Select` sort, then a `Card` grid (1, 2 or 3 columns). Each card shows `Avatar` (the profile picture, initials as fallback), name, role, a status `Badge`, the **runtime row** (see Runtime status), "Working on" (latest message), last seen, home channel, messages today, and a 7-day sparkline (`BarChart` with no axes). The whole card is one link to the agent page. The "needs attention" sort puts stalled agents first, then quiet ones, and parked agents last. |
| **Health** | See Health (#44). |
| **Cost** | See Cost (#42). |
| **Pipeline** | A `Tabs` row, **Now** and **Flow** (see Pipeline flow, #47). **Now** is the view below. When Custom stages are set, its stage cards are those labels; with the default PR lifecycle they are Opened, In review, Approved and Stalled. Today's view: 5 stage stat `Card`s (`ai-ready` … `ai-blocked`, with mono labels). Then a `BarChart` of PRs opened vs merged per day (chart-1 and chart-2, with legend and tooltip), filtered by a `Select` for agent and a `ToggleGroup` for 7d, 14d or 30d. Then a `Table` by repo, with blocked repos first and the ready/wip/review columns hidden on phones. Last, a `Table` by agent, taking the agent from the PR body's `@Name` header. PRs without that header go under "Unattributed". |
| **Releases** | See Releases (#71). |
| **Timeline** | Without a database: a `BarChart` of events per hour today (chart-3, with the current hour in chart-1) and 2 stat `Card`s. Then a live-feed `Card` with a `ToggleGroup` type filter and a `Select` for agent. Rows are grouped by hour under sticky headers. A row that needs the owner gets a 5% status tint and a "Needs you" `Badge`. With the history store, see Timeline (#41). |

## Agents on phones (#20)

Below `sm` (640px) only. At `sm` and up the Agents view stays as described above. The view must not scroll sideways anywhere from 360 to 430px, in either theme.

- **Toolbar, row 1:** "Agents" (`text-lg font-semibold`) on the left and the sort `Select` on the right. The trigger keeps its full label ("Sort: needs attention") at `h-11 sm:h-9`. It fits down to 360px, so there's no icon-only trigger and no shortened labels.
- **Toolbar, row 2:** the filter `fieldset` at full width (`w-full sm:w-auto`). Its 4 buttons share the row (`flex-1 justify-center sm:flex-none`) at `h-11 sm:h-9` and `px-2 sm:px-3`, which gives about 89px each at 390px and 82px at 360px.
- **Order:** phones show Agents · Sort, then Filter. Desktop keeps Agents · Filter · Sort. One way to get there is a `flex flex-wrap items-center gap-3` row, with the fieldset at `order-last basis-full sm:order-none sm:basis-auto` and the right-hand group at `ml-auto`. The exact classes are the coder's call.
- **Sort menu:** stock shadcn `SelectContent`, with items at least 44px tall on phones.
- **Card grid:** `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`. `grid-cols-1` is `minmax(0,1fr)`, so `truncate` lines ellipsize instead of widening the column. The card's `Link` wrapper also gets `min-w-0`.
- **Unchanged:** the `aria-pressed` buttons inside the `fieldset` and `legend`, the visible `ring` focus, and `aria-label="Sort agents"`.
- **Screenshots:** after the change, run `pnpm screens` and commit the refreshed `mobile-*` shots.

## Runtime status (#24)

Each Agents card gets a row between its header and "Working on", in a bordered `rounded-md` box, `text-xs`.

- **Left:** the runtime state.
  - **Running:** a green 8px dot, "Running" in `success`, then "· up 6h 12m" muted.
  - **Stopped:** an 8px square (`rounded-[2px]`), "Stopped", then "· 3h ago" muted.
  - **Not reported:** `circle-help` and "Runtime not reported", muted.
- **Right:** "Last turn" muted, then the time in foreground.
- **One status badge,** ranked Stopped > Quiet > Active > Idle.
  - **Stopped with open claims:** a destructive `Badge` (`power-off`, "Stopped") and a `ring-1 ring-destructive/40` on the card. "Working on" becomes **"Stalled"** (destructive) with "Holds 2 claims: …" on a 10% destructive tint. It adds a Needs-you row.
  - **Stopped with no claims** (a parked agent): a muted `Badge` and the card at 80% opacity. It sorts last and is not a problem.
  - **Not reported** (no runtime in the status feed for this pubkey): the badge falls back to relay activity (Active, Idle, Quiet), as before.
- **Feed stale:** cards keep their last values and add "· as of 38m ago" in `warning` to the runtime row.

## Agent page (#27)

The route is `/agents/[name]`, where `name` is the lowercased display name with spaces as hyphens (`/agents/optimus-prime`). Renamed agents redirect from their old name (`/agents/fizz`). The shell (header, Needs you, sidebar) stays, with Agents active in the sidebar. It's still read-only, so every action is an outbound link.

- **Breadcrumb** (shadcn `Breadcrumb`): "← Agents › Bumble". The back link is a `h-9` target.
- **Stalled alert:** only when the agent is stopped with open claims. A destructive `Alert` with `power-off`: "Bumble stopped 3h 05m ago while holding 2 claims", then "Restart it from Buzz Desktop, or ask Prime to reassign the claims. This page is read-only."
- **Hero** (`Card`, with the stalled ring when it applies):
  - On the left, the `Avatar` at **176px** (`size-44`, `ring-1 ring-border`, `object-cover`). It shows the profile picture, with initials at `text-5xl` as the fallback.
  - On the right, stacked:
    - Name (`text-3xl font-semibold tracking-tight`) and the status `Badge`.
    - Role · `@Name` in PR headers (muted, with the handle in mono).
    - Outline "Open in Buzz" and "PRs" `Button`s (`external-link`) on the same row.
    - The runtime row, with "Last turn" and "Last seen" on its right.
- **Stats:** 4 stat `Card`s.
  - Messages today (with "47 this week").
  - PRs opened (7d) (with "4 merged").
  - Open claims, in `destructive` when the agent is stalled (with "oldest 3h 20m").
  - Median PR to merge (last 7 days).
- **Left column** (2 of 3 at `xl`):
  - **Open claims:** a `Table` of issue (key in mono, title muted under it), label (mono pill: `ai-wip` info, `ai-review` neutral, `ai-changes` warning, `ai-blocked` destructive), progress ("PR #23 · CI green" or "no PR yet"), how long it has been held, and an external link. The count pill is destructive when stalled and muted otherwise. When stalled, the subtitle reads "Held while the runtime is stopped. Nobody is working these." and the ages turn destructive. With no claims, the card shows a dashed "No open claims" box rather than hiding, so the layout doesn't jump.
  - **Activity:** a `BarChart` of messages per day, chart-3 with today in chart-1, plus a `ToggleGroup` for 7d, 14d or 30d.
  - **Messages:** the agent's messages, newest first, grouped by day under sticky labels. Each row has the time, a mono `#channel` chip, the text and an external link to the message. A `Select` filters by channel.
- **Right column:**
  - **Runtime:** a `dl` of State, Stopped at / Since, Last turn, Started and Model (mono), with a footer reading "From the status feed · as of 2m ago". When the agent isn't reported, it shows `circle-help` and "Not reported. The status feed has no runtime for this agent." with no red.
  - **Recent PRs:** the last 5 PRs whose body names `@Name` (the same attribution as Pipeline). Each row has a state pill (`open` info, `merged` success, `closed` muted), the title, the key in mono, the age and an external link, with an outline "All on GitHub" in the header.
  - **Where they talk:** messages per channel over the last 7 days, the top 5, as thin chart-3 bars with counts.
  - **Identity:** the npub truncated in mono with a copy `Button` (`size-9`), "Also seen as N older identities · formerly X", and the home channel.
- **States:**
  - **Loading:** `Skeleton`s that keep each card's height, hero and stats first.
  - **Unknown name:** a 404 with `user-x`, "No agent called “x”", "It may have been renamed or retired." and an outline "All agents" link.
- **Phone:** one column. Breadcrumb, then a compact alert, then the hero centred (a 112px avatar above the name, with the buttons as two 44px halves). Then the stats 2×2, then Open claims as a list with chevrons, and after that Runtime, Recent PRs, Activity, Messages, Where they talk and Identity.

## Status feed (#26)

The runtime and usage data come from one JSON file, object key `hive/status.json` in the media bucket, that a script on the operator's machine publishes every 5 minutes. The dashboard reads it on the server only, and it never contains secrets, env values or log contents.

```json
{
  "version": 1,
  "published_at": "2026-10-16T19:40:00Z",
  "runtime": {
    "<hex pubkey>": { "name": "Bumble", "state": "running", "since": "2026-10-16T13:28:00Z", "last_turn": "2026-10-16T19:36:00Z", "model": "claude-opus-5-5" }
  },
  "usage": {
    "five_h": 92, "seven_d": 61, "paused": true,
    "five_h_resets_at": "2026-10-16T21:00:00Z", "seven_d_resets_at": "2026-10-18T12:00:00Z",
    "five_h_pause_at": 90, "seven_d_pause_at": 95
  }
}
```

- `version` is the schema version, `1` today. The dashboard ignores a feed with a version it doesn't know and treats it as not reported.
- `runtime` is keyed by hex pubkey. `name` is the agent's display name when the feed was written; the page still takes the live name from the relay and uses `name` only as a fallback.
- `state` is `running` or `stopped`, and `since` is when it entered that state. Percentages are integers. `last_turn`, `model` and both reset times may be `null`.
- `five_h_pause_at` and `seven_d_pause_at` are the % at which each window pauses the hive. Either may be missing: the "Paused for usage" row then leaves out its "(pauses at N%)", and without the 7d one the higher reading is taken as the limit that tripped.
- The feed is **stale** when `published_at` is more than 10 minutes old. Stale data is still shown, with its age.
- An agent with no `runtime` entry is **not reported**. Leave out `usage` and there is no "Paused for usage" row; nothing else reads it, since the cost chip (#42) replaced the usage chip.
- A failed fetch shows the stale state. It doesn't replace the page with a destructive `Alert`, because the relay and GitHub data still render.

## History views (#39)

Timeline search, Health, Cost, the Pipeline Flow tab, Needs-you history and Alerts all read the optional Postgres history store (#39). Shared rules:

- **Needs you stays on top** of Health, Cost and Timeline like every other view.
- **Range:** each history view has a `ToggleGroup` range at the top right (Health 1h / 24h / 7d, Cost and Flow 7d / 30d / 90d). Retention defaults to 90 days, so a range never reaches past it.
- **Source line:** a muted `text-xs` line at the top left says where the numbers come from, with an icon: "`radio` From the relay: turn metrics and presence · live", "`database` History from the database · since Sep 30".
- **Never a made-up number.** A metric whose source isn't connected shows a dashed box with its name, a one-line description and "not connected" in mono, with no value, no zero and no skeleton. Each view ends with one "Connect a source" outline `Button` (`plug-zap`) that opens Settings → Sources.
- **Estimated cost** is always labelled "Estimated, at API list price" (see Cost).

## Timeline (#41)

One stream of GitHub events and Buzz-native events (Buzz issues, PRs, project tasks and channel messages), newest first.

- **Search card** (`Card`): a full-width `Input` (`h-11`, `search` icon, a clear `x` and a `/` keyboard hint; `/` focuses it from anywhere on the page). Under it a filter row: repo `Select` (`folder`), agent `Select`, source `Select` (`layers-2`: GitHub + Buzz, GitHub, Buzz), a `ToggleGroup` type filter (All, Messages, Issues, PRs, Labels, Releases) and a range `Select` (`calendar`, "Last 14 days"). On phones the filter row scrolls sideways in one line.
- **Results line** (only while searching): "**27** results for `example-app#42`", then a muted "Last 14 days · newest first · full-text over messages, GitHub and Buzz issues and PRs, labels and release notes". On the right, a small "Matches per day" bar strip (chart-3, today in chart-1, 44px tall, first date and "Today" under it).
- **Feed** (`Card`): rows grouped by day under sticky day labels ("**Today** Thu Oct 22 · 8"). Each row is a grid: time (mono, desktop only), a 32px muted icon tile for the event type (`git-merge`, `tag`, `git-pull-request`, `message-square`, `circle-check-big`, `circle-plus`, `rocket`), then the body, then an `external-link` (desktop only) to the event on GitHub or in Buzz.
  - **Line 1:** the **source badge**, the actor's 20px initials `Avatar` and name (500), the verb (muted: "merged", "labelled", "opened a Buzz PR", "closed a Buzz issue", "posted in #channel", "released"), then the target (key or title in mono, or a version `Badge`).
  - **Line 2:** the snippet (muted). A label change shows both labels as mono pills with an `arrow-right` between them, then the comment. A search match is wrapped in `<mark>` with `--mark` behind it.
  - **Line 3:** meta chips (mono 12px, bordered): repo, `#channel`, `project: Example App`, `repo: search-index`, `+184 −12`, `squash · 1d 4h from ai-ready`.
  - A row that needs the owner keeps the 5% destructive tint and the "Needs you" `Badge` (`octagon-alert`) after the target.
- **Source badge:** a `h-5` bordered chip, 12px 500 text with a 12px icon. GitHub is `git-branch` + "GitHub" on `card`. Buzz is `hexagon` + "Buzz" on the `--mark` tint. The label carries the meaning, so the tint is only a second cue.
- **Footer:** muted "Stored since Sep 30 · 41,920 events · 31% from Buzz", and an outline "Load older" `Button`.
- **Phone:** the time and external link drop out of each row (the whole row links instead), and the grid is icon + body.

## Health (#44)

Is any agent broken right now, and which one?

- **Sources:** presence, turns per hour and "silent while holding a claim" come from the relay. Error, cancelled and max-tokens rates come from the connected cost source (NIP-AM `stopReason`, or OTel `api_error`). With no cost source those columns use the not-connected box, and the strip ranks on presence and silence only.
- **Hive strip** (`Card` "`heart-pulse` Hive health"): status pills in the header ("`octagon-alert` 1 failing" destructive, "`triangle-alert` 1 silent" warning), "6 healthy · 8 agents" muted on the right. Then one tile per agent, 8 across on desktop and 2 on phones, sorted failing, silent, healthy, idle. A tile has the initials `Avatar` and name, a status line (icon + label) and one muted fact.
  - **Failing:** error rate over 25% for 15 minutes (the same threshold as the alert rule). `octagon-alert` "Failing", "43% errors · 1h". Destructive border at 55% and a 6% tint.
  - **Silent:** no turn for 4h while holding a claim. `clock` "Silent 5h", "holds example-cli#124". Warning border and tint.
  - **Healthy:** `circle-check-big` "Healthy" in `success`, "9 turns/h".
  - **Idle:** no claim and quiet. `moon` "Idle", "no claim · fine", muted. Idle is not a problem.
- **Sick-agent card:** the worst agent gets a detail `Card` with a destructive border. Header: avatar, name, a destructive "Failing since 2:20 PM" `Badge`, then outline buttons "Open Gale’s channel" (`message-square`, outbound) and "Stop alerting" (`bell-off`, the same menu as Needs you, signed in only). Body, two columns:
  - **Left,** a `dl`: Error rate, last hour ("**43%** 6 of 14 turns · hive 3%", the % in destructive), Ended in error ("6 turns (stop reason `error`)"), Cancelled, Hit max tokens, Holding (key in mono · claimed 2d ago) and Presence. Under it a dashed info box: "The relay says *that* a turn failed, not *why*. The error text lives in the agent’s log. Connect a log or OTel source ›".
  - **Right,** "Turns per hour, last 24h": a stacked `BarChart`, finished turns in chart-3 and error turns in `destructive` on top, with a legend whose Error entry also carries the `octagon-alert` icon. This is the one place a status colour is a chart series, because the series *is* the status.
  - With no sick agent the card is not shown.
- **By agent** (`Table`, "24h · sorted by error rate"): Agent, Presence (dot + Online / Away), Turns/h, Error, Cancelled, Max tokens, Silent while holding a claim ("no", "no claim", or `clock` "5h 12m · example-cli#124" in warning), Last turn. A failing row gets the 5% destructive tint and its Error cell is `octagon-alert` + bold destructive. Footer: "Showing 6 of 8 · error = turns whose stop reason was `error`" and "Show all". On phones Presence and the rate columns hide, leaving agent, turns/h, error and last turn.
- **Needs a log or OTel source** (`Card`, `plug`): "The relay can’t see these. They come from each agent’s log or from OpenTelemetry. Nothing is shown until a source is connected, so these are never guesses." Then four dashed boxes (4 across, 2 on phones): Retries (`refresh-cw`), Dropped turns (`circle-slash`), Last error (`message-circle-warning`), Turn duration (`timer`), each "not connected". v1 has no log source (see Settings → Sources), so these boxes stay "not connected" in v1. Once a log source is specced and connected, each box becomes a real stat and the per-agent table gains those columns.
- **Needs you** gets one "Agent failing turns" row per failing agent (see Shell). A silent agent stays a Heads-up footer line, as today.

## Cost (#42)

Where the money goes, per agent and per model. Fed by Claude Code OpenTelemetry (`claude_code.cost.usage`, `claude_code.token.usage`).

- **Estimate banner:** a dashed pill at the top, "`info` Estimated, at API list price", with a muted line beside it: "Not what a subscription plan bills. Tokens are exact; dollars are the list-price equivalent." The same pill sits in the Cost card header on phones.
- **Controls:** a `ToggleGroup` Cost / Tokens (every chart and table switches unit) and a range 7d / 30d / 90d.
- **4 stat `Card`s:** Today ("$38.40" + "est. · 41.2M tokens"), This week ("$212" + "est. · $184 last week"), Cache hit rate ("87 %" + "of input tokens read from cache"), Top agent ("Fern" + "$72 this week · 34% of total"). 2×2 on phones.
- **Daily cost per agent, by model** (`Card`, "same scale on every chart · last 7 days"): small multiples, one bordered mini chart per agent, 4 across (2 on phones), the top 4 by cost. Each is a stacked `BarChart` per day (haiku at the bottom, then sonnet, then opus), with the agent's avatar, name and total in its header and day initials under it. **Every mini chart shares one y scale** (gridlines every $5), so a tall bar means more money wherever it is. Legend: opus, sonnet, haiku. Tooltip: "Fern · Thu Oct 22", one line per model with its swatch and amount, then "$16.70 est. · 14.1M tokens · 89% cached". "4 more agents ›" opens the rest.
- **Two tables side by side** (stacked on phones):
  - **Top agents by cost** (7 days): Agent, Cost by model (a 10px stacked bar, its length proportional to the agent's cost), Est. cost, Tokens, Cache hit. Tokens and Cache hit hide on phones.
  - **Cost per channel** (7 days, "from each turn’s channel"): Channel (mono), Est. cost, Turns, plus a muted footer: "Per channel, not per issue: a turn knows its channel, not which issue it worked on." DMs are one row. OpenTelemetry reports carry no channel, so with OTel as the source this card shows a not-connected box in place of the table, and fills in with the per-turn reports of #43.
- **Not connected:** the stat cards stay with "–" and "not connected" (so the layout doesn't jump), and the charts give way to one `Card`: a 48px `plug-zap` tile, "Connect a cost source", the paragraph "Your agents already report tokens and an estimated cost for every turn. The dashboard can’t read those reports until a cost source is connected. Until then this page stays empty, with no guessed numbers.", three muted `check` lines (daily cost and tokens per agent, split by model; cache hit rate, top agents and cost per channel; cost alerts, e.g. "an agent is over $40 today"), a primary "Connect a cost source" (`plug-zap`, to Settings → Sources) and an outline "How cost data works" (`book-open`, docs). Footer: "Only the hive owner can connect it. The dashboard stays read-only either way." The copy never names the connection method, which differs per deployment (OTel, or the opt-in NIP-46 signer in #43).
- **Model colours** (see Tokens): `--model-1` opus, `--model-2` sonnet, `--model-3` haiku, assigned by price tier, not by name, so a new model family slots in. They are never orange or terracotta, so the charts don't read as a provider's brand.

## Pipeline flow (#47)

The Flow tab answers "where do PRs wait?", for any repo and with no setup.

- **Header row:** `Tabs` Now / Flow on the left, the source line ("`database` History from the database · since Sep 30"), then range 7d / 30d / 90d, a repo `Select` and an agent `Select` on the right.
- **4 stat `Card`s:** Median cycle time ("1d 4h", "opened → merged · 3h faster than last week"), Merged ("23", "this week · 19 last week"), Change requests ("0.4 per PR", "15 of 23 approved on first review"), Stalled now ("2", "no activity for 24h or more"). Stalled gets the destructive ring and an `octagon-alert` when it's above zero.
- **Slowest-step callout** (`Card`): `hourglass` tile, "Slowest step this week: approved, waiting to merge", then "PRs waited a median **9h 20m** for a merge, 2.4× last week. 6 of 23 waited overnight." and an outline "Show those 6 ›" that filters the PR table. It names whichever step grew most against last week; with nothing notable it isn't shown.
- **Median time in each step, by repo** (`Card`): one horizontal stacked bar per repo (repo in mono on the left, 120px), segments in step order, labelled with hours inside when they fit. A shared x axis in hours (0, 10h, 20h …) with a dashed grid. Legend above. Tooltip: repo, step swatch and median, "median over 3 PRs · last week 3h 10m".
- **PRs this week** (`Table`, count pill, sort `Select` "Stalled first"): PR (key in mono, title muted under it), Author (avatar + name), Time in each step (a thin stacked bar on a fixed 0 to 3 days scale, so rows compare), Total ("16h so far" while open), State `Badge` (`git-merge` Merged success, `git-pull-request` In review info, `octagon-alert` "Stalled · 2d 3h in review" destructive). A stalled row gets the 5% destructive tint, and its stalled segment is hatched with a dashed destructive outline, so the stall reads without colour. "Showing 6 of 26", "Show all". On phones each row becomes a two-line card and Author hides.
- **By repo** and **By agent** `Table`s side by side: Repo, Merged, Median cycle, Slowest step; Agent (PR author, from the `@Name` header), Merged, Median cycle, Wait for review.
- **Stages** (`Card`, `layers-2`, "How Flow splits a PR’s time"), a `RadioGroup`:
  - **PR lifecycle** (`Default` badge): "Opened → first review → changes → merged. Works on any repo, GitHub or Buzz, with no setup." Steps are Opened → first review, Review and changes, Approved → merged.
  - **Custom stages** (`Optional` badge): "Use your own labels as stages, in order. For teams that move work through labels." An ordered row of mono label pills with `arrow-right` between them and a "`plus` Add label" ghost button. Unselected, it shows an example row with "Example only. Nothing changes until you pick this." No label names are built in; the example comes from the repo's own labels.
  - Changing stages saves to the database, so it needs sign-in. Signed out, the card is read-only with "Sign in to change stages".
- **Stage colours** are a blue ramp, `--stage-1..3` (see Tokens), light to dark in step order, each with a text colour for the in-bar label.

## Releases (#71)

> **Status:** approved by rtorcato on 2026-10-23.

`/releases`. Per watched repo: the latest tag, what has merged since it, the release run and the last npm publish. It reuses the GitHub reads in `src/lib/github.ts` and the same refresh cadence. It's read-only, so approving a release always opens GitHub.

- **Shell:** the normal one, with Needs you on top. Releases already owns the "release waiting for approval" and "Red CI on `main`" Needs-you rows, so its sidebar count is those two.
- **Stats:** 4 stat `Card`s (2 by 2 on phones).
  - **Waiting for approval** (`rocket`): the count, then "`example-lib` v2.4.0 · 5h" for the oldest.
  - **Unreleased changes** (`git-compare`): "3 repos", then "15 releasing commits on `main`".
  - **Red CI on main** (`circle-x`): the count, in destructive text when it isn't 0, then the repo and "failing 2h".
  - **Last publish** (`package-check`): the newest npm version across watched repos, then the repo and the publish time.
- **Waiting for your approval** (`Card`, `rocket`, a warning-tint count pill, "Oldest first" muted on desktop). One row per release run waiting on an environment approval, oldest first:
  - A 36px warning icon tile with `rocket`.
  - The repo (mono, 14px), a version `Badge` "v2.3.1 → v2.4.0" (muted arrow) and a warning `Badge` "`clock` waiting 5h".
  - Muted under it: "3 releasing commits · newest `feat` add a retry option to the fetch helper · `release.yml` run #212", with the commit's type chip (below).
  - On the right, an outline "Review on GitHub" `Button` (`external-link`) to the run's approval page. Full width under the text on phones.
- **Red CI on main** (`Card`, `circle-x`, destructive count pill). One row per repo whose latest `main` run failed: a 36px destructive icon tile, the repo and a destructive `Badge` "`clock` failing 2h", then muted "test (ubuntu, node 22) · `a41c9e2` fix: handle an empty config file". When the repo has unreleased releasing commits, the line ends "· blocks the next release". "View run" (`external-link`) on the right.
- Both cards are left out when they're empty. Their stat cards still show 0.
- **Repos** (`Card`, `tag`, "5 watched · unreleased first" muted, and a `ToggleGroup` All / Unreleased / Up to date on the right, hidden on phones). A watched repo is one under `GITHUB_OWNERS` with at least one tag or a release workflow. The `Table` columns:
  - **Repo** (mono).
  - **Latest tag:** the tag (mono) and its date (muted, `text-xs`).
  - **Unreleased on main:** the commit count since the tag (600), then one type chip per type with its count: "feat 1", "fix 2". With nothing since the tag, `circle-check-big` "Up to date" in `success`.
  - **Next:** the bump and the version it would give, "minor → `v2.4.0`" (muted arrow). "no release" (muted) when every commit is a non-releasing type, "–" when up to date.
  - **npm:** the published version (mono) and date. A muted "Release pending" `Badge` when `main` has releasing commits that aren't published. "not on npm" (muted) for a repo with no package.
  - **Release run:** one of a warning `Badge` "`clock` Waiting for you · 5h", a destructive `Badge` "`circle-x` CI red on main", muted "`circle-dashed` Not started", `circle-check-big` (success) + muted "Published Oct 21", or "–".
  - A `chevron-right` (muted) on each row, `chevron-down` when open.
- **Sort:** waiting for approval, then red CI, then the most unreleased releasing commits, then repos with only non-releasing commits, then up to date. Ties go by repo name.
- **Type chips:** Geist Mono 11.5px, 20px tall, `rounded-[5px]`, a 1px border at 35% and a fill at 8% of their colour. `feat` uses `info`, `fix` and `perf` use `success`, and a breaking change uses `destructive` and reads "feat!" (or "fix!"). Everything else (docs, chore, refactor, test, ci, build, style) is muted on `muted`. The type is always written out, so the colour is never the only signal.
- **Expanding a row:** the whole row is a button (`aria-expanded`) that opens the commit list under it. Any number can be open. The open row gets a 3% `foreground` tint and a 3px `foreground` bar on its left edge. The list, on the same tint and indented to line up with the Latest tag column, shows one line per commit, newest first: type chip, subject, PR number (mono, muted), agent (from the PR's `@Name` header, muted) and age. It shows 4, then a footer: "+ 3 more · 2 fix, 1 chore · Merged since `v3.1.0` on Mon", with "Compare on GitHub" (`external-link`) on the right, linking to `compare/<tag>...main`.
- **"Next" is labelled a guess.** It comes from the conventional-commit prefixes since the last tag: `feat` → minor, `fix` and `perf` → patch, `!` or a `BREAKING CHANGE` footer → major. The table footer says so, with `info`: "“Next” reads the conventional-commit prefixes since the last tag (feat → minor, fix → patch, ! → major). It’s a guess; the release workflow decides."
- **No GitHub source** (no `GITHUB_TOKEN`): one `Card` with two dashed not-connected boxes, "Tags, unreleased commits and release runs · Read from GitHub for each watched repo." (`git-branch`) and "Last publish · The latest npm version of each repo’s package." (`package`), each with a mono "not connected", then an outline "`plug-zap` Connect a source" `Button` to Settings → Sources. npm needs GitHub too, since the package names come from each repo's `package.json`. No stats, no zeros.
- **Phone:** the table becomes a list. Each item is at least 44px tall: the repo (mono, 500), the tag (mono, muted) and the run `Badge` on one line, then "**7** unreleased · feat 2 · fix 4 · chore 1 · minor → v3.2.0" (muted, `text-xs`), and a `chevron-right`. Tapping it opens the same commit list.

## Needs you: snooze and ack (#46)

Snoozing or acking stops the **alerts**. The item stays on the page.

- **Row actions** (signed in only), after the view link and a 1px divider: two ghost icon `Button`s (`size-9`, 44px on phones), `alarm-clock` ("Snooze alerts") and `check` ("Stop alerting me about this"). Both open the same `DropdownMenu`.
- **Menu:** title "Stop alerting me about this", the row's line 1 quoted and muted, then three items with the resulting time on the right: `timer` For 1 hour ("until 4:20 PM"), `sun` Until tomorrow ("9:00 AM"), `check` Until it changes ("ack"). A muted footer: "It stays on this page. Alerts stop on every channel, and start again early if it gets worse." "Gets worse" means the count goes up or the tone goes from warning to destructive.
- **Signed out:** no buttons. The card header shows a muted "`log-in` Sign in to snooze or acknowledge" next to "Oldest first" (desktop only).
- **Footer** (with the history store): `history` "This week: **14** cleared · avg **3h 10m** to clear · `alarm-clock` 1 snoozed until 9:00 AM · `bell-off` 1 muted until it changes", and "History ›" on the right. A snoozed or muted row keeps its place but its icon and line 1 drop to 62% opacity.
- **History** (expands inside the card): "Cleared this week" with "newest first · from the database" and a 7d / 30d `ToggleGroup`. A `Table` of Item (icon + label + key), Appeared, Cleared, Time to clear, How ("Merged", "Unblocked by you", "Recovered", "Approved by you"). Footer: median time to clear per type, and "Open in Timeline ›". Appeared and How hide on phones.

## Settings tabs and Alerts (#45)

Settings gets a `Tabs` row: **General** (today's page, still `localStorage` only), **Alerts** and **Sources**. Alerts and Sources live in the database, not the browser, and only the owner can change them.

- **Owner note** at the top of Alerts: "`lock` Only the owner can change alerts · signed in as Sam". Signed out, the tab is visible but read-only: controls disabled, with a "Sign in with Nostr" button in that note.
- **Where alerts go** (`Card`, `send`, "Add channel" outline button): one row per channel, a 36px icon tile, the name (500) with its badges, the target in mono (truncated), a "Send test" outline button (desktop only) and a `Switch`.
  - ntfy (`bell-ring`), topic URL.
  - Slack-compatible webhook (`hash`), "Slack, Discord, Mattermost" muted, URL with the secret part elided (`https://hooks.example.com/services/T0…/B0…`).
  - Webhook (`webhook`) with a "JSON" badge.
  - Email (`mail`), address · "uses your SMTP settings".
  - Buzz DM (`message-square`), an "Opt-in" badge and a warning "`key-round` Needs a posting key" badge: "The dashboard never posts as the hive. To get alerts as a DM, give it a key of its own that can only send to you." A "Set up" button instead of a switch, and the row is dimmed until set up.
  - Secrets (webhook URLs, SMTP credentials) are never sent back to the page in full: show the elided form only.
- **What to alert on** (`Card`, `bell`, "Every alert also shows in Needs you"): a `Table` of Alert (icon + name), When, Send to (channel chips, `muted` when on), Repeat, On (`Switch`). Default rules:

| Alert | When | Repeat |
|---|---|---|
| Agent failing turns | Over 25% errors for 15 min | Hourly until stopped |
| Silent while holding a claim | No turn for 4h | Once |
| Release waiting for approval | After 1h | Every 4h until stopped |
| Issue blocked | Right away | Once |
| PR ready to merge | After 2h | Once |
| Agent over budget (`new` badge, needs a cost source) | An agent goes over $40 today | Once a day |

- **Rule editor:** clicking a rule opens an inline editor under it, on a 5% `info` tint: "When [Any agent ▾] goes over [$ 40] [per day ▾]", a muted hint that repeats the estimate label and gives context from real data ("Fern averaged $10 a day this week, so $40 means something unusual happened."), then Save (primary) and Cancel. Esc cancels.
- **Card footer:** "`plus` Add rule" and "`moon` Quiet hours 10 PM to 8 AM · only failing agents get through".
- **Sources** tab: see Settings → Sources below.
- **Phone:** channel rows drop "Send test" into the row's menu; rule rows become two-line cards with the switch top right (44 × 26px).

## Settings → Sources (#42, #43)

> **Status:** approved by rtorcato on 2026-10-23.

Where the dashboard's numbers come from, and the one place a cost source gets connected. Every "Connect a source" button (History views, Cost not-connected) opens this tab.

- **Owner note** at the top, the same as Alerts: "`lock` Only the owner can change sources · signed in as Sam". **Signed out** (#40), the tab is visible but read-only: the radio, Create/Rotate token and Connect signer are disabled, and the note carries the "Sign in with Nostr" button. Copy buttons still work, since the endpoint and env block hold no secret.
- **Where the dashboard reads from** (`Card`, `radio`, "Checked every minute" muted on the right): one row per source, a 36px icon tile, the name (500) with a status `Badge`, a muted mono detail line, and a muted "Set in env" tag on the right (under the details on phones).
  - **Buzz relay** (`radio`), `circle-check-big` "Connected": "wss://relay.example.com · read-only key npub1r3d…q9m4 · last event 3s ago".
  - **GitHub** (`git-branch`). Connected: "Token for example-org · 4,812 of 5,000 calls left this hour · 12 repos". With no token it shows a warning `Badge` "`triangle-alert` No token" and "Public repos only, 60 API calls an hour. Add GITHUB_TOKEN for private repos and Releases."
  - **History database** (`database`), "Connected": "Postgres · 41,920 events · since Sep 30 · keeps 90 days". With no `DATABASE_URL` it reads "Not set · live only" (muted), and the history views show their not-connected boxes.
  - Footer: "`lock` These come from the dashboard’s env file. Change them there and restart. Keys are never shown here." These three rows have no controls. The page never shows a key, token or connection string in full: an npub is truncated, a URL keeps only its host.
- **Cost source** (`Card`, `coins`, with the dashed "`info` Estimated, at API list price" pill in the header). A `RadioGroup` of two option cards, side by side (stacked on phones). The selected card gets a 1px `foreground` ring.
  - **OpenTelemetry** + "Recommended" `Badge`: "Each agent sends its own token and cost reports straight to this dashboard. No key leaves your machine." Muted: "Claude Code agents only, for now."
  - **Owner signer** + "NIP-46" mono chip + "Opt-in · off" `Badge`: "Reads the per-turn reports Buzz already publishes, through your own Nostr signer. No agent changes." Then a warning line, `shield-alert` "Your signer can’t limit this to cost reports, so it could also decrypt your DMs." It is never the default.
  - **One cost source at a time.** The radio is the only switch, so the two can never double-count. Choosing the other source is a confirm step, not an instant switch: picking the signer opens the signer dialog (below); going back to OTel asks "Switch to OpenTelemetry? The signer connection is closed." and revokes nothing on the signer side by itself (the copy says to revoke it in the signer app).
- **OpenTelemetry setup**, under the options:
  - **Status bar.** Connected: `circle-check-big` "Receiving" `Badge`, "7 of 8 agents reporting · last report 40s ago". Not connected: `loader-circle` (static, muted) "No reports yet. This updates by itself when the first agent reports." The page polls; no refresh button.
  - **Three steps,** each with a 24px round marker: a number (1, 2, 3) on `muted` while not connected, a `check` on a 14% `success` tint once done.
    1. **Ingest token.** Not connected: a primary "`key-round` Create ingest token" `Button`, with "Agents send it with every report, so nobody else can post numbers to your dashboard. Shown once." Created: a read-only mono field `hive_otel_••••••••••••••7k2q`, "created Oct 22", and an outline "`rotate-ccw` Rotate" that opens an `AlertDialog`: "Rotating it stops every agent’s reports until you paste the new one." The full token is shown once, at creation or rotation, in a copy field, and never again; the server stores only its hash.
    2. **Endpoint.** A read-only mono field `https://hive.example.internal/otlp` with "`copy` Copy". "Agents must be able to reach this address. It only accepts metrics with a valid ingest token." The URL comes from the dashboard's public URL setting, never hardcoded.
    3. **"Add this to each agent’s environment in Buzz Desktop, then restart the agent".** A mono env block on `muted` with "`copy` Copy" at its top right (above it on phones):

       ```
       CLAUDE_CODE_ENABLE_TELEMETRY=1
       OTEL_METRICS_EXPORTER=otlp
       OTEL_LOGS_EXPORTER=otlp
       OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
       OTEL_EXPORTER_OTLP_ENDPOINT=https://hive.example.internal/otlp
       OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <your ingest token>
       OTEL_RESOURCE_ATTRIBUTES=agent=<agent name>
       ```

       The two placeholders render in the warning text colour, and the hint under the block says: "Replace the two highlighted values. The agent name must match its Buzz display name so cost joins the right agent." Right after a token is created, the block fills in the real token for that one view, so the owner can copy it whole.
  - **Endpoint rule:** the OTLP endpoint rejects any request without a valid ingest token (401, no body detail). The token only lets an agent post metrics. It can't read anything.
  - **Agents** (`Table`, "reports in the last hour", connected state only): Agent (initials `Avatar` + name), Last report, Tokens today (hidden on phones), Status. Problems first: an agent with no reports gets the 6% `warning` row tint and "`triangle-alert` No reports · check its env"; the rest show `circle-check-big` "Reporting" in `success`. Footer: "Showing 4 of 8 · problems first", "Show all ›".
- **Card footer:** "`book-open` How cost data works · The dashboard stays read-only either way. It never posts to Buzz or GitHub."
- **Owner signer dialog** (`Dialog`, `max-w-[520px]`, opens when the signer option is picked):
  - Title "Read cost through your owner signer?", then "The dashboard will connect to your Nostr signer (a NIP-46 bunker) and ask it to decrypt the per-turn reports your agents publish. Your key stays in the signer."
  - A destructive box (8% tint, 40% border, `shield-alert`): **"This can also decrypt your DMs"**, "A signer can’t limit decryption to cost reports. If this dashboard were ever compromised, it could ask your signer to decrypt your direct messages too. Use OpenTelemetry unless your agents can’t send it."
  - "Signer address" `Input`, mono placeholder `bunker://…`, hint "From your signer app. You can revoke it there at any time." The address is a secret: after connecting it shows only as "bunker://…" plus the signer's npub, truncated.
  - A `Checkbox`: "I understand the dashboard could decrypt my DMs if it were compromised." Unticked by default.
  - Actions: Cancel (outline) and "`key-round` Connect signer" (primary), **disabled until the box is ticked and the address is filled in**. Cancel, Esc or a click outside closes it and leaves OTel selected. On phones the buttons stack full width, Connect on top.
- **No log source in v1.** The tab has no log row. Health's Retries, Dropped turns, Last error and Turn duration stay "not connected" until a remote log source is specced and mocked.
- **Phone:** the source rows drop "Set in env" under the details, the option cards stack, the env block's Copy sits above it, and the agents table keeps Agent, Last report and Status.

## Media tab

> **Status:** approved by rtorcato on 2026-10-09. UI PRs can build against it.

A gallery of every file the agents upload to the public R2 media bucket, served at `<media-host>`. The app reads the base URL from the `MEDIA_BASE_URL` env var (e.g. `https://media.torcato.dev`) and never hardcodes a domain. Keys are `<repo>/<YYYY-MM-DD>/<file>`, written by your upload tool.

- **Header row:** "Media", then "`70` files in `<media-host>` · newest first" (the host part of `MEDIA_BASE_URL`). On the right, a repo `Select` ("All repos" or one repo, also set by `?repo=`) and an outline "Bucket" link to the bucket in the Cloudflare dashboard (`external-link`).
- **Grouping:** by repo, then by date, newest first. Repos are ordered by their newest upload. Each repo header has a `folder` icon, the repo name in mono, a muted file-count pill and a "View all" link that sets the repo filter. Each date label reads "Wed Oct 7 · 6" (muted, `text-xs`).
- **Page size:** with "All repos", each repo shows its 2 newest dates, at most 10 tiles. With one repo selected, every date shows, 60 tiles a page, and an outline "Load older" `Button` follows the `ListObjectsV2` continuation token.
- **Grid:** 2 columns on phones, 3 at `sm`, 4 at `lg`, 5 at `xl`. Gap 12px on phones, 16px above.
- **Tile** (a `Card`): a 4:3 thumbnail on `bg-muted`, `object-cover object-top` (screenshots read from the top), then a footer row with the filename (Geist Mono 13px, truncated, full key in `title`), the time and size (`text-xs`, muted), and a ghost icon `Button` (`size-9`, `link` icon, `aria-label="Copy link to <file>"`). The copy button is always visible, never hover-only.
  - **Thumbnail URL:** `${MEDIA_BASE_URL}/cdn-cgi/image/width=480,format=auto/<key>` for png, jpg, webp and gif. SVGs load the original. Use `loading="lazy"` and `decoding="async"`.
  - **Not an image** (html, pdf, …): the thumbnail area shows a `file-code` icon (or `file`) and the extension. Clicking it **downloads** the file and never renders it, and the footer icon is `download` instead of `link`. The bucket is public, so an `.html` file rendered from the media host would run as a live page on that domain. Any uploader must therefore send every non-image file with `Content-Disposition: attachment`, and the tile link also carries the `download` attribute.
  - **Thumbnail fails to load:** keep the tile's size and show `image-off` with "No preview" (see States).
- **Copy:** `navigator.clipboard.writeText(url)`. The button turns into a success check plus "Copied" (icon only on phones) for 2s, announced through `role="status"`.
- **Viewer** (shadcn `Dialog`): opens when a thumbnail is clicked. On desktop it's inset 24px with a max width of 6xl. On phones it fills the screen.
  - Header: filename (mono, semibold), then repo · date and time · pixel size (from `naturalWidth`/`naturalHeight` once loaded) · file size. "3 of 8" on desktop, then the close button.
  - Body: the original image, `object-contain`, on `bg-muted/60`. Round prev/next buttons (`size-10`) sit on the sides on desktop. ←/→ keys and swipe step through the current repo's list, and Esc closes.
  - Footer: the public URL in a read-only mono field, then "Copy link" (primary), "Markdown" (outline, copies `![<file>](<url>)`) and "Original" (outline, opens in a new tab). On phones the buttons are 44px tall and stack under the URL.
- **Data:** the server lists the bucket with the read-only R2 token, never in the browser, and caches the listing for 60s. Keys that don't match `<repo>/<YYYY-MM-DD>/<file>` go under an "other" group at the end. If R2 can't be reached, the Media tab shows the same destructive `Alert` as any other failed source.
- **Rules:** still read-only, so there's no upload, rename or delete in the UI. Media never adds a Needs-you item, and its sidebar item has no count badge.

## Settings (#58)

`/settings`, linked from the bottom of the sidebar. This section is the **General** tab. The dashboard is read-only and single-user, so every General setting is a browser preference. Alerts and Sources are server-side and owner-only (see Settings tabs and Alerts, #45).

- **Storage:** everything is kept in `localStorage` in this browser, under one versioned key. Nothing is sent anywhere: no analytics, no sync and no server write. Changes apply at once, with no Save button.
- **Page:** a `max-w-2xl` column. The title "Settings", then a muted line "Preferences for this browser. Changes apply right away.", then a bordered note with the `lock` icon: "Stored in this browser only (localStorage). Nothing is sent anywhere, and nothing here changes the hive."
- **Sections:** each is a `Card` with a title and a muted one-line description. Inside, each setting is a row: label (500) with an optional muted hint under it on the left, and the control on the right, with a `Separator` between rows. On phones the control stacks under the label.
- **Controls:** a `ToggleGroup` (outline, single) for 2 to 4 choices, a `Select` for longer lists, and a `Switch` for on/off.
- **No personal data:** defaults stay neutral. No agent names, pubkeys, channel IDs, repo or owner names, hostnames or emails as defaults, presets or examples. Pinned and hidden start empty. Mockups and docs screenshots use sample data only.

| Section | Setting | Control | Default |
|---|---|---|---|
| **Appearance** · How the dashboard looks on this device. | Theme | ToggleGroup: System (`monitor`) / Light (`sun`) / Dark (`moon`) | System. It uses the existing `next-themes` wiring. |
| | Density · Compact tightens agent cards and table rows. | ToggleGroup: Comfortable / Compact | Comfortable |
| | Motion · System follows your OS reduce-motion setting. | ToggleGroup: System / Reduced / Full | System. Reduced turns off everything in Motion, the same as `prefers-reduced-motion: reduce`. |
| **Time** · Logs and messages are recorded in UTC. | Timestamps | ToggleGroup: Relative / Absolute | Relative |
| | Clock | ToggleGroup: 12h / 24h | follows the browser locale |
| | Time zone | ToggleGroup: Local / UTC | Local. Under it, a mono preview chip shows the result ("Preview: 2h ago · Tue 14:05"). |
| **Data and refresh** · The page re-reads the hive on this schedule. | Auto-refresh · Off still lets you refresh by hand. | ToggleGroup: Off / 30s / 1m / 5m | 1m (today's `REFRESH_EVERY_MS`) |
| | Quiet after · An agent with no messages for this long shows as Quiet. | Select: 30 minutes, 1, 2, 4, 8 hours | 2 hours |
| **Agents** · The Agents view and the default landing page. | Open on · The view you land on at /. | Select: the five views | Agents |
| | Default filter | ToggleGroup: All / Active / Quiet / Stopped | All |
| | Default sort | Select: the Agents view's sort options | Needs attention |
| | Pinned and hidden · Pinned agents sit at the top. Hidden agents leave the Agents view, but they still count in Needs you. | a filter `Input` (`search` icon), then one row per agent: `Avatar`, name, muted role, and two ghost icon toggle buttons, Pin (`pin`) and Hide (`eye` / `eye-off`). A pressed toggle gets the `accent` background. A hidden agent's row is dimmed to 60%. | none pinned, none hidden |
| **Notifications** · Uses your browser only. No push service. | Desktop notification · When Needs you goes up. Your browser asks for permission the first time. | Switch | Off. Turning it on asks for permission. If the browser denies it, the switch goes back off with a muted "Blocked in your browser settings" hint. |
| | Count in tab title | Switch, with a mono preview chip "(3) Hive" | On |
| **About** | Version, Last publish | read-only rows: the app version and short commit in mono, and the feed's last publish time | — |
| | Reset all settings · Clears every preference on this page in this browser. | outline destructive `Button` "Reset…" with `rotate-ccw`, which opens an `AlertDialog` to confirm | — |

What changed from the request in #58, as approved:

- **Dropped: accent colour.** Honey is for the logo only (see Brand), and amber already means paused or waiting on you.
- **Dropped: "Sidebar collapsed by default".** The sidebar already remembers its last state.
- **Merged: pin and hide** into one "Pinned and hidden" list with two toggles per agent.
- **Merged: default landing view** into "Open on" under Agents, so there is no Navigation section.
- **Moved: the theme toggle** leaves the header for Appearance.
- **About** shows no infrastructure: no feed URL, hostnames or bucket names.

## Setup wizard (#73)

> **Status:** approved by rtorcato on 2026-10-23.

`/setup` replaces the env-file dance on first run. It walks the owner through the relay settings, then the optional sources, and saves them to the config store. It is served only while the dashboard has no relay settings. When the env file sets `BUZZ_RELAY_URL`, `BUZZ_PRIVATE_KEY`, `BUZZ_AUTH_TAG` and `BUZZ_OWNER_PUBKEY`, `/setup` is never served, and after Finish it redirects to `/` for good. **Env always beats saved config**, value by value.

- **No shell.** `/setup` has no sidebar, no Needs you and no header chips. It has a 56px top bar instead: the 32px Hive mark tile, "Hive" (semibold) and "Setup" (muted). Once unlocked, the right side shows a success `Badge` "`shield-check` Unlocked" and, on desktop, "setup token expires in 54 min" (muted, `text-xs`).

### The gate

A single `Card`, `max-w-[480px]`, centred 72px below the bar (24px on phones).

- Title "Set up this dashboard", then "It isn’t connected to a relay yet. To prove you run it, paste the one-time setup token from the container logs."
- "`square-terminal` Find it with", then a mono command block on `muted`, `docker compose logs dashboard | grep "setup token"`, with an outline "`copy` Copy" beside it. Hint: "The line looks like `setup token: 7Q2M-…-PB3W` (valid 60 min)".
- "Setup token" `Input`, mono, placeholder `XXXX-XXXX-XXXX-XXXX`, focused on load.
- A full-width primary "`lock` Unlock setup" `Button` (`size="lg"`).
- Muted `text-xs` footer: "The token works once and runs out after 60 minutes. Restart the container for a new one. Setting the relay variables in env skips this page entirely." plus a "Configuration docs" link.
- **Wrong token:** the input gets the destructive border and a destructive hint, "`circle-x` That token doesn’t match. Check the logs for a newer one. 4 tries left." After 5 wrong tries the token is dead, and the hint says to restart the container.
- **Token rules:** the server prints a new token to the logs at each start while setup is open. It is valid for 60 minutes and 5 tries, and unlocking uses it up. Unlocking starts a setup session that ends when those 60 minutes run out or setup finishes. The token never appears in the page.

### The steps

A `max-w-[1040px]` page: a 240px stepper column, then the step `Card`, with a 40px gap.

- **Stepper** (`nav`, `aria-label="Setup steps"`, sticky): one row per step with a 28px round marker, the step name (500) and a muted `text-xs` line. The current step is on `muted` with a `primary` marker and `aria-current="step"`. Done steps show `check` on a 14% `success` tint, and later steps a numbered outline marker in muted text. Under the steps, a dashed note: "`lock` Setup closes for good when you finish, and the token in the logs stops working."
  1. Dashboard key · Its own read-only identity
  2. Owner · You vouch for it, once
  3. Relay · Test the connection
  4. Optional sources · GitHub, media, history
  5. Finish · Review and close setup
- **Step card:** a muted "Step 2 of 5" kicker, the title (`text-xl font-semibold`), a muted description, the body, then a footer with a top border: ghost "`arrow-left` Back" on the left (none on step 1) and the primary "Continue `chevron-right`" on the right, both `h-10`. **Continue is disabled until the step passes** (`aria-disabled`, 50% opacity).
- **Phones:** the stepper is replaced by "Step 2 of 5 · Owner" (500) with "Next: Relay" muted on the right, over a 5-segment progress bar (4px, `foreground` for done and current, `border` for the rest). Footer buttons stack full width at 44px, Continue on top.

**1. Dashboard key.** "Give the dashboard its own key" · "The dashboard joins your relay as its own Nostr identity, never yours or an agent’s. We made one for it on this server."

- A bordered box: the 44px mark tile, "Hive dashboard" (500) and its npub (mono, muted, truncated), and an outline "`copy` Copy npub". Under it, muted `text-xs`: "`server` Generated just now. The private key stays on the server, in a file only the server can read. It is never sent to this browser."
- "What this key can do", three columns (stacked on phones): `circle-check` (success) "Answer the relay’s login challenge, so it can read your channels", then `circle-slash` (muted) "Post to a channel, DM anyone or act on GitHub" and "Hold your owner key. That stays in your extension."
- A `Collapsible`, "Already have a key for this dashboard?": "Set `BUZZ_PRIVATE_KEY` in the env file and restart. Setup then shows it here as “Set in env” and skips this step."
- The server generates the keypair on its first visit to this step, and only the npub goes to the browser. The private key is not encrypted at rest: it is the root key that #68 derives its wrapping key from, so it cannot be wrapped by itself. It is written to the config volume as a `0600` file owned by the server user, and that file permission is its only protection, the same as `BUZZ_PRIVATE_KEY` in an env file. The copy above must not say "encrypted".

**2. Owner.** "Vouch for the dashboard" · "Your relay only lets the dashboard in if a member vouches for its key. Your Nostr extension signs a one-time attestation (NIP-OA). Your key never leaves the extension." It reuses the NIP-07 sign-in from #40.

- **Ready:** a bordered box with a primary "`key-round` Sign with your extension" `Button`.
- **Waiting:** the box is centred and the button is disabled, with a spinning `loader-circle` and "Waiting for your extension…". Under it: "Approve the signing request in your extension’s popup." and muted "It asks to sign one event that names `npub1…`. Nothing is posted." A "Cancel" link goes back to Ready.
- **Signed:** a box on the 6% `success` tint with a 35% border: the 44px `Avatar`, the name (600) with a success `Badge` "`circle-check-big` Signed", the npub (mono, muted), and a "Use another account" link on the right. Muted under it: "Attestation for `npub1…` · signed just now with your extension". Then a dashed note: "`key-round` **Sam becomes the dashboard’s owner.** Only this account can sign in to snooze, ack and change sources, and only agents Sam has attested count as agents." Continue unlocks.
- **No extension:** a box on the 7% `warning` tint: "`triangle-alert` **No Nostr extension found in this browser**", "Install a NIP-07 extension (Alby, nos2x or similar), sign in to it with your owner account, then try again.", and an outline "`refresh-cw` Try again". Under it an open `Collapsible`, "Paste a signed attestation instead": a mono `Textarea` (placeholder `["auth","<owner hex>","<conditions>","<sig>"]`) and the hint "Sign it for `npub1…` with your own tooling." with a "How to make one" docs link. The server checks that a pasted tag names this dashboard's key before Continue unlocks.
- Signing sets the owner (`BUZZ_OWNER_PUBKEY`) and the auth tag (`BUZZ_AUTH_TAG`), and signs the owner in, so they leave setup signed in.

**3. Relay.** "Connect to your relay" · "Where your Buzz community lives. The dashboard logs in with its key and your attestation, then counts your agents."

- "Relay URL" `Input` (mono, `wss://` placeholder) with an outline "`plug-zap` Test again". The test runs by itself when the step opens.
- A checklist, `aria-live="polite"`, one row each with a status icon, the text and a muted right-hand detail:
  - "Reached the relay" · "84 ms".
  - "Logged in as `npub1…`, vouched for by Sam" · "NIP-42".
  - "**Found 14 agents** in 9 channels", with a 28px overlapping `Avatar` stack of the first five and "Fern, Gale, Juniper, Briar and 10 more" (muted, `text-xs`).
- **A check fails:** it gets `circle-x` and a bold destructive title in plain words, "The relay refused the login", then muted "The account that signed the attestation isn’t a member of this community. Sign with a member account, or add the dashboard’s key as a member in Buzz.", then the relay's own reply in mono `text-xs` ("relay said: restricted: not a member"), then an outline "`arrow-left` Back to Owner" when the fix is there. Checks after it show `circle-dashed`, muted, with "skipped". A failed "Reached the relay" says so and asks for the URL instead.

**4. Optional sources.** "Optional sources" · "Each one turns on more of the dashboard. Skip any of them: you can add them later in Settings → Sources." Continue is always on here.

- One bordered row per source: a 36px icon tile on `muted`, the name (500) with a status `Badge`, and a muted line saying what it turns on. On the right, an outline "Set up" that expands the row, or a `chevron-down` once it's open.
  - **GitHub** (`git-branch`) · "Pipeline, Releases, red CI and blocked issues in Needs you".
  - **Media bucket** (`images`) · "The Media view, from an R2 bucket (read-only key)".
  - **History database** (`database`) · "Postgres: Health, Cost, Timeline search, alerts and snooze".
- Badges: muted "Skipped" until tested, success "`circle-check-big` Tested" once the test passes. A failed test shows the plain-words reason under the Test button in destructive text, and the source stays Skipped.
- **GitHub, expanded:**
  - "Token": a password `Input` showing `github_pat_••••…Q7wd` with an `eye` toggle, and the hint "Fine-grained and read-only: Metadata, Issues, Pull requests, Actions and Deployments." plus a "Create one" link (`external-link`).
  - "Read repos owned by" (`GITHUB_OWNERS`): a tag field, one removable `Badge` per user or org (`x` button, `aria-label="Remove example-org"`), then an inline input "Add a user or org…". Enter or a comma adds one.
  - "Accounts that name agents in PRs" with a muted "optional" (`GITHUB_TRUSTED_AUTHORS`): the same tag field, hint "PRs from anyone else show as Unattributed."
  - An outline "`plug-zap` Test", then the result: "`circle-check-big` Token for `example-org` · 12 repos · 4,998 of 5,000 calls left".
- **Media bucket** and **History database** expand the same way, with their own fields (`MEDIA_BASE_URL` and the four `R2_*` values; `DATABASE_URL`) and a Test. Every secret field is a password input showing only its last 4 characters.

**5. Finish.** "Review and finish" · "Check everything once more. Finishing saves it and closes setup."

- A summary list, one row per item: a status icon (`circle-check-big` success, or `circle-dashed` muted for skipped), the label (muted, 140px), the value, and an "Edit" link that jumps back to that step. Values: the dashboard npub, the owner's name and npub, the relay URL with "· 14 agents", the GitHub owners with "· 12 repos", and "Skipped" or "Skipped · live view only" for the rest. Secrets show as their source, never their value. Rows stack on phones, with Edit on the right.
- A `muted` box: "`lock` **Finishing closes /setup for good.** The setup token stops working. Sign in as Sam to change sources in Settings, or set values in the env file, which always wins."
- The primary button reads "Finish setup `chevron-right`".

**Done.** The same centred 480px card as the gate: a 56px success circle with `check`, "The dashboard is ready", then muted "Connected to `relay.example.com` with 14 agents. You’re signed in as Sam, and /setup is now closed.", a primary "Open the dashboard `arrow-right`" (`size="lg"`) and a muted hint, "Next, if you want cost: Settings → Sources → Cost source."

- **Rules:** setup writes only the dashboard's own config. It never posts to the relay or GitHub. The attestation is signed in the extension and sent to the dashboard's server only. A value set in env shows as "Set in env", read-only, and its step or field is skipped.
- **Motion:** the spinner turns only while waiting on the extension or a test, and stays static under `prefers-reduced-motion`. Steps swap without animation.

## Components

Use stock shadcn/ui only, with no custom components: `Card`, `Badge`, `Table`, `ToggleGroup`, `Select`, `Avatar`, `Alert`, `Button`, `Dialog`, `Tooltip` and `ScrollArea`. Use shadcn charts (`ChartContainer` + Recharts `BarChart`) for every chart. One exception: the Agents card's 7-day sparkline is a small inline SVG, because it has no axes, tooltip or legend to justify adding Recharts. Switch it to a `BarChart` once another view adds Recharts. Icons come from `lucide-react`. The agent page adds `Breadcrumb` and `Skeleton`. The sidebar and Settings (#58) add `Sidebar`, `Sheet`, `Separator`, `Switch`, `Input` and `AlertDialog`. The history views (#39 to #47) add `Tabs`, `DropdownMenu`, `RadioGroup` and `Checkbox` (the signer dialog); their charts are stacked `BarChart`s (vertical for Health and Cost, `layout="vertical"` for the Flow step bars). The thin per-row bars in the Flow PR table and the Cost top-agents table are plain flex `div`s, like the sparkline, since they have no axes or tooltip. The setup wizard (#73) adds `Collapsible` and `Textarea`. Its tag fields are `Badge`s inside an `Input`-styled box, and its phone progress bar is plain `div`s. The one non-shadcn component is [motion-primitives](https://motion-primitives.com) `AnimatedNumber`, which brings in the `motion` package (approved by rtorcato on 2026-10-16). See Motion.

## Motion

Motion explains a change. It never decorates. It runs only when a value changes, never on a plain refresh where nothing changed. It animates `transform` and `opacity`, plus colour for tints. Every item turns off under `prefers-reduced-motion: reduce`, so values swap at once.

| What moves | How | Timing | Source |
|---|---|---|---|
| Cost chip amount and "Running N / 14" | `AnimatedNumber`, `springOptions: { bounce: 0, duration: 600 }` | ~600ms | motion-primitives. Use no bounce, so a % never wobbles across a threshold. |
| Cost chip and status badge change state | `transition-colors`, plus a fade and scale from 95% on the new badge | 200ms ease-out | tw-animate-css (`animate-in fade-in zoom-in-95`) |
| Needs-you row appears / leaves | fade and 4px slide from the top / fade out | 200ms in, 150ms out | transitions.dev list item (`animate-in fade-in slide-in-from-top-1`) |
| Stalled ring appears on a card | `transition-shadow` | 300ms, once | — |
| Cards re-sort (e.g. a stalled agent moves first) | `motion` `layout` on each card | 300ms, `cubic-bezier(0.16, 1, 0.3, 1)` | motion; easing from kinetics.colorion.co |
| Snooze menu opens / closes | fade and zoom from 95% | 150ms in, 100ms out | shadcn `DropdownMenu` default |
| History expands in Needs you, rule editor opens | height via `grid-template-rows: 0fr → 1fr`, plus fade | 200ms ease-out | transitions.dev accordion |
| Card hover | `translateY(-2px)` and a darker border | 150ms | transitions.dev card lift |
| Running dot | one `ping` when an agent goes to Running, then a steady dot | 1 × 1s | Tailwind `animate-ping`, run once. Never loop it: 12 pulsing dots is noise. |
| Agents card → agent page | native View Transitions: `view-transition-name` on the avatar and the name, so they morph into the hero | 250ms, same easing | Next.js `viewTransition` (experimental flag), no extra package |

No Lottie on these screens. A looping illustration pulls the eye on a screen you only glance at. Keep it for a future "All clear" state.

## Rules

- **Status = color + icon + label**, never color alone. Status colors are never used as chart series, with one exception: the Health turns chart, where the error series *is* the status (its legend carries the icon too).
- **Estimates are labelled.** Every dollar figure says "est." or sits under the "Estimated, at API list price" pill.
- **Unconnected sources show nothing,** never a zero or a placeholder figure (see History views).
- **Numbers** use `tabular-nums`. Repo names, SHAs and labels use Geist Mono at 13px.
- **Charts** have 4px rounded bar tops, a dashed recessive grid, a tooltip on hover, and a legend when there are two or more series.
- **Touch targets** are at least 36px on desktop, and rows are at least 44px on phones. Keep shadcn's default visible focus ring (`ring`).
- **Breakpoints:** below 640px, one column; `md`, 2 columns; `xl`, 3 columns or cards side by side. On phones the chart shows 7 days.
- **Freshness:** after 5 minutes without a successful refresh, "Updated 7m ago" turns `warning`. A failed source shows a destructive `Alert` on its own sections only. The other sections keep rendering.
- **Contrast:** meet WCAG 2.1 AA in both themes. The status tokens below are text-safe (at least 4.5:1) on `background` and on their own 10% tint.

## Data display notes

- **Build the agent roster from pubkeys, deduplicated.** The relay holds several profiles under the same name, and older names (for example Fizz and Comb) belong to agents that have since been renamed. Show one card per live agent, not one per profile.
- **Show repo names exactly as GitHub returns them.** Don't change their case.

## Docs site

The docs site (`apps/docs`, Docusaurus v3, themed by shared-docs) leads with the real dashboard, so a visitor sees what they get before reading a word. The home page answers "what does it look like?" with screenshots, not text cards.

It stays inside Docusaurus: only `src/pages/index.tsx` and `index.module.css` change, plus a token override in `src/css/custom.css`. Docs pages, navbar, sidebar, Siblings and the shared footer are untouched. Use Infima buttons (`button button--primary button--lg`, `button--secondary`), the shared `--jt-*` tokens and the honey `--ifm-color-primary` the site already ships. Honey is fine here: the "amber means waiting" rule is for the app, not its marketing page.

### Home page, top to bottom

1. **Hero** (centred, max 1120px).
   - Eyebrow pill in Geist Mono 13px with a green dot: "Read-only · self-hosted · one Docker image".
   - `h1` (clamp 2.5rem to 4rem, weight 800, tracking -0.035em): "Does anything need you *right now?*", with "right now?" in the accent colour (a `<span>`, not `<em>`, so it isn't read as emphasis).
   - Lede (1.25rem, `--jt-muted`, max 40rem): "A dashboard for your Buzz hive. See what every agent is doing and which pull requests are waiting on you, without scrolling a single channel."
   - CTAs: primary "Get started →" to `/docs/quick-start`, secondary "View on GitHub" to the repo.
   - A browser frame below the CTAs: 38px bar with three dots and a fake URL `hive.your-network.internal/agents` in mono, then the Agents screenshot. 1px `--jt-border` border, 14px top radius, no bottom border, a soft drop shadow, and a 120px fade into the page background at the bottom. A faint accent radial glow (14% light, 18% dark) sits behind the hero.
2. **"What you get today"**: kicker, `h2` "One page instead of every channel.", sub "Built for people running several agents that open issues and PRs. These are real views, shown with sample data." Then four feature rows, alternating image side (5fr copy / 7fr image, 56px gap, 72px between rows). Each row has a mono uppercase kicker in the accent, an `h3`, one paragraph and 2–3 ticks (an 18px accent-tinted check tile). Images sit in a 14px-radius bordered card with the same shadow.
   - **Needs you** (image right): "The answer sits on top of every view." Ticks: pull requests labelled merge-ready; a hive paused for usage, with a countdown to the reset; usage meters for the 5-hour and 7-day windows. Image: the Needs-you card crop.
   - **Agents** (image left): "Every agent at a glance." Ticks: running or stopped, uptime and last turn; what it is working on, from its latest message; home channel, messages today and a 7-day sparkline. Image: the agent grid crop.
   - **Agent page** (image right): "Drill into one agent." No ticks. "Runtime, model and activity over 7, 14 or 30 days. Claims and recent PRs join this page with the GitHub reader."
   - **Media** (image left): "Mockups and screenshots, by repo and day." No ticks. "Point it at your R2 bucket and every upload shows up within a minute, grouped by repo and date, with a copy-link button on each file."
3. **Phone band** (`--jt-bg2` background, 1px borders top and bottom): copy left ("On your phone" / "Check the hive from anywhere on your network" / "The same views fit a phone. Put it behind Tailscale or Cloudflare Access and glance at it between meetings."), two phone frames right (250 × 470, 40px radius, 10px ink bezel), dark first, light second offset 48px down.
4. **Principles** ("Small on purpose"): the three existing pillars, unchanged copy except the third ("No login, so it stays on your network."), each with a 36px accent-tinted icon tile: lucide `eye`, `bell`, `box`.
5. **Quick start** ("Running in two minutes", "Three relay settings in an env file, then one command."): copy and a primary "Read the quick start →" left, a code block right with the `.env` (`BUZZ_RELAY_URL`, `BUZZ_PRIVATE_KEY`, `BUZZ_OWNER_PUBKEY`) and the `docker run … -p 127.0.0.1:3000:3000 ghcr.io/rtorcato/buzz-dashboard:<tag>` line. Use Docusaurus `CodeBlock` (`@theme/CodeBlock`, `language="bash"`) so it gets the copy button and theme colours. Keep it in step with `docs/quick-start.md`.
6. **Next views** ("On the way"): three cards, Pipeline, Releases and Timeline, each with a dashed mono "Planned" pill and one line. Drop a card once its view ships and add a feature row for it.
7. **Siblings** and the **footer**: unchanged.

**Responsive:** below 996px (Infima's `--ifm` mobile breakpoint) the feature rows stack, image after copy whatever the desktop side, and the phone band stacks with the phones centred. Below 640px show one phone only (dark), and drop the browser-frame bar so the screenshot gets the width.

### Screenshots

- Real views running on sample data only. No real names, pubkeys, channels, repos or bucket keys. Sample repos are `example-app` style names.
- One light and one dark file per shot, in `apps/docs/static/img/screens/`: `agents`, `needs-you`, `agents-grid`, `agent-page`, `media` (desktop, 1440 × 900 viewport at 2x) and `mobile` (390 × 844 at 3x). `needs-you` and `agents-grid` are element captures of those regions of the Agents view, not CSS background crops, so they scale and carry their own alt text.
- Each pair renders through `@theme/ThemedImage` so the theme toggle swaps it. Wrap every `ThemedImage` in a `div` that carries the module class: ThemedImage sets `display: initial`, which beats a class put on it directly.
- Ship WebP (quality 82). Give every `img` `width` and `height` to avoid layout shift, `loading="lazy"` below the hero and `fetchpriority="high"` on the hero.
- A capture script regenerates the whole set when the UI changes, so nobody hand-crops. It starts the app in a sample-data mode, freezes the clock, and walks each view in both themes.

**Alt text** (keep it this specific):

| Shot | Alt |
|---|---|
| `agents` | The buzz-dashboard Agents view: a Needs-you card with three PRs ready to merge, four stat tiles, and a grid of agent cards with status, runtime and a 7-day sparkline. |
| `needs-you` | The Needs-you card listing PRs ready to merge and a usage pause with its reset countdown. |
| `agents-grid` | Agent cards, each with an avatar, status badge, runtime row, latest message and a 7-day sparkline. |
| `agent-page` | An agent page: avatar, Active badge, runtime strip, stat tiles and a Runtime panel. |
| `media` | The Media view: thumbnails grouped under example-app by date. |
| `mobile` | The Agents view on a phone. The first (dark) phone carries this alt; the second (light) phone is the same view, so it gets `alt=""`. |

### Accessibility

- Raise `--jt-faint` for this site in `custom.css`: `#5f6b7a` light (5.4:1 on white, 5.1:1 on `--jt-bg2`) and `#768397` dark (5.0:1 on `--jt-bg`, 4.6:1 on `--jt-surface`). These match the shared-docs fix (rtorcato/shared-docs#170), so delete the override once this site picks up that release. The shared values (`#8a95a5` 3.0:1 on white, `#647184` 3.9:1 on `#0a0e16`) fail AA for small text.
- Body text, muted text and the accent all pass AA in both themes: `--jt-muted` 5.8:1 light and 7.4:1 dark; honey `#a35d00` 5.1:1 on white; `#e19b34` on `#0a0e16` 8.2:1. The primary button's ink label on honey is 8.2:1 too.
- The fake browser bar, the glow, the check tiles and the icon tiles are decorative (`aria-hidden`). Headings stay in order: one `h1`, `h2` per band, `h3` per feature row.
- No motion. Nothing on this page needs it.

## Brand

The brand assets in [`brand/`](brand/) come from [`@rtorcato/brand-kit`](https://github.com/rtorcato/brand-kit): a dark README banner (desktop and mobile), a social card, and a favicon (`favicon.svg`, `favicon-512.png`, `favicon.ico`). Buzz is a bee, so the brand is honey and honeycomb.

- **Mark:** the pulse cell (rtorcato's pick, 2026-10-21). A solid ink (`#0A0E16`) hive cell, a pointy-top hexagon with round corners, with a honey heartbeat line (2.2px, round caps) cut through it, on a rounded honey tile (`rx 8` on 32). It reads as "watching the hive" and stays sharp at 16px, where the earlier outlined honeycomb went muddy. The source is `brand/favicon.svg`; the banners and social card pull it in with `<image>`, so editing that one file updates every canvas. In the app, render the tile from the same SVG (import `src/app/icon.svg` or copy its two paths), never redraw it.
- **Accent:** amber honey `#e19b34` on dark (8.2:1 for ink on the tile, 8.1:1 on `#0d1117`). On light surfaces use `#a35d00` (5.1:1 on white). Honey sits between js-common gold and cf-common orange, so the mark and the honeycomb are what tell this repo apart.
- **Honeycomb field:** the banner, mobile banner and social card carry a faint honeycomb (accent strokes at 22%, a few cells filled with honey at 28%), faded away from the text. It is hand-added on top of brand-kit's output, so `brand-kit doctor` reports those three SVGs as differing from the brand meta. After a `brand-kit --update`, re-add the honeycomb `<g>` from git history and run `npx @rtorcato/brand-kit render`.
- **No light banners:** the honey accent is under 3:1 on white, so the README ships the dark banners only, like the other torcato.dev repos.
- **In the app:** honey appears on the logo tile only. Inside the app amber already means "paused" or "waiting on you", so the UI stays neutral and never uses the honey accent for anything else.
- **App icon:** copy `brand/favicon.ico` to `src/app/favicon.ico`, and `brand/favicon.svg` to `src/app/icon.svg`.
- **Regenerate:** `npx @rtorcato/brand-kit --update --accent '#e19b34'` after changing the tagline or accent, then re-add the honeycomb and run `npx @rtorcato/brand-kit doctor`. Don't hand-edit the PNGs.

## Tokens

The theme is shadcn's `neutral` base, unchanged. On top of it there are three status tokens (`--success`, `--warning`, `--info`) and re-stepped `--chart-1..3`. shadcn's default chart colors change hue between themes, so these keep "opened" blue and "merged" orange in both themes, and the pair passes a colorblind check. The honey brand accent stays out of the UI, because amber means "waiting on you".

Merge these into `src/app/globals.css`. Values not listed keep the shadcn defaults.

```css
:root {
  --success: oklch(0.527 0.154 150.069);   /* green-700 */
  --warning: oklch(0.555 0.163 48.998);    /* amber-700 */
  --info: oklch(0.546 0.245 262.881);      /* blue-600 */

  --chart-1: #2a78d6;                      /* PRs opened */
  --chart-2: #eb6834;                      /* PRs merged */
  --chart-3: oklch(0.708 0 0);             /* neutral single-series activity */
}

.dark {
  --success: oklch(0.792 0.209 151.711);   /* green-400 */
  --warning: oklch(0.828 0.189 84.429);    /* amber-400 */
  --info: oklch(0.707 0.165 254.624);      /* blue-400 */

  --chart-1: #3987e5;
  --chart-2: #d95926;
  --chart-3: oklch(0.556 0 0);
}

@theme inline {
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-info: var(--info);
}
```

**History views (#39 to #47)** add three sets. Merge them the same way, with `--color-*` aliases in `@theme inline`.

```css
:root {
  --model-1: #2a78d6;   /* top price tier (opus) */
  --model-2: #1baf7a;   /* middle tier (sonnet) */
  --model-3: #6250d6;   /* low tier (haiku) */

  --stage-1: #86b6ef;  --stage-1-foreground: #0a0a0a;   /* opened → first review, 9.4:1 */
  --stage-2: #5598e7;  --stage-2-foreground: #0a0a0a;   /* review and changes, 6.6:1 */
  --stage-3: #104281;  --stage-3-foreground: #ffffff;   /* approved → merged, 9.9:1 */

  --mark: #fde68a;     --mark-foreground: #0a0a0a;      /* search match, Buzz badge, 15.9:1 */
}

.dark {
  --model-1: #3987e5;
  --model-2: #199e70;
  --model-3: #9085e9;

  --stage-1: #184f95;  --stage-1-foreground: #ffffff;   /* 8.1:1 */
  --stage-2: #256abf;  --stage-2-foreground: #ffffff;   /* 5.4:1 */
  --stage-3: #86b6ef;  --stage-3-foreground: #0a0a0a;   /* 9.4:1 */

  --mark: #5c4a00;     --mark-foreground: #fafafa;      /* 8.3:1 */
}
```

- **Model colours** pass the colorblind validator as a set in both themes. They are graphics, not text: against the background, light `--model-2` is 2.8:1, under the 3:1 for non-text contrast, so the stacked segments are split by 2px gaps and every value is also in the legend, the tooltip and the top-agents table. Don't use them for text.
- **Stage colours** run light to dark in step order in light mode and dark to light in dark mode, so the last step is always the most prominent. The in-bar hour labels use the paired `-foreground`, all AA.
- **`--mark`** is a pale highlight, not `--warning`, and always sits behind text, so it doesn't read as "waiting on you".

### Type

Use Geist for UI text and Geist Mono for code-like values, with Tailwind's default scale: page title `text-2xl font-semibold`, section heading `text-lg font-semibold`, card title `font-semibold leading-none`, stat value `text-3xl font-semibold tracking-tight tabular-nums`, body and descriptions `text-sm`, badges and meta `text-xs`, and code-like values `font-mono text-[13px]`.
