"use client";

import { useCopy } from "@rtorcato/react-common";
import { Check, Copy, Info, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  desktopSteps,
  SETTINGS,
  type Setting,
  stepsText,
} from "@/lib/agent-settings";

// DESIGN.md → "Agent settings, reference-only" (#109). Read-only rows and one
// button that opens Buzz Desktop steps; nothing is ever saved from here.
// ponytail: Model and Effort only, from the status feed. The other rows
// (runtime, parallel turns, responds to, timeouts, prompt) need the relay
// config reader, and an unconnected source shows nothing (DESIGN.md → Rules).

export type AgentSettingsData = {
  model: string | null;
  effort: string | null;
  /** e.g. "From the status feed · as of 2m ago". */
  source: string;
  stopped: boolean;
};

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
  const rows: [Setting, string | null][] = [
    ["Model", data.model],
    ["Effort", data.effort],
  ];
  return (
    <Card className={`gap-4 p-5 ${className}`}>
      <div className="space-y-2">
        <h2 className="font-semibold">Agent settings</h2>
        <Badge variant="outline" className="text-muted-foreground">
          <Lock aria-hidden />
          Managed in Buzz Desktop
        </Badge>
        <p className="text-xs text-muted-foreground">{data.source}</p>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 text-right">
              {v === null ? (
                <span className="text-muted-foreground">Not reported</span>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="block truncate font-mono text-xs leading-5" />
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
      <Button
        variant="outline"
        className="h-11 sm:h-9"
        onClick={() => setOpen(true)}
      >
        Change in Buzz Desktop
      </Button>
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
            {setting === "Effort" && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                default = the model decides
              </p>
            )}
          </SelectContent>
        </Select>
      </div>
      {now[setting] && (
        <p className="-mt-1 text-xs text-muted-foreground">
          Now <span className="font-mono">{now[setting]}</span>
        </p>
      )}
      {stopped && (
        <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {name} is stopped, so it won&apos;t see the change until it starts.
        </p>
      )}
      <ol className="list-decimal space-y-1.5 pl-5" aria-live="polite">
        <li>
          Open Buzz Desktop → Agents → <strong>{name}</strong> → Edit
        </li>
        <li>
          Set {setting} to <strong className="font-mono">{value}</strong>
        </li>
        <li>
          {stopped ? (
            <>
              Save, then <strong>Start</strong> {name} so it loads the new
              value.
            </>
          ) : (
            `Save. ${name} picks it up on its next turn.`
          )}
        </li>
      </ol>
      <DialogFooter>
        <Button
          variant="outline"
          className="h-11 whitespace-nowrap sm:h-9"
          onClick={() => {
            copy(stepsText(steps));
            toast("Steps copied");
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
