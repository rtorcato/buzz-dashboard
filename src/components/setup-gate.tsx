"use client";

import { CircleX, Lock, SquareTerminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const CMD = 'docker compose logs dashboard | grep "setup token"';

// DESIGN.md → Setup wizard → The gate.
export function SetupGate() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<{ left: number; dead: boolean } | null>(
    null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/setup/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) return router.refresh();
    const j = (await res?.json().catch(() => null)) as {
      triesLeft: number;
      dead: boolean;
    } | null;
    setWrong({ left: j?.triesLeft ?? 0, dead: j?.dead ?? false });
  }

  return (
    <Card className="mx-auto w-full max-w-[480px] gap-5 p-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Set up this dashboard</h1>
        <p className="text-sm text-muted-foreground">
          It isn’t connected to a relay yet. To prove you run it, paste the
          one-time setup token from the container logs.
        </p>
      </div>
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <SquareTerminal className="size-4" aria-hidden /> Find it with
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {CMD}
          </code>
          <CopyButton value={CMD} label="Copy command" />
        </div>
        <p className="text-xs text-muted-foreground">
          The line looks like{" "}
          <code className="font-mono">setup token: 7Q2M-…-PB3W</code> (valid 60
          min)
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label
          htmlFor="setup-token"
          className="block space-y-1.5 text-sm font-medium"
        >
          Setup token
          <Input
            id="setup-token"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            aria-invalid={wrong ? true : undefined}
            className={`font-mono ${wrong ? "border-destructive" : ""}`}
          />
        </label>
        {wrong && (
          <p
            role="alert"
            className="flex items-start gap-1.5 text-xs text-destructive"
          >
            <CircleX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {wrong.dead
              ? "That token is used up. Restart the container for a new one."
              : `That token doesn’t match. Check the logs for a newer one. ${wrong.left} ${wrong.left === 1 ? "try" : "tries"} left.`}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy || !token.trim() || wrong?.dead}
        >
          <Lock aria-hidden /> Unlock setup
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        The token works once and runs out after 60 minutes. Restart the
        container for a new one. Setting the relay variables in env skips this
        page entirely.{" "}
        <a
          className="underline"
          href="https://docs.torcato.dev/buzz-dashboard/docs/configuration"
          target="_blank"
          rel="noreferrer"
        >
          Configuration docs
        </a>
      </p>
    </Card>
  );
}
