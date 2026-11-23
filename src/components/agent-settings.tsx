"use client";

import { useCopy } from "@rtorcato/react-common";
import {
  Check,
  Copy,
  FilePenLine,
  Info,
  KeyRound,
  Lock,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useAgentConfig } from "@/components/agent-config-edit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type AgentSettingsValues,
  configSource,
  settingsProblem,
} from "@/lib/agent-config";
import { label, linesChanged, type SettingKey } from "@/lib/agent-config-edit";
import {
  desktopSteps,
  SETTINGS,
  type Setting,
  stepsText,
} from "@/lib/agent-settings";

// DESIGN.md → "Agent settings, reference-only" (#109). Read-only rows and one
// button that opens Buzz Desktop steps; nothing is ever saved from here.
// The rows come from the agent's relay config (#194), read in the owner's
// browser with their sign-in. Without a signer, or when the read fails, the
// card falls back to the status feed's model.

export type AgentSettingsData = {
  model: string | null;
  effort: string | null;
  /** e.g. "From the status feed · as of 2m ago". */
  source: string;
  /** The runtime the status feed reports, for another admin's card. */
  runtime?: string | null;
  stopped: boolean;
};

export type { RelayConfigTarget } from "@/components/agent-config-edit";

// Fade and scale from 96%; reduced motion keeps the fade only.
const MOTION =
  "duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-open:zoom-in-[0.96] data-closed:duration-150 data-closed:zoom-out-[0.96] motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100";

export function AgentSettings({
  name,
  data,
  className = "",
}: {
  name: string;
  data: AgentSettingsData;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ctx = useAgentConfig();
  const read = ctx?.read ?? { state: "idle" as const };
  const config = read.state === "read" ? read.config : null;
  const settings =
    config?.settings.state === "ok" ? config.settings.value : null;
  const instructions =
    config?.instructions.state === "ok" ? config.instructions.value : null;
  const problem = config && settingsProblem(config);
  const otherAdmin = ctx?.role === "admin";
  const editing = !!ctx?.editing && !!settings;
  // The #109 steps modal still covers Model and Effort.
  const rows: [Setting, string | null][] = [
    ["Model", settings ? settings.model : data.model],
    ["Effort", settings ? settings.effort : data.effort],
  ];
  // DESIGN.md → "Agent settings, read-only": the owner's rows, in this
  // order. Another admin gets only Model and Runtime from the status feed.
  const shown: [string, string | null][] = settings
    ? [
        ["Model", settings.model],
        ["Provider", settings.provider],
        ["Effort", settings.effort],
        ["Session scope", settings.scope],
        ["Runtime", settings.agentType],
      ]
    : otherAdmin
      ? [
          ["Model", data.model],
          ["Runtime", data.runtime ?? null],
        ]
      : rows;
  const source = config
    ? configSource(config, Math.floor(Date.now() / 1000))
    : read.state === "reading"
      ? "Reading the relay config…"
      : otherAdmin
        ? "From the status feed"
        : data.source;
  return (
    <Card
      className={`gap-4 p-5 ${editing ? "ring-2 ring-warning/40" : ""} ${className}`}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Agent settings</h2>
          {ctx?.prior && !editing && (
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-8"
              onClick={ctx.openRevert}
            >
              <RotateCcw aria-hidden />
              Revert to {ctx.prior.revision ?? "previous"}
            </Button>
          )}
        </div>
        {!settings && (
          <Badge variant="outline" className="text-muted-foreground">
            <Lock aria-hidden />
            Managed in Buzz Desktop
          </Badge>
        )}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {source}
        </p>
        {read.state === "failed" && (
          <p className="text-xs text-muted-foreground">
            {read.why} Showing the status feed.
          </p>
        )}
        {problem && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {problem}
          </p>
        )}
      </div>
      {editing && ctx && settings ? (
        <EditFields ctx={ctx} settings={settings} />
      ) : (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
          {shown.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">
                {k}
                {k === "Runtime" && (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-xs">
                    <Lock className="size-3" aria-hidden />
                    Set in Buzz Desktop
                  </span>
                )}
              </dt>
              <dd className="min-w-0 text-right">
                {v === null ? (
                  <span className="text-muted-foreground">
                    {settings && k !== "Runtime" ? "default" : "Not reported"}
                  </span>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          className={`block truncate leading-5 ${k === "Session scope" ? "" : "font-mono text-xs"}`}
                        />
                      }
                    >
                      {v}
                    </TooltipTrigger>
                    <TooltipContent className="font-mono">{v}</TooltipContent>
                  </Tooltip>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {instructions !== null && !editing && (
        <div className="space-y-1.5">
          <h3 className="text-sm text-muted-foreground">Instructions</h3>
          <p className="line-clamp-3 rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap">
            {instructions || "(empty)"}
          </p>
        </div>
      )}
      {(settings || otherAdmin) && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <KeyRound className="mt-px size-3.5 shrink-0" aria-hidden />
          {otherAdmin
            ? "Only the owner's key can read and change this agent's config. The rest stays in Buzz Desktop."
            : "Keys and provider credentials stay on the hive host. They're never shown or edited here."}
        </p>
      )}
      {!ctx?.canEdit && (
        <Button
          variant="outline"
          className="h-11 sm:h-9"
          onClick={() => setOpen(true)}
        >
          Change in Buzz Desktop
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={`${MOTION} max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-md`}
        >
          {open && (
            <Steps
              name={name}
              now={Object.fromEntries(rows)}
              stopped={data.stopped}
              done={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const SCOPES = [
  { value: "thread", label: "Thread" },
  { value: "channel", label: "Channel" },
  { value: "community", label: "Community" },
] as const;

/** Edit mode: the fields a goose settings revision takes, plus instructions. */
function EditFields({
  ctx,
  settings,
}: {
  ctx: NonNullable<ReturnType<typeof useAgentConfig>>;
  settings: AgentSettingsValues;
}) {
  const [sheet, setSheet] = useState(false);
  const value = (k: SettingKey) =>
    ctx.edits[k] ?? (settings[k] as string | null) ?? "";
  const was = (k: SettingKey) =>
    ctx.edits[k] !== undefined ? (settings[k] ?? "default") : null;
  const options = (k: "model" | "effort" | "provider") => {
    const set = new Set<string>(
      k === "model"
        ? ctx.choices.model
        : k === "effort"
          ? ctx.choices.effort
          : settings.provider
            ? [settings.provider]
            : [],
    );
    return ["", ...set];
  };
  const text = ctx.instructions ?? ctx.base.instructions ?? "";
  return (
    <div className="grid gap-4 text-sm">
      {(["model", "effort", "provider"] as const).map((k) => (
        <Field key={k} label={label(k)} was={was(k)}>
          <Select
            items={options(k).map((v) => ({
              value: v,
              label: v || "default",
            }))}
            value={value(k)}
            onValueChange={(v) => v !== null && ctx.setEdit(k, v)}
          >
            <SelectTrigger
              className={`h-11! w-full sm:h-9! ${k === "effort" ? "" : "font-mono"}`}
              aria-label={label(k)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options(k).map((v) => (
                <SelectItem
                  key={v || "default"}
                  value={v}
                  className={k === "effort" || !v ? "" : "font-mono"}
                >
                  {v ||
                    (k === "effort"
                      ? "default (the model decides)"
                      : "default")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ))}
      <Field label="Session scope" was={was("scope")}>
        <ToggleGroup
          variant="outline"
          aria-label="Session scope"
          value={[value("scope") || "thread"]}
          onValueChange={(next) => next[0] && ctx.setEdit("scope", next[0])}
        >
          {SCOPES.map((o) => (
            <ToggleGroupItem
              key={o.value}
              value={o.value}
              className="h-11 px-3 sm:h-9"
            >
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          Changing scope starts a fresh session on the next turn.
        </p>
      </Field>
      <Field label="Runtime" was={null}>
        <p className="flex items-center gap-2">
          <span className="font-mono text-xs">{settings.agentType}</span>
          <Badge variant="outline" className="text-muted-foreground">
            <Lock aria-hidden />
            Set in Buzz Desktop
          </Badge>
        </p>
      </Field>
      <Field label="Instructions" was={null} dirty={ctx.instructions !== null}>
        <p className="line-clamp-3 rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap">
          {text || "(empty)"}
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            className="h-11 sm:h-9"
            onClick={() => setSheet(true)}
          >
            <FilePenLine aria-hidden />
            Open editor
          </Button>
          {ctx.instructions !== null && (
            <span className="text-xs text-muted-foreground">
              {linesChanged(ctx.base.instructions ?? "", ctx.instructions)}
            </span>
          )}
        </div>
      </Field>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent className="w-full sm:max-w-2xl!">
          <SheetHeader>
            <SheetTitle>Instructions · {ctx.name}</SheetTitle>
            <SheetDescription>
              Saved with the settings through Review and save.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 px-4 pb-4">
            <Textarea
              value={text}
              onChange={(e) => ctx.setInstructions(e.target.value)}
              className="min-h-0 flex-1 resize-none font-mono text-xs"
              aria-label="Instructions"
              spellCheck={false}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({
  label: name,
  was,
  dirty,
  children,
}: {
  label: string;
  /** The old value while changed, else null. */
  was: string | null;
  dirty?: boolean;
  children: ReactNode;
}) {
  const changed = was !== null || dirty;
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {name}
        {changed && (
          <span className="size-1.5 rounded-full bg-warning">
            <span className="sr-only">changed</span>
          </span>
        )}
      </span>
      {children}
      {was !== null && (
        <span className="font-mono text-xs text-muted-foreground line-through">
          {was}
        </span>
      )}
    </div>
  );
}

function Steps({
  name,
  now,
  stopped,
  done,
}: {
  name: string;
  now: Record<string, string | null>;
  stopped: boolean;
  done: () => void;
}) {
  const [setting, setSetting] = useState<Setting>("Model");
  const values: readonly string[] = SETTINGS[setting].values;
  const [value, setValue] = useState<string>(values[0]);
  const { copy, copied } = useCopy(1500);
  const steps = desktopSteps(name, setting, value, stopped);
  const settingItems = Object.keys(SETTINGS).map((k) => ({
    value: k,
    label: k,
  }));
  const valueItems = values.map((v) => ({ value: v, label: v }));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Change a setting in Buzz Desktop</DialogTitle>
        <DialogDescription>
          The dashboard can&apos;t save agent settings yet.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          items={settingItems}
          value={setting}
          onValueChange={(v) => {
            if (!v) return;
            setSetting(v as Setting);
            setValue(SETTINGS[v as Setting].values[0]);
          }}
        >
          <SelectTrigger className="h-11! w-full sm:h-9!" aria-label="Setting">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {settingItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={valueItems}
          value={value}
          onValueChange={(v) => v && setValue(v)}
        >
          <SelectTrigger
            className="h-11! w-full font-mono sm:h-9!"
            aria-label="New value"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {valueItems.map((i) => (
              <SelectItem key={i.value} value={i.value} className="font-mono">
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(now[setting] || setting === "Effort") && (
        <p className="-mt-1 text-xs text-muted-foreground">
          {now[setting] && (
            <>
              Now <span className="font-mono">{now[setting]}</span>
            </>
          )}
          {now[setting] && setting === "Effort" && " · "}
          {setting === "Effort" && "default = the model decides"}
        </p>
      )}
      {stopped && (
        <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {name} is stopped, so it won&apos;t see the change until it starts.
        </p>
      )}
      <ol className="list-decimal space-y-1.5 pl-5" aria-live="polite">
        {steps.map((parts, i) => (
          <li key={parts[0]}>
            {parts.map((t, j) =>
              j % 2 ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed parts.
                <strong key={j} className={i === 1 ? "font-mono" : ""}>
                  {t}
                </strong>
              ) : (
                t
              ),
            )}
          </li>
        ))}
      </ol>
      <DialogFooter>
        <Button
          variant="outline"
          className="h-11 whitespace-nowrap sm:h-9"
          onClick={async () => {
            if (await copy(stepsText(steps))) toast("Steps copied");
            else toast.error("Couldn't copy. Select the steps instead.");
          }}
        >
          <span className="grid *:col-start-1 *:row-start-1">
            <Copy
              aria-hidden
              className={`transition duration-150 ${copied ? "scale-80 opacity-0" : "scale-100 opacity-100"}`}
            />
            <Check
              aria-hidden
              className={`transition duration-150 ${copied ? "scale-100 opacity-100" : "scale-80 opacity-0"}`}
            />
          </span>
          Copy steps
        </Button>
        <Button className="h-11 whitespace-nowrap sm:h-9" onClick={done}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
