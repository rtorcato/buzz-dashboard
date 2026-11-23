---
title: Buzz Desktop plugin
sidebar_position: 9
---

# Buzz Desktop plugin

The Needs you page for Buzz Desktop shows the same rows as the dashboard's Needs you card, oldest first, with a count badge in the navigation. It is read-only: no snooze, no ack. You need a running dashboard.

The plugin holds no credentials. A small reader script on your Mac fetches `GET /api/needs-you` from your dashboard with a read token from the macOS Keychain. Your GitHub token never leaves the dashboard server, and plugin code never sees the read token.

This is macOS only, and v1 is unsigned.

## 1. Set the read token on the dashboard

Generate a token and set it as `NEEDS_YOU_READ_TOKEN` in the dashboard's environment, then restart it.

```sh
openssl rand -base64 32
```

It opens `GET /api/needs-you` and nothing else, including when `REQUIRE_SIGN_IN_FOR_READS=1`. To revoke it, change or unset the variable.

## 2. Install the reader

Copy the reader into `~/.buzz/bin` and make it executable. Buzz runs it only if its SHA-256 matches the one pinned in the plugin.

```sh
mkdir -p ~/.buzz/bin
curl -fsSL https://raw.githubusercontent.com/rtorcato/buzz-dashboard/<COMMIT>/plugin/reader/buzz-dashboard-needs-you-read \
  -o ~/.buzz/bin/buzz-dashboard-needs-you-read
chmod +x ~/.buzz/bin/buzz-dashboard-needs-you-read
shasum -a 256 ~/.buzz/bin/buzz-dashboard-needs-you-read
```

The last command must print the hash in [`plugin/README.md`](https://github.com/rtorcato/buzz-dashboard/blob/main/plugin/README.md).

## 3. Store the token and the dashboard address

Put the token in your login Keychain. The service name must be exactly this.

```sh
security add-generic-password -s buzz-dashboard-needs-you -a "$USER" -w
```

It prompts for the token, so it never lands in your shell history. Then tell the reader where the dashboard is. The address must be https.

```sh
mkdir -p ~/.config/buzz-dashboard
printf '{"url": "https://dashboard.example.com"}\n' > ~/.config/buzz-dashboard/plugin.json
```

Check it prints JSON:

```sh
~/.buzz/bin/buzz-dashboard-needs-you-read
```

## 4. Install the plugin

Open this link on the Mac running Buzz Desktop. Buzz shows an access review, and nothing installs until you accept it.

```
buzz://plugin-install?repository=rtorcato%2Fbuzz-dashboard&ref=main&path=plugin&commit=<COMMIT>
```

The review lists one command, the reader, pinned by hash. The plugin updates itself in the background. An update asks for a new review only if the reader changes.

## If it says "Dashboard not reachable"

Buzz couldn't read the dashboard. Check, in order:

1. The dashboard is up and `NEEDS_YOU_READ_TOKEN` is set on it.
2. The Keychain item exists: `security find-generic-password -s buzz-dashboard-needs-you`.
3. `~/.config/buzz-dashboard/plugin.json` holds an https address.
4. The reader prints JSON when you run it by hand.
5. The reader's hash matches the one in the README.
