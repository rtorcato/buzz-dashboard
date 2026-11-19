import { cn } from "cn";
import {
  CircleCheckBig,
  CircleSlash,
  Clock,
  Database,
  HeartPulse,
  type LucideIcon,
  MessageCircleWarning,
  Moon,
  OctagonAlert,
  Plug,
  PlugZap,
  Radio,
  RefreshCw,
  Timer,
  TriangleAlert,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { HealthRange } from "@/components/health-range";
import { LocalTime } from "@/components/local-time";
import { SourceDown } from "@/components/states";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatAge } from "@/lib/age";
import { runtimeFor } from "@/lib/agents";
import { loadGitHub } from "@/lib/github";
import {
  type AgentHealth,
  buildHealth,
  type Counts,
  DEFAULT_HEALTH_RANGE,
  HEALTH_RANGES,
  type HealthBucket,
  type HealthSource,
  type HealthStatus,
  type HealthRange as Range,
  rate,
  SLOT_S,
  SOURCE_KINDS,
} from "@/lib/health";
import { healthSource } from "@/lib/health-data";
import { healthBuckets, historyEnabled } from "@/lib/history";
import { loadHive } from "@/lib/hive";
import { one, ownKey } from "@/lib/query";
import { loadStatusFeed } from "@/lib/status-feed";

export const metadata: Metadata = { title: "Health · Hive" };

const SOURCES = "/settings?tab=sources";
const TABLE_ROWS = 8;
// Light-mode text-destructive fails AA on its own tint (DESIGN.md → Sidebar).
const DANGER_TEXT = "text-red-700 dark:text-destructive";

const initials = (name: string) =>
  name
    .split(/[\s-]+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const pct = (n: number | null) =>
  n === null ? "—" : `${Math.round(n * 100)}%`;

const perHour = (n: number, hours: number) => {
  const v = n / hours;
  return v >= 10 || v === 0 ? String(Math.round(v)) : v.toFixed(1);
};

// With OpenTelemetry the unit is an API request, never a turn.
const unit = (source: HealthSource | null) =>
  source === "otel"
    ? { many: "API requests", short: "requests/h", head: "Requests/h" }
    : { many: "turns", short: "turns/h", head: "Turns/h" };

export default async function HealthPage({
  searchParams,
}: PageProps<"/health">) {
  // Health lives in the history store (#39); without it the view isn't there.
  if (!historyEnabled()) notFound();
  const params = await searchParams;
  const range: Range = ownKey(
    HEALTH_RANGES,
    one(params.range),
    DEFAULT_HEALTH_RANGE,
  );
  const rangeH = HEALTH_RANGES[range];
  const now = Math.floor(Date.now() / 1000);

  const [{ hive }, { feed }, github] = await Promise.all([
    loadHive(),
    loadStatusFeed(),
    loadGitHub(),
  ]);
  // The layout already shows the relay's Alert.
  if (!hive) return null;

  let source: HealthSource | null;
  let buckets: HealthBucket[];
  try {
    source = await healthSource();
    // The chart always covers 24h, so read at least that much.
    buckets = source
      ? await healthBuckets(
          new Date((now - Math.max(rangeH, 24) * 3600 - SLOT_S) * 1000),
          SOURCE_KINDS[source],
        )
      : [];
  } catch (err) {
    console.error("Health:", err);
    return (
      <SourceDown source="the history database">
        The Health query failed. Check DATABASE_URL and that Postgres is
        running; the other views are unaffected.
      </SourceDown>
    );
  }

  const agents = buildHealth({
    agents: hive.agents.map((a) => ({
      name: a.name,
      lastSeenAt: a.lastSeenAt,
      runtime: feed ? runtimeFor(a, feed.runtime) : undefined,
    })),
    claims: (github.github?.claims ?? []).flatMap((c) =>
      c.agent
        ? [
            {
              agent: c.agent,
              key: `${c.repo.split("/")[1]}#${c.number}`,
              claimedAt: c.claimedAt,
            },
          ]
        : [],
    ),
    buckets,
    now,
    rangeH,
  });
  const hiveHour = agents.reduce(
    (c, a) => ({
      attempts: c.attempts + a.hour.attempts,
      errors: c.errors + a.hour.errors,
    }),
    { attempts: 0, errors: 0 },
  );
  const sick = agents.find((a) => a.status === "failing");
  const showAll = one(params.agents) === "all";

  return (
    <div className="space-y-6">
      <h2 className="sr-only">Health</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <Radio className="size-3.5" aria-hidden />
            From the relay: presence, claims and silence · live
          </p>
          {source && (
            <p className="flex items-center gap-1.5">
              <Database className="size-3.5" aria-hidden />
              {source === "signer"
                ? "Error rates from per-turn reports (stop reason)"
                : "Error rates from OpenTelemetry · errors per API request"}
            </p>
          )}
        </div>
        <div className="md:ml-auto">
          <HealthRange range={range} />
        </div>
      </div>

      <HiveStrip agents={agents} source={source} now={now} />
      {sick && source && (
        <SickCard
          agent={sick}
          source={source}
          hive={hiveHour.attempts ? hiveHour.errors / hiveHour.attempts : null}
          now={now}
        />
      )}
      <ByAgent
        agents={agents}
        source={source}
        range={range}
        now={now}
        showAll={showAll}
        params={params as Record<string, string>}
      />
      <NeedsLog />
      <Link
        href={SOURCES}
        className={cn(buttonVariants({ variant: "outline" }), "h-9")}
      >
        <PlugZap aria-hidden />
        Connect a source
      </Link>
    </div>
  );
}

const STATUS: Record<
  HealthStatus,
  { icon: LucideIcon; tile: string; text: string }
> = {
  failing: {
    icon: OctagonAlert,
    tile: "border-destructive/55 bg-destructive/6",
    text: DANGER_TEXT,
  },
  silent: {
    icon: Clock,
    tile: "border-warning/55 bg-warning/6",
    text: "text-warning",
  },
  healthy: { icon: CircleCheckBig, tile: "", text: "text-success" },
  idle: { icon: Moon, tile: "", text: "text-muted-foreground" },
};

const claimText = (c: NonNullable<AgentHealth["claim"]>) =>
  c.more ? `${c.key} +${c.more}` : c.key;

function tileLine(a: AgentHealth, source: HealthSource | null) {
  switch (a.status) {
    case "failing":
      return {
        label: "Failing",
        fact: `${pct(rate(a.hour))} errors · 1h`,
      };
    case "silent":
      return {
        label: `Silent ${formatAge((a.silentFor ?? 0) * 1000)}`,
        fact: a.claim ? `holds ${claimText(a.claim)}` : "",
      };
    case "healthy":
      return {
        label: "Healthy",
        fact: source
          ? `${a.hour.attempts} ${unit(source).short}`
          : a.claim
            ? `holds ${claimText(a.claim)}`
            : "active",
      };
    default:
      return { label: "Idle", fact: "no claim · fine" };
  }
}

function HiveStrip({
  agents,
  source,
  now,
}: {
  agents: AgentHealth[];
  source: HealthSource | null;
  now: number;
}) {
  const n = (s: HealthStatus) => agents.filter((a) => a.status === s).length;
  const failing = n("failing");
  const silent = n("silent");
  return (
    <Card className="gap-4 px-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-medium">
          <HeartPulse className="size-4" aria-hidden />
          Hive health
        </h3>
        {failing > 0 && (
          <Badge variant="destructive">
            <OctagonAlert aria-hidden />
            {failing} failing
          </Badge>
        )}
        {silent > 0 && (
          <Badge className="bg-warning/10 text-warning">
            <TriangleAlert aria-hidden />
            {silent} silent
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {n("healthy")} healthy · {agents.length} agents
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {agents.map((a) => {
          const s = STATUS[a.status];
          const line = tileLine(a, source);
          return (
            <li
              key={a.name}
              className={cn("space-y-1.5 rounded-lg border p-3", s.tile)}
            >
              <div className="flex items-center gap-2">
                <Avatar className="size-6">
                  <AvatarFallback className="text-[10px] font-medium">
                    {initials(a.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 truncate text-sm font-medium">
                  {a.name}
                </span>
              </div>
              <p
                className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  s.text,
                )}
              >
                <s.icon className="size-4 shrink-0" aria-hidden />
                {line.label}
              </p>
              <p
                className="truncate text-xs text-muted-foreground tabular-nums"
                title={
                  a.lastTurn
                    ? `last turn ${formatAge((now - a.lastTurn) * 1000)} ago`
                    : undefined
                }
              >
                {line.fact}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function SickCard({
  agent: a,
  source,
  hive,
  now,
}: {
  agent: AgentHealth;
  source: HealthSource;
  hive: number | null;
  now: number;
}) {
  const u = unit(source);
  const signer = source === "signer";
  const rows: [string, ReactNode][] = [
    [
      "Error rate, last hour",
      <>
        <span className={cn("font-semibold", DANGER_TEXT)}>
          {pct(rate(a.hour))}
        </span>{" "}
        {a.hour.errors} of {a.hour.attempts} {u.many} · hive {pct(hive)}
      </>,
    ],
    [
      signer ? "Ended in error" : "Failed",
      signer ? (
        <>
          {a.hour.errors} turns (stop reason{" "}
          <code className="font-mono text-[13px]">error</code>)
        </>
      ) : (
        `${a.hour.errors} API errors`
      ),
    ],
    [
      "Cancelled",
      signer ? `${a.hour.cancelled} turns` : <NotConnected key="cancelled" />,
    ],
    [
      "Hit max tokens",
      signer ? `${a.hour.maxTokens} turns` : <NotConnected key="max" />,
    ],
    [
      "Holding",
      a.claim ? (
        <>
          <span className="font-mono text-[13px]">{claimText(a.claim)}</span> ·
          claimed {formatAge((now - a.claim.claimedAt) * 1000)} ago
        </>
      ) : (
        "no claim"
      ),
    ],
    ["Presence", a.online ? "Online" : "Away"],
  ];
  return (
    <Card className="gap-4 border-destructive/55 px-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Avatar className="size-8">
          <AvatarFallback className="text-xs font-medium">
            {initials(a.name)}
          </AvatarFallback>
        </Avatar>
        <h3 className="font-medium">{a.name}</h3>
        {a.failingSince && (
          <Badge variant="destructive">
            Failing since <LocalTime at={a.failingSince} />
          </Badge>
        )}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            {signer ? (
              <>
                The relay says <em>that</em> a turn failed, not <em>why</em>.
              </>
            ) : (
              <>
                The dashboard keeps <em>that</em> a request failed, not{" "}
                <em>why</em>.
              </>
            )}{" "}
            The error text lives in the agent’s log.{" "}
            <Link href={SOURCES} className="underline underline-offset-3">
              Connect a log or OTel source ›
            </Link>
          </p>
        </div>
        <HourlyChart agent={a} label={signer ? "Turns" : "API requests"} />
      </div>
    </Card>
  );
}

const NotConnected = () => (
  <span className="font-mono text-xs text-muted-foreground">not connected</span>
);

// Plain divs, like the Cost charts: no chart library. The error series is the
// one place a status colour is a chart series, because it *is* the status.
function HourlyChart({ agent, label }: { agent: AgentHealth; label: string }) {
  const max = Math.max(...agent.hourly.map((h) => h.ok + h.errors), 0);
  const step = Math.max(1, Math.ceil(max / 4));
  const scale = Math.max(step, Math.ceil(max / step) * step);
  const lines = Array.from({ length: scale / step + 1 }, (_, i) => i * step);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{label} per hour, last 24h</p>
        <ul className="flex gap-3 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-chart-3" aria-hidden />
            Finished
          </li>
          <li className="flex items-center gap-1.5">
            <OctagonAlert className={cn("size-3", DANGER_TEXT)} aria-hidden />
            <span className="size-2.5 rounded-sm bg-destructive" aria-hidden />
            Error
          </li>
        </ul>
      </div>
      <div className="relative h-36">
        {lines.map((l) => (
          <span
            key={l}
            className="absolute inset-x-0 border-t border-dashed border-border"
            style={{ bottom: `${(l / scale) * 100}%` }}
            aria-hidden
          />
        ))}
        <div className="relative flex h-full items-end gap-0.5">
          {agent.hourly.map((h, i) => {
            const ago = 23 - i;
            const tip = `${ago ? `${ago}h ago` : "This hour"}: ${h.ok} finished, ${h.errors} error`;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: hours are fixed and ordered
                key={i}
                title={tip}
                className="flex h-full flex-1 flex-col-reverse"
              >
                <span className="sr-only">{tip}</span>
                {h.ok > 0 && (
                  <span
                    className={cn(
                      "w-full bg-chart-3",
                      !h.errors && "rounded-t-[4px]",
                    )}
                    style={{ height: `${(h.ok / scale) * 100}%` }}
                  />
                )}
                {h.errors > 0 && (
                  <span
                    className="w-full rounded-t-[4px] bg-destructive"
                    style={{ height: `${(h.errors / scale) * 100}%` }}
                  />
                )}
                {h.ok + h.errors === 0 && (
                  <span className="h-px w-full bg-border" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="flex justify-between text-[10px] text-muted-foreground"
        aria-hidden
      >
        <span>24h ago</span>
        <span>Now</span>
      </div>
    </div>
  );
}

function ByAgent({
  agents,
  source,
  range,
  now,
  showAll,
  params,
}: {
  agents: AgentHealth[];
  source: HealthSource | null;
  range: Range;
  now: number;
  showAll: boolean;
  params: Record<string, string>;
}) {
  const u = unit(source);
  const signer = source === "signer";
  const hours = HEALTH_RANGES[range];
  const sorted = source
    ? agents.toSorted(
        (a, b) =>
          (rate(b.range) ?? -1) - (rate(a.range) ?? -1) ||
          b.range.attempts - a.range.attempts,
      )
    : agents;
  const shown = showAll ? sorted : sorted.slice(0, TABLE_ROWS);
  const cell = (c: Counts, k: keyof Counts) => pct(rate(c, k));
  return (
    <Card className="gap-0 py-0">
      <div className="px-4 py-4 sm:px-6">
        <h3 className="font-medium">By agent</h3>
        <p className="text-xs text-muted-foreground">
          {range}
          {source && " · sorted by error rate"}
        </p>
      </div>
      {!source && (
        <div className="px-4 pb-4 sm:px-6">
          <div className="rounded-lg border border-dashed p-4">
            <p className="text-sm font-medium">
              Error, cancelled and max-tokens rates
            </p>
            <p className="text-sm text-muted-foreground">
              They come from the connected cost source: per-turn reports or
              OpenTelemetry.
            </p>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              not connected
            </p>
          </div>
        </div>
      )}
      <div className="overflow-x-auto border-t">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 font-medium sm:pl-6">Agent</th>
              <th className="px-2 py-2 font-medium max-md:hidden">Presence</th>
              {source && (
                <>
                  <th className="px-2 py-2 text-right font-medium">{u.head}</th>
                  <th className="px-2 py-2 text-right font-medium">Error</th>
                </>
              )}
              {signer && (
                <>
                  <th className="px-2 py-2 text-right font-medium max-md:hidden">
                    Cancelled
                  </th>
                  <th className="px-2 py-2 text-right font-medium max-md:hidden">
                    Max tokens
                  </th>
                </>
              )}
              <th className="px-2 py-2 font-medium max-md:hidden">
                Silent while holding a claim
              </th>
              <th className="px-4 py-2 text-right font-medium sm:pr-6">
                Last turn
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((a) => {
              const failing = a.status === "failing";
              return (
                <tr key={a.name} className={cn(failing && "bg-destructive/5")}>
                  <td className="max-w-40 truncate px-4 py-2.5 sm:pl-6">
                    {a.name}
                  </td>
                  <td className="px-2 py-2.5 max-md:hidden">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          a.online ? "bg-success" : "bg-muted-foreground/50",
                        )}
                        aria-hidden
                      />
                      {a.online ? "Online" : "Away"}
                    </span>
                  </td>
                  {source && (
                    <>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {perHour(a.range.attempts, hours)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-2.5 text-right tabular-nums",
                          failing && cn("font-semibold", DANGER_TEXT),
                        )}
                      >
                        <span className="inline-flex items-center gap-1">
                          {failing && (
                            <OctagonAlert className="size-3.5" aria-hidden />
                          )}
                          {cell(a.range, "errors")}
                        </span>
                      </td>
                    </>
                  )}
                  {signer && (
                    <>
                      <td className="px-2 py-2.5 text-right tabular-nums max-md:hidden">
                        {cell(a.range, "cancelled")}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums max-md:hidden">
                        {cell(a.range, "maxTokens")}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-2.5 max-md:hidden">
                    {a.silentFor !== null && a.claim ? (
                      <span className="flex items-center gap-1.5 text-warning">
                        <Clock className="size-3.5" aria-hidden />
                        {formatAge(a.silentFor * 1000)} ·{" "}
                        <span className="font-mono text-[13px]">
                          {claimText(a.claim)}
                        </span>
                      </span>
                    ) : a.claim ? (
                      "no"
                    ) : (
                      <span className="text-muted-foreground">no claim</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground sm:pr-6">
                    {a.lastTurn
                      ? `${formatAge((now - a.lastTurn) * 1000)} ago`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
        <span>
          Showing {shown.length} of {agents.length}
          {source &&
            (signer
              ? " · error = turns whose stop reason was error"
              : " · error = API requests that failed (api_error)")}
        </span>
        {!showAll && agents.length > TABLE_ROWS && (
          <Link
            href={`/health?${new URLSearchParams({ ...params, agents: "all" })}`}
            scroll={false}
            className="underline underline-offset-3"
          >
            Show all
          </Link>
        )}
      </div>
    </Card>
  );
}

const LOG_METRICS: [string, LucideIcon, string][] = [
  ["Retries", RefreshCw, "Requests retried after an API error"],
  ["Dropped turns", CircleSlash, "Turns given up after every retry"],
  ["Last error", MessageCircleWarning, "The newest error message"],
  ["Turn duration", Timer, "How long each turn takes"],
];

// v1 has no log source (DESIGN.md → Settings → Sources), so these boxes stay
// "not connected" until one is specced.
function NeedsLog() {
  return (
    <Card className="gap-4 px-4 sm:px-6">
      <div>
        <h3 className="flex items-center gap-2 font-medium">
          <Plug className="size-4" aria-hidden />
          Needs a log or OTel source
        </h3>
        <p className="text-sm text-muted-foreground">
          The relay can’t see these. They come from each agent’s log or from
          OpenTelemetry. Nothing is shown until a source is connected, so these
          are never guesses.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {LOG_METRICS.map(([name, Icon, text]) => (
          <div key={name} className="rounded-lg border border-dashed p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Icon className="size-4" aria-hidden />
              {name}
            </p>
            <p className="text-sm text-muted-foreground">{text}</p>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              not connected
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
