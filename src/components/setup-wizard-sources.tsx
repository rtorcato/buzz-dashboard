"use client";

import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  CircleDashed,
  CircleX,
  Database,
  Eye,
  EyeOff,
  GitBranch,
  Images,
  Lock,
  PlugZap,
  X,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// DESIGN.md → Setup wizard → steps 4 and 5, and the Done card (#73 part 3c).

type Source = "github" | "media" | "database";
type Field = {
  key: string;
  label: string;
  secret?: boolean;
  tags?: boolean;
  optional?: boolean;
  placeholder?: string;
  hint?: ReactNode;
};
const SOURCES: {
  id: Source;
  name: string;
  line: string;
  icon: typeof GitBranch;
  fields: Field[];
}[] = [
  {
    id: "github",
    name: "GitHub",
    line: "Pipeline, Releases, red CI and blocked issues in Needs you",
    icon: GitBranch,
    fields: [
      {
        key: "GITHUB_TOKEN",
        label: "Token",
        secret: true,
        placeholder: "github_pat_…",
        hint: (
          <>
            Fine-grained and read-only: Metadata, Issues, Pull requests, Actions
            and Deployments.{" "}
            <a
              className="underline"
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
            >
              Create one
            </a>
          </>
        ),
      },
      { key: "GITHUB_OWNERS", label: "Read repos owned by", tags: true },
      {
        key: "GITHUB_TRUSTED_AUTHORS",
        label: "Accounts that name agents in PRs",
        tags: true,
        optional: true,
        hint: "PRs from anyone else show as Unattributed.",
      },
    ],
  },
  {
    id: "media",
    name: "Media bucket",
    line: "The Media view, from an R2 bucket (read-only key)",
    icon: Images,
    fields: [
      {
        key: "MEDIA_BASE_URL",
        label: "Public base URL",
        placeholder: "https://media.example.com",
      },
      { key: "R2_ACCOUNT_ID", label: "R2 account ID" },
      { key: "R2_BUCKET", label: "Bucket" },
      { key: "R2_ACCESS_KEY_ID", label: "Access key ID", secret: true },
      { key: "R2_SECRET_ACCESS_KEY", label: "Secret access key", secret: true },
    ],
  },
  {
    id: "database",
    name: "History database",
    line: "Postgres: Health, Cost, Timeline search, alerts and snooze",
    icon: Database,
    fields: [
      {
        key: "DATABASE_URL",
        label: "Connection string",
        secret: true,
        placeholder: "postgres://user:password@host:5432/hive",
      },
    ],
  },
];

export function SourcesStep() {
  const [open, setOpen] = useState<Source | null>(null);
  const [tested, setTested] = useState<Partial<Record<Source, string>>>({});
  return (
    <>
      <h1 className="text-xl font-semibold">Optional sources</h1>
      <p className="text-sm text-muted-foreground">
        Each one turns on more of the dashboard. Skip any of them: you can add
        them later in Settings → Sources.
      </p>
      <div className="space-y-3 pt-3">
        {SOURCES.map((s) => (
          <SourceRow
            key={s.id}
            source={s}
            open={open === s.id}
            detail={tested[s.id]}
            onToggle={() => setOpen(open === s.id ? null : s.id)}
            onTested={(d) => setTested((t) => ({ ...t, [s.id]: d }))}
          />
        ))}
      </div>
    </>
  );
}

function SourceRow({
  source,
  open,
  detail,
  onToggle,
  onTested,
}: {
  source: (typeof SOURCES)[number];
  open: boolean;
  detail?: string;
  onToggle: () => void;
  onTested: (detail: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = source.icon;
  const panel = `source-${source.id}`;

  async function test() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/setup/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: source.id, values }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      detail?: string;
      error?: string;
    } | null;
    setBusy(false);
    if (j?.ok && j.detail) onTested(j.detail);
    else setError(j?.error ?? "The server couldn’t run the test. Try again.");
  }

  const ready = source.fields
    .filter((f) => !f.optional)
    .every((f) => values[f.key]?.trim());

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-3 p-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            {source.name}
            {detail ? (
              <Badge variant="secondary" className="text-success">
                <CircleCheckBig aria-hidden /> Tested
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-muted-foreground">
                Skipped
              </Badge>
            )}
          </p>
          <p className="text-xs text-muted-foreground">{source.line}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={panel}
          onClick={onToggle}
        >
          {open ? <ChevronDown aria-hidden /> : "Set up"}
        </Button>
      </div>
      {open && (
        <div id={panel} className="space-y-3 border-t p-3">
          {source.fields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={values[f.key] ?? ""}
              locked={!!detail && !!f.secret}
              onChange={(v) => setValues((o) => ({ ...o, [f.key]: v }))}
            />
          ))}
          <Button
            variant="outline"
            className="h-10 max-md:h-11"
            disabled={busy || !ready}
            onClick={test}
          >
            <PlugZap aria-hidden /> {detail ? "Test again" : "Test"}
          </Button>
          <div aria-live="polite">
            {error && (
              <p role="alert" className="flex gap-1.5 text-xs text-destructive">
                <CircleX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}
            {detail && !error && (
              <p className="flex gap-1.5 text-xs text-muted-foreground">
                <CircleCheckBig
                  className="mt-0.5 size-3.5 shrink-0 text-success"
                  aria-hidden
                />
                {detail}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const last4 = (v: string) => (v ? `••••${v.slice(-4)}` : "");

function FieldInput({
  field,
  value,
  locked,
  onChange,
}: {
  field: Field;
  value: string;
  locked: boolean;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const id = `f-${field.key}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {field.label}
        {field.optional && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            optional
          </span>
        )}
      </label>
      {field.tags ? (
        <TagField
          id={id}
          label={field.label}
          value={value}
          onChange={onChange}
        />
      ) : (
        <div className="flex gap-2">
          <Input
            id={id}
            // Once tested, a secret shows only its last four characters.
            type={field.secret && !show && !locked ? "password" : "text"}
            value={locked ? last4(value) : value}
            readOnly={locked}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          {field.key === "GITHUB_TOKEN" && !locked && (
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label={show ? "Hide token" : "Show token"}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
          )}
        </div>
      )}
      {field.hint && (
        <p className="text-xs text-muted-foreground">{field.hint}</p>
      )}
    </div>
  );
}

// Badges inside an Input-styled box. Enter or a comma adds one.
function TagField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const tags = value.split(",").filter(Boolean);
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const t = raw.trim().replace(/,$/, "").trim();
    if (t && !tags.includes(t)) onChange([...tags, t].join(","));
    setDraft("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/50">
      {tags.map((t) => (
        <Badge key={t} variant="secondary" className="gap-1 font-mono">
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t).join(","))}
          >
            <X className="size-3" aria-hidden />
          </button>
        </Badge>
      ))}
      <input
        id={id}
        aria-label={`Add to ${label}`}
        value={draft}
        placeholder="Add a user or org…"
        spellCheck={false}
        className="min-w-32 flex-1 bg-transparent text-sm outline-none"
        onChange={(e) =>
          e.target.value.endsWith(",")
            ? add(e.target.value)
            : setDraft(e.target.value)
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}

type Summary = {
  key: string | null;
  owner: string | null;
  relay: string | null;
  github: { owners: string; source: string } | null;
  media: { source: string } | null;
  database: { source: string } | null;
};

const short = (hex: string) => {
  const n = nip19.npubEncode(hex);
  return `${n.slice(0, 12)}…${n.slice(-6)}`;
};

export function FinishStep({
  onEdit,
  onFinished,
}: {
  onEdit: (step: number) => void;
  onFinished: (host: string) => void;
}) {
  const [s, setS] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/setup/summary")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setS)
      .catch(() => setError("Couldn’t read the saved settings. Reload."));
  }, []);

  async function finish() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/setup/finish", { method: "POST" }).catch(
      () => null,
    );
    const j = (await res?.json().catch(() => null)) as {
      host?: string;
      error?: string;
    } | null;
    setBusy(false);
    if (res?.ok) onFinished(j?.host ?? "");
    else setError(j?.error ?? "The server couldn’t finish setup. Try again.");
  }

  const via = (x: { source: string }) =>
    x.source === "env" ? "Set in env" : "Saved";
  const rows: { label: string; value: string; ok: boolean; step: number }[] = s
    ? [
        {
          label: "Dashboard key",
          value: s.key ? short(s.key) : "Missing",
          ok: !!s.key,
          step: 0,
        },
        {
          label: "Owner",
          value: s.owner ? short(s.owner) : "Missing",
          ok: !!s.owner,
          step: 1,
        },
        {
          label: "Relay",
          value: s.relay ?? "Missing",
          ok: !!s.relay,
          step: 2,
        },
        {
          label: "GitHub",
          value: s.github
            ? `${s.github.owners.split(",").filter(Boolean).join(", ")} · ${via(s.github)}`
            : "Skipped",
          ok: !!s.github,
          step: 3,
        },
        {
          label: "Media bucket",
          value: s.media ? via(s.media) : "Skipped",
          ok: !!s.media,
          step: 3,
        },
        {
          label: "History database",
          value: s.database ? via(s.database) : "Skipped · live view only",
          ok: !!s.database,
          step: 3,
        },
      ]
    : [];
  const ready = !!s?.key && !!s.owner && !!s.relay;

  return (
    <>
      <h1 className="text-xl font-semibold">Review and finish</h1>
      <p className="text-sm text-muted-foreground">
        Check everything once more. Finishing saves it and closes setup.
      </p>
      <div className="space-y-3 pt-3">
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li
              key={r.label}
              className="flex items-center gap-3 p-3 text-sm max-md:flex-wrap"
            >
              {r.ok ? (
                <CircleCheckBig
                  className="size-4 shrink-0 text-success"
                  aria-hidden
                />
              ) : (
                <CircleDashed
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
              <span className="w-36 shrink-0 text-muted-foreground">
                {r.label}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {r.value}
              </span>
              <button
                type="button"
                className="text-sm underline"
                onClick={() => onEdit(r.step)}
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
        <p className="flex gap-2 rounded-md bg-muted p-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>Finishing closes /setup for good.</strong> The setup token
            stops working. Change sources later in Settings, or set values in
            the env file, which always wins.
          </span>
        </p>
        {error && (
          <p role="alert" className="flex gap-1.5 text-xs text-destructive">
            <CircleX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <Button
          className="h-10 max-md:h-11"
          disabled={busy || !ready}
          onClick={finish}
        >
          Finish setup <ChevronRight aria-hidden />
        </Button>
      </div>
    </>
  );
}

export function DoneCard({ host }: { host: string }) {
  return (
    <Card className="mx-auto max-w-[480px] items-center gap-4 p-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-success/14 text-success">
        <CircleCheckBig className="size-7" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">The dashboard is ready</h1>
      <p className="text-sm text-muted-foreground">
        {host ? `Connected to ${host}. ` : ""}/setup is now closed.
      </p>
      <a href="/" className={`${buttonVariants({ size: "lg" })} w-full`}>
        Open the dashboard <ArrowRight aria-hidden />
      </a>
      <p className="text-xs text-muted-foreground">
        Next, if you want cost: Settings → Sources → Cost source.
      </p>
    </Card>
  );
}
