import { schnorr } from "@noble/curves/secp256k1.js";
import { cn } from "cn";
import {
  BookOpen,
  CircleCheckBig,
  Coins,
  Database,
  GitBranch,
  Info,
  Lock,
  type LucideIcon,
  Radio,
  TriangleAlert,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { CostSourcePicker } from "@/components/cost-source-picker";
import { EventIngestCard } from "@/components/event-ingest-card";
import { OtelSetup } from "@/components/otel-setup";
import { SignInButton } from "@/components/sign-in";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { formatAge } from "@/lib/age";
import { type AuthMode, authMode, getOwner, type Owner } from "@/lib/auth";
import { COST_DOCS, formatTokens } from "@/lib/cost";
import { ingestTokenRecord, signerRecord } from "@/lib/cost-source";
import { readServerEnv } from "@/lib/env";
import { defaultLinkHosts } from "@/lib/event-ingest";
import { envList } from "@/lib/github";
import { costReporters, historyEnabled, historyStats } from "@/lib/history";
import type { Agent } from "@/lib/hive";
import { maskToken } from "@/lib/ingest-token";
import { listPlatformTokens } from "@/lib/ingest-tokens";
import { npubEncode } from "@/lib/npub";
import { hiveOf } from "@/lib/projects";

// DESIGN.md → Settings → Sources (#42, #43). Where the numbers come from, and the
// one place the cost source is connected. Signed out it is read-only.

const AGENT_ROWS = 4;
/** An agent counts as reporting with a report in the last hour. */
const REPORTING_MS = 3_600_000;

const short = (npub: string) => `${npub.slice(0, 9)}…${npub.slice(-4)}`;
const shortDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const initials = (name: string) =>
  name
    .split(/[\s-]+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

// Never a key or a full URL on the page: a URL keeps only its host.
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "invalid URL";
  }
};

async function githubLine(token: string | undefined) {
  const owners = envList("GITHUB_OWNERS");
  const scope = owners.length ? `Token for ${owners.join(", ")}` : "Token set";
  try {
    const res = await fetch("https://api.github.com/rate_limit", {
      headers: { authorization: `Bearer ${token}` },
      next: { revalidate: 60 },
    });
    if (!res.ok) return scope;
    const { resources } = (await res.json()) as {
      resources: { core: { limit: number; remaining: number } };
    };
    return `${scope} · ${resources.core.remaining.toLocaleString("en-US")} of ${resources.core.limit.toLocaleString("en-US")} calls left this hour`;
  } catch {
    return scope;
  }
}

/** The address this page was opened at, for the endpoints agents post to. */
async function origin() {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  const at = (h.get("x-forwarded-host") ?? h.get("host") ?? "")
    .split(",")[0]
    .trim();
  return `${proto}://${at}`;
}

export async function SourcesTab({
  agents,
  showAll,
}: {
  agents: Agent[];
  showAll: boolean;
}) {
  const history = historyEnabled();
  const mode = authMode();
  const now = Date.now();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let env: ReturnType<typeof readServerEnv> | null = null;
  try {
    env = readServerEnv();
  } catch {
    env = null;
  }
  // #199: platform tokens are hive-scoped, so they need the relay too.
  const hive = history ? hiveOf(env?.buzzRelayUrl) : null;
  const [owner, record, signer, stats, reporters, github, base, platforms] =
    await Promise.all([
      getOwner(),
      ingestTokenRecord().catch(() => null),
      signerRecord().catch(() => null),
      history ? historyStats().catch(() => null) : null,
      history
        ? costReporters(new Date(now - 7 * 86_400_000), today).catch(() => [])
        : [],
      env?.githubToken ? githubLine(env.githubToken) : null,
      origin(),
      hive ? listPlatformTokens(hive).catch(() => null) : null,
    ]);
  const url = `${base}/otlp`;
  const canEdit = owner !== null && history;

  let dashboardKey: string | null = null;
  try {
    if (env) {
      dashboardKey = npubEncode(
        Buffer.from(
          schnorr.getPublicKey(Buffer.from(env.buzzPrivateKey, "hex")),
        ).toString("hex"),
      );
    }
  } catch {
    dashboardKey = null;
  }
  const lastEvent = Math.max(0, ...agents.map((a) => a.lastSeenAt ?? 0));

  // Every live agent, plus any that reports under another name.
  const reported = new Map(reporters.map((r) => [r.agent, r]));
  const names = [
    ...new Set([...agents.map((a) => a.name), ...reported.keys()]),
  ];
  const rows = names
    .map((name) => {
      const r = reported.get(name);
      const last = r?.last ? new Date(r.last).getTime() : null;
      return {
        name,
        last,
        tokensToday: r?.tokensToday ?? 0,
        ok: last !== null && now - last < REPORTING_MS,
      };
    })
    .sort(
      (a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name),
    );
  const reporting = rows.filter((r) => r.ok).length;
  const lastReport = Math.max(0, ...rows.map((r) => r.last ?? 0));

  return (
    <div className="space-y-6">
      <OwnerNote what="sources" owner={owner} mode={mode} />

      <Card className="gap-0 py-0">
        <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <h3 className="flex items-center gap-2 font-medium">
            <Radio className="size-4 text-muted-foreground" aria-hidden />
            Where the dashboard reads from
          </h3>
          <span className="text-xs text-muted-foreground">
            Checked every minute
          </span>
        </div>
        <ul className="divide-y border-t">
          <SourceRow
            icon={Radio}
            name="Buzz relay"
            status={env ? "ok" : "missing"}
            detail={
              env
                ? [
                    host(env.buzzRelayUrl),
                    dashboardKey && `read-only key ${short(dashboardKey)}`,
                    lastEvent > 0 &&
                      `last event ${formatAge(now - lastEvent * 1000)} ago`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "BUZZ_RELAY_URL or BUZZ_PRIVATE_KEY is not set"
            }
          />
          <SourceRow
            icon={GitBranch}
            name="GitHub"
            status={github ? "ok" : "warn"}
            warn="No token"
            detail={
              github ??
              "Public repos only, 60 API calls an hour. Add GITHUB_TOKEN for private repos and Releases."
            }
          />
          <SourceRow
            icon={Database}
            name="History database"
            status={stats ? "ok" : history ? "warn" : "off"}
            warn="Unreachable"
            detail={
              stats
                ? [
                    `Postgres · ${stats.events.toLocaleString("en-US")} events`,
                    stats.since && `since ${shortDate(stats.since)}`,
                    `keeps ${stats.retentionDays} days`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : history
                  ? "DATABASE_URL is set but the database didn’t answer"
                  : "Not set · live only"
            }
          />
        </ul>
        <p className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          These come from the dashboard’s env file. Change them there and
          restart. Keys are never shown here.
        </p>
      </Card>

      <Card className="gap-5 px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-medium">
            <Coins className="size-4 text-muted-foreground" aria-hidden />
            Cost source
          </h3>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs font-medium">
            <Info className="size-3.5" aria-hidden />
            Estimated, at API list price
          </span>
        </div>

        <CostSourcePicker
          source={signer ? "signer" : "otel"}
          canEdit={canEdit}
        />

        {signer ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md border border-success/20 bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success">
              <CircleCheckBig className="size-3" aria-hidden />
              Connected
            </span>
            <span className="font-mono">bunker://…</span>·
            <span className="font-mono">
              {short(npubEncode(signer.pubkey))}
            </span>
            ·{" "}
            {lastReport
              ? `last turn ${formatAge(now - lastReport)} ago`
              : "No turns read yet. This updates by itself within a minute or two."}
          </p>
        ) : history ? (
          <OtelSetup
            endpoint={url}
            token={
              record
                ? { masked: maskToken(record), createdAt: record.createdAt }
                : null
            }
            canEdit={canEdit}
            reporting={reporting}
            agents={rows.length}
            lastReportAgo={
              lastReport ? `${formatAge(now - lastReport)} ago` : null
            }
          />
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            The cost source keeps its reports in the history database. Set
            DATABASE_URL and restart to connect one.
          </p>
        )}

        {!signer && record && rows.length > 0 && (
          <AgentsTable rows={rows} showAll={showAll} now={now} />
        )}

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
          <a
            href={COST_DOCS}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-foreground underline underline-offset-3"
          >
            <BookOpen className="size-3.5" aria-hidden />
            How cost data works
          </a>
          · The dashboard stays read-only either way. It never posts to Buzz or
          GitHub.
        </p>
      </Card>

      {hive && platforms && (
        <Card className="gap-0 px-4 sm:px-6">
          <EventIngestCard
            endpoint={`${base}/api/events`}
            platforms={platforms}
            defaultHosts={defaultLinkHosts(env?.buzzRelayUrl)}
            canEdit={canEdit}
            now={now}
          />
        </Card>
      )}
    </div>
  );
}

/** "Only the owner can change …", with who is signed in or a sign-in button. */
export function OwnerNote({
  what,
  owner,
  mode,
}: {
  what: string;
  owner: Owner | null;
  mode: AuthMode | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm text-muted-foreground">
      <Lock className="size-4 shrink-0" aria-hidden />
      <p className="flex-1">
        Only the owner can change {what}
        {owner && (
          <>
            {" "}
            · signed in as{" "}
            {owner.via === "nostr" ? (
              <span className="font-mono">
                {short(npubEncode(owner.pubkey))}
              </span>
            ) : (
              owner.user
            )}
          </>
        )}
        {!owner &&
          !mode &&
          " · owner sign-in is off (set AUTH_MODE, and AUTH_PUBLIC_URL for nostr)"}
      </p>
      {!owner && mode === "nostr" && <SignInButton />}
    </div>
  );
}

function SourceRow({
  icon: Icon,
  name,
  status,
  warn,
  detail,
}: {
  icon: LucideIcon;
  name: string;
  status: "ok" | "warn" | "off" | "missing";
  warn?: string;
  detail: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:px-6">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {name}
          {status === "ok" && (
            <Badge tone="success" icon={CircleCheckBig}>
              Connected
            </Badge>
          )}
          {(status === "warn" || status === "missing") && (
            <Badge tone="warning" icon={TriangleAlert}>
              {status === "missing" ? "Not set" : warn}
            </Badge>
          )}
        </p>
        <p
          className={cn(
            "truncate font-mono text-xs text-muted-foreground",
            status === "warn" && "whitespace-normal font-sans",
          )}
        >
          {detail}
        </p>
      </div>
      <span className="text-xs text-muted-foreground max-sm:w-full max-sm:pl-12">
        Set in env
      </span>
    </li>
  );
}

function Badge({
  tone,
  icon: Icon,
  children,
}: {
  tone: "success" | "warning";
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
        tone === "success"
          ? "border-success/20 bg-success/10 text-success"
          : "border-warning/20 bg-warning/10 text-warning",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {children}
    </span>
  );
}

function AgentsTable({
  rows,
  showAll,
  now,
}: {
  rows: {
    name: string;
    last: number | null;
    tokensToday: number;
    ok: boolean;
  }[];
  showAll: boolean;
  now: number;
}) {
  const shown = showAll ? rows : rows.slice(0, AGENT_ROWS);
  return (
    <div className="rounded-lg border">
      <p className="px-4 py-3 text-sm font-medium">
        Agents{" "}
        <span className="font-normal text-muted-foreground">
          · reports in the last hour
        </span>
      </p>
      <div className="overflow-x-auto border-t">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 font-medium">Agent</th>
              <th className="px-2 py-2 font-medium">Last report</th>
              <th className="px-2 py-2 text-right font-medium max-md:hidden">
                Tokens today
              </th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => (
              <tr key={r.name} className={cn(!r.ok && "bg-warning/6")}>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <Avatar className="size-6">
                      <AvatarFallback className="text-[10px] font-medium">
                        {initials(r.name)}
                      </AvatarFallback>
                    </Avatar>
                    {r.name}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-muted-foreground tabular-nums">
                  {r.last === null ? "never" : `${formatAge(now - r.last)} ago`}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums max-md:hidden">
                  {formatTokens(r.tokensToday)}
                </td>
                <td className="px-4 py-2.5">
                  {r.ok ? (
                    <span className="flex items-center gap-1.5 text-success">
                      <CircleCheckBig className="size-4" aria-hidden />
                      Reporting
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-warning">
                      <TriangleAlert className="size-4" aria-hidden />
                      No reports · check its env
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
        <span>
          Showing {shown.length} of {rows.length} · problems first
        </span>
        {!showAll && rows.length > shown.length && (
          <Link
            href="/settings?tab=sources&agents=all"
            scroll={false}
            className="text-sm text-foreground underline underline-offset-3"
          >
            Show all ›
          </Link>
        )}
      </p>
    </div>
  );
}
