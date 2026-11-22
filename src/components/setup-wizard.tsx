"use client";

import { useCopy } from "@rtorcato/react-common";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleCheck,
  CircleCheckBig,
  CircleDashed,
  CircleSlash,
  CircleX,
  Copy,
  ExternalLink,
  KeyRound,
  Lock,
  PlugZap,
  Server,
  ShieldCheck,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import {
  DoneCard,
  FinishStep,
  SourcesStep,
} from "@/components/setup-wizard-sources";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { normaliseRelayUrl } from "@/lib/relay-url";

// DESIGN.md → Setup wizard → The steps.
const STEPS = [
  { name: "Dashboard key", line: "Its own read-only identity" },
  { name: "Owner", line: "Vouch for it in Buzz, once" },
  { name: "Relay", line: "Test the connection" },
  { name: "Optional sources", line: "GitHub, media, history" },
  { name: "Finish", line: "Review and close setup" },
] as const;

const npubOf = (hex: string) => nip19.npubEncode(hex);

export function SetupWizard() {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<boolean[]>(STEPS.map(() => false));
  const [finished, setFinished] = useState<string | null>(null);
  const pass = (i: number, ok = true) =>
    setDone((d) => d.map((v, j) => (j === i ? ok : v)));

  if (finished !== null) return <DoneCard host={finished} />;

  return (
    <div className="mx-auto grid w-full max-w-[1040px] gap-6 md:grid-cols-[240px_1fr] md:gap-10">
      <nav aria-label="Setup steps" className="hidden md:block">
        <ol className="sticky top-6 space-y-1">
          {STEPS.map((s, i) => (
            <li
              key={s.name}
              aria-current={i === step ? "step" : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 ${i === step ? "bg-muted" : ""}`}
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs ${
                  i === step
                    ? "border-primary bg-primary text-primary-foreground"
                    : done[i]
                      ? "border-transparent bg-success/14 text-success"
                      : "text-muted-foreground"
                }`}
              >
                {done[i] && i !== step ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  i + 1
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{s.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {s.line}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex gap-1.5 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Setup closes for good when you finish, and the token in the logs stops
          working.
        </p>
      </nav>

      <div className="min-w-0 space-y-4">
        <div className="md:hidden">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">
              Step {step + 1} of {STEPS.length} · {STEPS[step].name}
            </span>
            {STEPS[step + 1] && (
              <span className="text-xs text-muted-foreground">
                Next: {STEPS[step + 1].name}
              </span>
            )}
          </div>
          <div className="mt-2 flex gap-1" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={s.name}
                className={`h-1 flex-1 rounded-full ${i <= step ? "bg-foreground" : "bg-border"}`}
              />
            ))}
          </div>
        </div>

        <Card className="gap-5 p-6">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </p>
            {step === 0 && <KeyStep onPass={() => pass(0)} />}
            {step === 1 && <OwnerStep onPass={() => pass(1)} />}
            {step === 2 && <RelayStep onPass={(ok) => pass(2, ok)} />}
            {step === 3 && <SourcesStep />}
            {step === 4 && (
              <FinishStep onEdit={setStep} onFinished={setFinished} />
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t pt-4 max-md:flex-col-reverse max-md:items-stretch">
            {step > 0 ? (
              <Button
                variant="ghost"
                className="h-10 max-md:h-11"
                onClick={() => setStep(step - 1)}
              >
                <ArrowLeft aria-hidden /> Back
              </Button>
            ) : (
              <span />
            )}
            {step < 4 && (
              <Button
                className="h-10 max-md:h-11"
                aria-disabled={step !== 3 && !done[step]}
                disabled={step !== 3 && !done[step]}
                onClick={() => setStep(step + 1)}
              >
                Continue <ChevronRight aria-hidden />
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Heading({ title, text }: { title: string; text: string }) {
  return (
    <>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{text}</p>
    </>
  );
}

function KeyStep({ onPass }: { onPass: () => void }) {
  const [npub, setNpub] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on open; onPass is a fresh closure each render.
  useEffect(() => {
    fetch("/api/setup/key")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { pubkey: string }) => {
        setNpub(npubOf(j.pubkey));
        onPass();
      })
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      <Heading
        title="Give the dashboard its own key"
        text="The dashboard joins your relay as its own Nostr identity, never yours or an agent’s. We made one for it on this server."
      />
      <div className="space-y-3 pt-3">
        <div className="flex items-center gap-3 rounded-lg border p-3">
          {/* biome-ignore lint/performance/noImgElement: the 44px static mark. */}
          <img src="/icon.svg" alt="" className="size-11 rounded-md" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Hive dashboard</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {npub ?? (failed ? "Couldn’t make a key" : "Making a key…")}
            </p>
          </div>
          {npub && <CopyButton value={npub} label="Copy npub" />}
        </div>
        {failed && (
          <p role="alert" className="flex gap-1.5 text-xs text-destructive">
            <CircleX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            The server couldn’t save a key. Check that the config volume is
            writable, then reload.
          </p>
        )}
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Server className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The private key stays on the server, in a file only the server can
          read. It is never sent to this browser.
        </p>
        <div>
          <p className="mb-2 text-sm font-medium">What this key can do</p>
          <ul className="grid gap-2 text-sm md:grid-cols-3">
            <li className="flex gap-2">
              <CircleCheck
                className="mt-0.5 size-4 shrink-0 text-success"
                aria-hidden
              />
              Answer the relay’s login challenge, so it can read your channels
            </li>
            <li className="flex gap-2 text-muted-foreground">
              <CircleSlash className="mt-0.5 size-4 shrink-0" aria-hidden />
              Post to a channel, DM anyone or act on GitHub
            </li>
            <li className="flex gap-2 text-muted-foreground">
              <CircleSlash className="mt-0.5 size-4 shrink-0" aria-hidden />
              Hold your owner key. That stays in Buzz.
            </li>
          </ul>
        </div>
        <Collapsible>
          <CollapsibleTrigger className="text-sm underline">
            Already have a key for this dashboard?
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 text-xs text-muted-foreground">
            Set <code className="font-mono">BUZZ_PRIVATE_KEY</code> in the env
            file and restart. Setup then shows it here as “Set in env” and skips
            this step.
          </CollapsibleContent>
        </Collapsible>
      </div>
    </>
  );
}

type OwnerError = {
  kind: "not-a-proof" | "other-key" | "rejected" | "server";
  looksLikeKey?: boolean;
};

const Chip = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs">
    {children}
  </code>
);

// A 28px numbered marker; turns to a check on the success tint once done.
function PartMarker({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs ${
        done
          ? "border-transparent bg-success/14 text-success"
          : "text-muted-foreground"
      }`}
    >
      {done ? <Check className="size-3.5" aria-hidden /> : n}
    </span>
  );
}

function Part({
  n,
  done,
  title,
  line,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  line?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <PartMarker n={n} done={done} />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {line && <p className="text-xs text-muted-foreground">{line}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

// DESIGN.md → Setup wizard → 2. Owner (#175).
function OwnerStep({ onPass }: { onPass: () => void }) {
  const [dashKey, setDashKey] = useState<string | null>(null);
  const { copy, copied } = useCopy(2000);
  const [everCopied, setEverCopied] = useState(false);
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<OwnerError | null>(null);
  const [owner, setOwner] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/setup/key")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { pubkey: string }) => setDashKey(j.pubkey))
      .catch(() => setDashKey(null));
  }, []);

  const first = dashKey?.slice(0, 4);
  const last = dashKey?.slice(-4);

  async function check(value: string) {
    if (!value.trim() || busy || owner) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/setup/owner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tag: value }),
    }).catch(() => null);
    setBusy(false);
    const j = (await res?.json().catch(() => null)) as {
      owner?: string;
      kind?: OwnerError["kind"];
      looksLikeKey?: boolean;
    } | null;
    if (res?.ok && j?.owner) {
      setOwner(npubOf(j.owner));
      onPass();
    } else if (res?.status === 422 && j?.kind) {
      setError({ kind: j.kind, looksLikeKey: j.looksLikeKey });
    } else setError({ kind: "server" });
  }

  return (
    <>
      <Heading
        title="Let your Buzz account vouch for the dashboard"
        text="Your relay only lets the dashboard in if a member vouches for it. You do that once in Buzz desktop, then paste the proof it gives you here. Your own key never leaves Buzz."
      />
      <div className="space-y-5 pt-3">
        <Part
          n={1}
          done={everCopied || !!owner}
          title="Copy the dashboard’s key"
          line="This is the key Buzz will vouch for. It’s public, so it’s safe to copy and share."
        >
          <div className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {/* biome-ignore lint/performance/noImgElement: the 32px static mark. */}
              <img src="/icon.svg" alt="" className="size-8 rounded-md" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  Hive dashboard · public key
                </p>
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {dashKey ? (
                    <>
                      <span className="font-semibold text-foreground">
                        {first}
                      </span>
                      {dashKey.slice(4, -4)}
                      <span className="font-semibold text-foreground">
                        {last}
                      </span>
                    </>
                  ) : (
                    "Loading the key…"
                  )}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="h-10 max-md:h-11 max-md:w-full"
              disabled={!dashKey}
              onClick={() => {
                if (!dashKey) return;
                copy(dashKey);
                setEverCopied(true);
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy key"}
            </Button>
          </div>
        </Part>

        <Part n={2} done={!!owner} title="Authorize it in Buzz desktop">
          <ol className="space-y-1.5 text-sm">
            {[
              <>
                Open <Chip>Settings</Chip> › <Chip>Buzz</Chip> ›{" "}
                <Chip>Security</Chip>.
              </>,
              <>
                Select <Chip>Authorize external identity</Chip> and paste the
                key.
              </>,
              <>
                Select <Chip>Authorize identity</Chip>.
                {first && last && (
                  <>
                    {" "}
                    Check the key Buzz shows starts with{" "}
                    <code className="font-mono">{first}</code> and ends with{" "}
                    <code className="font-mono">{last}</code>.
                  </>
                )}
              </>,
              <>
                Select <Chip>Authorize this key</Chip>.
              </>,
              <>
                Select <Chip>Copy ownership proof</Chip>. Buzz puts the proof on
                your clipboard.
              </>,
            ].map((line, i) => (
              <li key={String(i)} className="flex gap-2">
                <span
                  className="w-4 shrink-0 font-mono text-xs leading-5 text-muted-foreground"
                  aria-hidden
                >
                  {"abcde"[i]}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </Part>

        <Part n={3} done={!!owner} title="Paste the proof here">
          <div className="space-y-2">
            <label htmlFor="owner-proof" className="sr-only">
              Ownership proof
            </label>
            <Textarea
              id="owner-proof"
              value={proof}
              onChange={(e) => {
                setProof(e.target.value);
                setError(null);
              }}
              onPaste={(e) => {
                // Check on paste, no button press: use the pasted text itself,
                // since state hasn't caught up yet.
                const text = e.clipboardData.getData("text");
                if (text.trim()) {
                  e.preventDefault();
                  setProof(text);
                  void check(text);
                }
              }}
              placeholder="Paste the proof Buzz copied"
              spellCheck={false}
              rows={4}
              readOnly={!!owner}
              className={`text-xs ${proof ? "font-mono" : ""} ${
                owner ? "border-success" : error ? "border-destructive" : ""
              }`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "owner-proof-error" : undefined}
            />
            {error && (
              <p
                id="owner-proof-error"
                role="alert"
                className="flex gap-1.5 text-xs text-destructive"
              >
                <CircleX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{ownerMessage(error, last)}</span>
              </p>
            )}
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
              <Button
                variant="outline"
                className="h-10 max-md:h-11 max-md:w-full"
                disabled={busy || !proof.trim() || !!owner}
                onClick={() => check(proof)}
              >
                <ShieldCheck aria-hidden /> Check proof
              </Button>
              <span className="text-xs text-muted-foreground">
                We check it as soon as you paste.
              </span>
            </div>
          </div>
        </Part>

        {owner && (
          <div
            className="space-y-2 rounded-lg border border-success/35 bg-success/6 p-3"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <Avatar size="lg">
                <AvatarFallback>
                  {owner.slice(5, 7).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <Badge variant="secondary" className="text-success">
                  <CircleCheckBig aria-hidden /> Proof checked
                </Badge>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {owner}
                </p>
              </div>
            </div>
            <p className="flex gap-1.5 text-xs text-muted-foreground">
              <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <strong className="font-semibold">
                  This account becomes the dashboard’s owner.
                </strong>{" "}
                Only it can sign in to snooze, ack and change sources.
              </span>
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Only paste a proof for this key. It doesn’t expire.{" "}
          <a
            className="inline-flex items-center gap-1 underline"
            href="https://docs.torcato.dev/buzz-dashboard/docs/relay-identity#owner-attestation"
            target="_blank"
            rel="noreferrer"
          >
            Step-by-step guide <ExternalLink className="size-3" aria-hidden />
          </a>
        </p>
      </div>
    </>
  );
}

function ownerMessage(e: OwnerError, last: string | undefined) {
  switch (e.kind) {
    case "other-key":
      return (
        <>
          <strong className="font-semibold">
            This proof isn’t for this dashboard’s key.
          </strong>{" "}
          Buzz may have authorized a different key. In Buzz, authorize the key
          above
          {last ? (
            <>
              , ending in <code className="font-mono">{last}</code>,
            </>
          ) : null}{" "}
          and copy a new proof.
        </>
      );
    case "not-a-proof":
      return (
        <>
          <strong className="font-semibold">
            That isn’t an ownership proof.
          </strong>{" "}
          {e.looksLikeKey && "It looks like a public key. "}In Buzz, finish step
          2 and select Copy ownership proof, then paste what it copies.
        </>
      );
    case "rejected":
      return (
        <>
          <strong className="font-semibold">
            Buzz didn’t make this proof for this dashboard.
          </strong>{" "}
          Copy a new proof from Buzz and paste it again.
        </>
      );
    default:
      return "The server couldn’t save that. Try again.";
  }
}

type CheckRow = {
  id: string;
  state: "ok" | "failed" | "skipped";
  title: string;
  detail?: string;
  relaySaid?: string;
};
type RelayResult = { ok: boolean; checks: CheckRow[]; agents: string[] };

function RelayStep({ onPass }: { onPass: (ok: boolean) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RelayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function test(input: string) {
    const target = normaliseRelayUrl(input);
    if (!target) return;
    setUrl(target);
    setBusy(true);
    setError(null);
    onPass(false);
    const res = await fetch("/api/setup/relay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: target }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as
      | (RelayResult & { error?: string })
      | null;
    setBusy(false);
    if (j?.checks) {
      setResult(j);
      onPass(j.ok);
    } else
      setError(j?.error ?? "The server couldn’t run the check. Try again.");
  }

  return (
    <>
      <Heading
        title="Connect to your relay"
        text="Where your Buzz community lives. The dashboard logs in with its key and your attestation, then counts your agents."
      />
      <div className="space-y-3 pt-3">
        <label
          htmlFor="relay-url"
          className="block space-y-1.5 text-sm font-medium"
        >
          Relay URL
          <div className="flex gap-2 max-md:flex-col">
            <Input
              id="relay-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="wss://relay.example.com"
              spellCheck={false}
              className="font-mono"
              aria-describedby="relay-url-hint"
            />
            <Button
              variant="outline"
              className="h-10 max-md:h-11"
              disabled={busy || !url.trim()}
              onClick={() => test(url)}
            >
              <PlugZap aria-hidden /> {result ? "Test again" : "Test"}
            </Button>
          </div>
        </label>
        <p id="relay-url-hint" className="text-xs text-muted-foreground">
          It’s the address you open Buzz at, with{" "}
          <code className="font-mono">wss://</code> in front. If your community
          is at{" "}
          <code className="font-mono">https://acme.communities.buzz.xyz</code>,
          enter{" "}
          <code className="font-mono">wss://acme.communities.buzz.xyz</code>.{" "}
          <a
            href="https://docs.torcato.dev/buzz-dashboard/docs/relay-identity#where-to-find-your-relay-url"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            How to find it
          </a>
        </p>
        {error && (
          <p role="alert" className="flex gap-1.5 text-xs text-destructive">
            <CircleX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <ul aria-live="polite" className="space-y-2">
          {result?.checks.map((c) => (
            <li key={c.id} className="flex gap-2 text-sm">
              {c.state === "ok" ? (
                <CircleCheck
                  className="mt-0.5 size-4 shrink-0 text-success"
                  aria-hidden
                />
              ) : c.state === "failed" ? (
                <CircleX
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden
                />
              ) : (
                <CircleDashed
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <p
                  className={
                    c.state === "failed"
                      ? "font-semibold text-destructive"
                      : c.state === "skipped"
                        ? "text-muted-foreground"
                        : ""
                  }
                >
                  {c.title}
                  {c.state === "skipped" && " · skipped"}
                </p>
                {c.state === "failed" && c.detail && (
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                )}
                {c.relaySaid && (
                  <p className="font-mono text-xs text-muted-foreground">
                    relay said: {c.relaySaid}
                  </p>
                )}
                {c.id === "agents" &&
                  c.state === "ok" &&
                  result.agents.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {result.agents.slice(0, 4).join(", ")}
                      {result.agents.length > 4 &&
                        ` and ${result.agents.length - 4} more`}
                    </p>
                  )}
              </div>
              {c.state === "ok" && c.detail && (
                <span className="text-xs text-muted-foreground">
                  {c.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
