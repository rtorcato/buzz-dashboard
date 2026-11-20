<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Setting up the relay identity

Installing the dashboard against a Buzz relay needs one step from the owner in Buzz desktop (Settings → Buzz → Security → Authorize external identity). Follow the ordered checklist in [`apps/docs/docs/relay-identity.md`](apps/docs/docs/relay-identity.md#agent-checklist) and the troubleshooting table there. Never ask for or send the private key, only the public key and the ownership proof.
