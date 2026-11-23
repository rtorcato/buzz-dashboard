"use client";

// Agent config history with revert (#196). DESIGN.md → "Config history".
// Owner only: the revisions are read in the owner's browser with the owner's
// signer, like the current config (#194), so they never reach the server.
// "Revert to this" opens Review and save (#195) prefilled with the old
// snapshots; it publishes a new revision and never deletes one.

import { History, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DiffBlock,
  instructionsText,
  useAgentConfig,
} from "@/components/agent-config-edit";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  type AgentConfig,
  agoText,
  artifactD,
  INSTRUCTIONS_TYPE,
  SETTINGS_TYPE,
  tagOf,
} from "@/lib/agent-config";
import { lineDiffBlock, settingsLines } from "@/lib/agent-config-edit";
import {
  countTrack,
  type Entry,
  emptyTrack,
  entryTitle,
  hasOlder,
  isLive,
  loadOlder,
  type Part,
  revertTarget,
  shortKey,
  type Track,
  timeline,
} from "@/lib/agent-config-history";
import { npubEncode } from "@/lib/npub";

type Tracks = { settings: Track; instructions: Track };

type Load =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "loaded"; channel: string; tracks: Tracks; older: boolean }
  | { state: "failed"; why: string };

const headId = (h: AgentConfig["settings"] | AgentConfig["instructions"]) =>
  h.state === "missing" ? null : h.event.id;

/** The hero's History button and its sheet. Owner only, once config reads. */
export function AgentConfigHistory() {
  const ctx = useAgentConfig();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [picked, setPicked] = useState<string | null>(null);
  const config = ctx?.read.state === "read" ? ctx.read.config : null;
  const query = ctx?.query ?? null;
  const heads = useMemo(
    () => ({
      settings: config ? headId(config.settings) : null,
      instructions: config ? headId(config.instructions) : null,
    }),
    [config],
  );
  const channel = config?.channel ?? null;
  // A newer read (another load) replaces an older one's answer.
  const run = useRef(0);

  const first = useCallback(async () => {
    if (!query || !channel) return;
    const mine = ++run.current;
    setLoad((l) => (l.state === "loaded" ? l : { state: "loading" }));
    const [sd, id] = await Promise.all([
      artifactD(SETTINGS_TYPE, channel),
      artifactD(INSTRUCTIONS_TYPE, channel),
    ]);
    const [sCount, iCount] = await Promise.all([
      countTrack(query, channel, sd),
      countTrack(query, channel, id),
    ]);
    const [settings, instructions] = await Promise.all([
      loadOlder(query, channel, {
        ...emptyTrack(SETTINGS_TYPE, sd),
        count: sCount,
      }),
      loadOlder(query, channel, {
        ...emptyTrack(INSTRUCTIONS_TYPE, id),
        count: iCount,
      }),
    ]);
    if (mine !== run.current) return;
    if (settings.failed && instructions.failed) {
      setLoad({ state: "failed", why: "Couldn't read the history." });
      return;
    }
    setLoad({
      state: "loaded",
      channel,
      tracks: { settings, instructions },
      older: false,
    });
  }, [query, channel]);

  // Reads on open, and again when a save moves a head while it's open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: heads re-read.
  useEffect(() => {
    if (open) first();
  }, [open, first, heads.settings, heads.instructions]);

  const older = async () => {
    if (load.state !== "loaded" || !query) return;
    const mine = ++run.current;
    setLoad({ ...load, older: true });
    const { channel: ch, tracks } = load;
    const [settings, instructions] = await Promise.all([
      loadOlder(query, ch, tracks.settings),
      loadOlder(query, ch, tracks.instructions),
    ]);
    if (mine !== run.current) return;
    setLoad({
      state: "loaded",
      channel: ch,
      tracks: { settings, instructions },
      older: false,
    });
  };

  const entries = useMemo(
    () =>
      load.state === "loaded"
        ? timeline(load.tracks.settings, load.tracks.instructions, load.channel)
        : [],
    [load],
  );

  if (ctx?.role !== "owner" || !config || !query) return null;
  const now = Math.floor(Date.now() / 1000);
  const index = entries.findIndex((e) => e.key === picked);
  const entry = index >= 0 ? entries[index] : null;
  const tracks = load.state === "loaded" ? load.tracks : null;
  const more =
    tracks !== null &&
    (hasOlder(tracks.settings) || hasOlder(tracks.instructions));
  const failed =
    tracks !== null && (tracks.settings.failed || tracks.instructions.failed);
  const who = (pubkey: string) =>
    pubkey === ctx.signer ? "You" : shortKey(npubEncode(pubkey));

  return (
    <>
      <Button
        variant="outline"
        className="h-11 sm:h-9"
        onClick={() => setOpen(true)}
      >
        <History aria-hidden />
        History
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 max-sm:max-w-full sm:max-w-[560px]!">
          <SheetHeader>
            <SheetTitle>History · {ctx.name}</SheetTitle>
            <SheetDescription>
              Every save is a signed revision on the relay. Reverting publishes
              a new revision. It never deletes one.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6">
            {(load.state === "idle" || load.state === "loading") && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle
                  className="size-4 motion-safe:animate-spin"
                  aria-hidden
                />
                Reading the history…
              </p>
            )}
            {load.state === "failed" && (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertDescription className="space-y-2">
                  <p>{load.why}</p>
                  <Button
                    variant="outline"
                    className="h-11 sm:h-9"
                    onClick={first}
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {load.state === "loaded" && entries.length === 0 && (
              <p className="text-sm text-muted-foreground">No revisions yet.</p>
            )}
            {entries.length > 0 && (
              <ol className="space-y-2" aria-label="Revisions, newest first">
                {entries.map((e, k) => (
                  <li
                    key={e.key}
                    className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both"
                    style={{
                      animationDuration: "260ms",
                      animationDelay: `${80 + 35 * Math.min(k, 12)}ms`,
                    }}
                  >
                    <button
                      type="button"
                      aria-pressed={e.key === picked}
                      onClick={() =>
                        setPicked((p) => (p === e.key ? null : e.key))
                      }
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                        e.key === picked
                          ? "border-primary/40 bg-primary/10"
                          : ""
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{entryTitle(e)}</span>
                        {isLive(entries, e, heads) && (
                          <Badge
                            variant="outline"
                            className="border-success/40 bg-success/10 text-success"
                          >
                            Live
                          </Badge>
                        )}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {agoText(Math.max(0, now - e.at))}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                        {who(e.pubkey)} · {e.note ?? partsText(e)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {failed && (
              <p className="text-sm text-destructive">
                Some older revisions couldn&apos;t be read.
              </p>
            )}
            {more && (
              <Button
                variant="outline"
                className="h-11 w-full sm:h-9"
                disabled={load.state === "loaded" && load.older}
                onClick={older}
              >
                {load.state === "loaded" && load.older
                  ? "Loading…"
                  : "Load older"}
              </Button>
            )}
            {entry && tracks && (
              <Detail
                entry={entry}
                live={isLive(entries, entry, heads)}
                signer={who(entry.pubkey)}
                onRevert={() => {
                  ctx.revertTo(revertTarget(entries, index, tracks));
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

const partsText = (e: Entry) =>
  [e.settings && "settings", e.instructions && "instructions"]
    .filter(Boolean)
    .join(" and ");

function Detail({
  entry,
  live,
  signer,
  onRevert,
}: {
  entry: Entry;
  live: boolean;
  signer: string;
  onRevert: () => void;
}) {
  const title = entryTitle(entry);
  const when = new Date(entry.at * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <section className="space-y-3 border-t pt-4" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-medium">{title} · what changed</h3>
        {!live && (
          <Button variant="outline" className="h-11 sm:h-8" onClick={onRevert}>
            <RotateCcw aria-hidden />
            Revert to this
          </Button>
        )}
      </div>
      {!live && (
        <p className="text-sm text-muted-foreground">
          Revert brings back {title.charAt(0).toLowerCase() + title.slice(1)} as
          a new revision, through Review and save.
        </p>
      )}
      {entry.settings && (
        <PartDiff title="settings" part={entry.settings} text={settingsLines} />
      )}
      {entry.instructions && (
        <PartDiff
          title="instructions"
          part={entry.instructions}
          text={instructionsText}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Signed by {signer} ·{" "}
        <span className="font-mono">{shortKey(npubEncode(entry.pubkey))}</span>{" "}
        · {when}
      </p>
    </section>
  );
}

function PartDiff({
  title,
  part,
  text,
}: {
  title: string;
  part: Part;
  text: (content: string) => string;
}) {
  const op = tagOf(part.event, "op");
  const right =
    part.n === null
      ? ""
      : part.n > 1
        ? `${part.n - 1} → ${part.n}`
        : `${part.n}`;
  if (op === "delete") {
    return (
      <p className="text-sm text-muted-foreground">
        <span className="font-mono">{title}</span> deleted in Buzz Desktop.
      </p>
    );
  }
  if (part.beforeMissing) {
    return (
      <p className="text-sm text-muted-foreground">
        <span className="font-mono">{title}</span> changed. Load older revisions
        to see what it replaced.
      </p>
    );
  }
  const lines = lineDiffBlock(
    part.before ? text(part.before.content) : "",
    text(part.event.content),
  );
  return (
    <div className="space-y-1">
      <DiffBlock title={title} right={right} lines={lines} />
      {part.problem && (
        <p className="text-xs text-destructive">
          Buzz can&apos;t use this revision: {part.problem}.
        </p>
      )}
    </div>
  );
}
