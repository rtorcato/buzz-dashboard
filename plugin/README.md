# Needs you for Buzz Desktop

A read-only Buzz Desktop plugin that shows your buzz-dashboard's Needs you rows. Setup steps are in the docs: [Buzz Desktop plugin](../apps/docs/docs/desktop-plugin.md).

| File | What it is |
|---|---|
| `manifest.json` | Plugin id `buzz-dashboard.needs-you`, one host command `read`, pinned by SHA-256. |
| `plugin.js` | The page and the nav badge. Plain JS, no build step, no imports. |
| `reader/buzz-dashboard-needs-you-read` | POSIX `sh` reader. Install it at `~/.buzz/bin/`. |

## Reader SHA-256

```
630684f7221fc35bbd794118a719f4d5acd5b1840cdab2a018cd9b3b9c52dcf2
```

Keep `manifest.json` in step. Changing the reader changes this hash and asks every user for a new permission review, so keep it small and stable.

## What the reader does

It reads the dashboard address from `~/.config/buzz-dashboard/plugin.json` (https only) and the token from the Keychain item `buzz-dashboard-needs-you`. It calls `/usr/bin/curl` with the token in a config on stdin, never in argv, and prints one JSON line:

```
{"dashboard":"<address>","needsYou":{...}}
```

On any failure it prints nothing and exits non-zero, and the page shows "Dashboard not reachable". The token is never printed or logged.

## Develop

`pnpm test` covers the endpoint and the page. To try the page, open Settings → Plugins → Manage plugins → Add, and browse to this folder.
