"use client";

import { cn } from "cn";
import {
  Bell,
  BellRing,
  Clock,
  Coins,
  GitMerge,
  Hash,
  HeartPulse,
  KeyRound,
  type LucideIcon,
  MessageSquare,
  Moon,
  OctagonAlert,
  Plus,
  Rocket,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  type ChannelType,
  RULE_IDS,
  RULES,
  type Rule,
  type RuleId,
} from "@/lib/alerts";

// DESIGN.md → Settings tabs and Alerts (#45). Signed out every control is
// disabled; the server checks the owner on every write anyway.

export type ChannelView = {
  id: string;
  type: ChannelType;
  /** The URL, elided: the page never gets it in full. */
  target: string;
  on: boolean;
};

const CHANNEL: Record<
  ChannelType,
  {
    name: string;
    icon: LucideIcon;
    note?: string;
    badge?: string;
    hint: string;
  }
> = {
  ntfy: { name: "ntfy", icon: BellRing, hint: "https://ntfy.sh/your-topic" },
  slack: {
    name: "Slack-compatible webhook",
    icon: Hash,
    note: "Slack, Discord, Mattermost",
    hint: "https://hooks.slack.com/services/…",
  },
  webhook: {
    name: "Webhook",
    icon: Webhook,
    badge: "JSON",
    hint: "https://example.com/hooks/hive",
  },
  buzz: {
    name: "Buzz DM",
    icon: MessageSquare,
    badge: "Opt-in",
    hint: "",
  },
};

const RULE_ICON: Record<RuleId, LucideIcon> = {
  failing: HeartPulse,
  silent: Clock,
  release: Rocket,
  blocked: OctagonAlert,
  merge: GitMerge,
  budget: Coins,
};

// Buzz DM has no URL, so it isn't added from the form but with "Set up".
const typeItems = Object.entries(CHANNEL)
  .filter(([value]) => value !== "buzz")
  .map(([value, c]) => ({
    value,
    label: c.name,
  }));

/** POSTs one change; returns an error line, or null once it saved. */
export async function post(body: object): Promise<string | null> {
  try {
    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    if (res.status === 403) return "Sign in as the owner first.";
    const { error } = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    return error ?? "Couldn’t save that. Try again.";
  } catch {
    return "Couldn’t save that. Try again.";
  }
}

export function AlertSettings({
  channels,
  rules,
  quiet,
  canEdit,
  dm,
}: {
  channels: ChannelView[];
  rules: Record<RuleId, Rule>;
  quiet: boolean;
  canEdit: boolean;
  /** Why Buzz DM can't be set up yet, or null when it can. */
  dm: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);

  const run = async (body: object, after?: () => void) => {
    setBusy(true);
    setError(null);
    const err = await post(body);
    setBusy(false);
    if (err) {
      setError(err);
      return false;
    }
    after?.();
    router.refresh();
    return true;
  };

  const names = new Map(channels.map((c) => [c.id, CHANNEL[c.type].name]));

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Card className="gap-0 py-0">
        <ChannelsHeader
          canEdit={canEdit && !busy}
          onAdd={(type, target) => run({ op: "add", type, target })}
        />
        <ul className="divide-y border-t">
          {channels.map((c) => {
            const meta = CHANNEL[c.type];
            return (
              <li
                key={c.id}
                className="flex items-center gap-3 px-4 py-3 sm:px-6"
              >
                <IconTile icon={meta.icon} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {meta.name}
                    {meta.badge && <Chip>{meta.badge}</Chip>}
                    {meta.note && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {meta.note}
                      </span>
                    )}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {c.target}
                    {tested === c.id && (
                      <span className="ml-2 font-sans text-success">
                        Test sent
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Send test"
                  disabled={!canEdit || busy}
                  onClick={() =>
                    run({ op: "test", id: c.id }, () => setTested(c.id))
                  }
                >
                  {/* Phones get the icon only. */}
                  <Send className="md:hidden" aria-hidden />
                  <span className="max-md:hidden">Send test</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${meta.name}`}
                  disabled={!canEdit || busy}
                  onClick={() => run({ op: "remove", id: c.id })}
                >
                  <Trash2 aria-hidden />
                </Button>
                <Switch
                  checked={c.on}
                  disabled={!canEdit || busy}
                  aria-label={`Send alerts to ${meta.name}`}
                  onCheckedChange={(on) => run({ op: "toggle", id: c.id, on })}
                />
              </li>
            );
          })}
          {channels.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground sm:px-6">
              No channels yet, so nothing goes out. Alerts still show in Needs
              you.
            </li>
          )}
          {!channels.some((c) => c.type === "buzz") && (
            <ComingRow
              icon={MessageSquare}
              name="Buzz DM"
              badges={
                <>
                  <Chip>Opt-in</Chip>
                  {dm !== null && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-warning/20 bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
                      <KeyRound className="size-3" aria-hidden />
                      Needs a posting key
                    </span>
                  )}
                </>
              }
              detail={
                dm ??
                "The dashboard never posts as the hive. Alerts arrive as a DM from the dashboard's own key, sent only to you."
              }
              dim={dm !== null}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={dm !== null || !canEdit || busy}
                  onClick={() => run({ op: "add", type: "buzz" })}
                >
                  Set up
                </Button>
              }
            />
          )}
        </ul>
      </Card>

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <h3 className="flex items-center gap-2 font-medium">
            <Bell className="size-4 text-muted-foreground" aria-hidden />
            What to alert on
          </h3>
          <span className="text-xs text-muted-foreground">
            Every alert also shows in Needs you
          </span>
        </div>
        <div className="overflow-x-auto border-t">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground max-md:hidden">
              <tr className="border-b">
                <th className="px-4 py-2 font-medium sm:px-6">Alert</th>
                <th className="px-2 py-2 font-medium">When</th>
                <th className="px-2 py-2 font-medium">Send to</th>
                <th className="px-2 py-2 font-medium">Repeat</th>
                <th className="px-4 py-2 text-right font-medium sm:px-6">On</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {RULE_IDS.map((id) => (
                <RuleRow
                  key={id}
                  id={id}
                  rule={rules[id]}
                  channels={channels}
                  names={names}
                  canEdit={canEdit && !busy}
                  save={(value) => run({ op: "rule", rule: id, value })}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:px-6">
          <Moon className="size-4 shrink-0" aria-hidden />
          <label htmlFor="alert-quiet" className="flex-1">
            Quiet hours 10 PM to 8 AM · only failing agents get through
          </label>
          <Switch
            id="alert-quiet"
            checked={quiet}
            disabled={!canEdit || busy}
            onCheckedChange={(on) => run({ op: "quiet", on })}
          />
        </div>
      </Card>
    </div>
  );
}

function ChannelsHeader({
  canEdit,
  onAdd,
}: {
  canEdit: boolean;
  onAdd: (type: ChannelType, target: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ChannelType>("ntfy");
  const [target, setTarget] = useState("");
  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <h3 className="flex items-center gap-2 font-medium">
          <Send className="size-4 text-muted-foreground" aria-hidden />
          Where alerts go
        </h3>
        <Button
          variant="outline"
          disabled={!canEdit}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Plus aria-hidden />
          Add channel
        </Button>
      </div>
      {open && (
        <form
          className="flex flex-wrap items-center gap-2 border-t bg-info/5 px-4 py-3 sm:px-6"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onAdd(type, target)) {
              setTarget("");
              setOpen(false);
            }
          }}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        >
          <Select
            items={typeItems}
            value={type}
            onValueChange={(v) => v && setType(v as ChannelType)}
          >
            <SelectTrigger className="h-9! min-w-52" aria-label="Channel type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {typeItems.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="url"
            required
            aria-label="URL"
            placeholder={CHANNEL[type].hint}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-9 min-w-0 flex-1 font-mono"
          />
          <Button type="submit" disabled={!canEdit || !target}>
            Add
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            The URL is stored encrypted and only ever shown shortened.
          </p>
        </form>
      )}
    </>
  );
}

function RuleRow({
  id,
  rule,
  channels,
  names,
  canEdit,
  save,
}: {
  id: RuleId;
  rule: Rule;
  channels: ChannelView[];
  names: Map<string, string>;
  canEdit: boolean;
  save: (value: Rule) => Promise<boolean>;
}) {
  const meta = RULES[id];
  const Icon = RULE_ICON[id];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(rule.value));
  const [picked, setPicked] = useState(rule.channels);
  const cancel = () => {
    setEditing(false);
    setValue(String(rule.value));
    setPicked(rule.channels);
  };
  const sendTo = rule.channels.filter((c) => names.has(c));
  return (
    <>
      <tr className="max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-1 max-md:py-2">
        <td className="px-4 py-2.5 sm:px-6">
          <button
            type="button"
            disabled={!canEdit}
            aria-expanded={editing}
            onClick={() => (editing ? cancel() : setEditing(true))}
            className="flex items-center gap-2 text-left font-medium enabled:hover:underline disabled:cursor-default"
          >
            <Icon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            {meta.name}
            {id === "budget" && <Chip>new</Chip>}
          </button>
          {!meta.watched && (
            <p className="mt-0.5 pl-6 text-xs text-muted-foreground">
              Not watched yet: Needs you doesn’t read this one
            </p>
          )}
        </td>
        <td className="px-2 py-2.5 text-muted-foreground max-md:col-span-2 max-md:row-start-2 max-md:px-4">
          {meta.when(rule.value)}
        </td>
        <td className="px-2 py-2.5 max-md:hidden">
          <span className="flex flex-wrap gap-1">
            {sendTo.length ? (
              sendTo.map((c) => (
                <Chip key={c} muted={!rule.on}>
                  {names.get(c)}
                </Chip>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">nowhere</span>
            )}
          </span>
        </td>
        <td className="px-2 py-2.5 text-muted-foreground max-md:hidden">
          {meta.repeat}
        </td>
        <td className="px-4 py-2.5 text-right max-md:col-start-2 max-md:row-start-1 sm:px-6">
          <Switch
            checked={rule.on}
            disabled={!canEdit}
            aria-label={`Alert on ${meta.name}`}
            onCheckedChange={(on) => save({ ...rule, on })}
          />
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={5} className="bg-info/5 px-4 py-3 sm:px-6">
            <form
              className="space-y-3"
              onKeyDown={(e) => e.key === "Escape" && cancel()}
              onSubmit={async (e) => {
                e.preventDefault();
                const n = Number(value);
                if (
                  await save({
                    ...rule,
                    value: meta.knob && n > 0 ? n : rule.value,
                    channels: picked,
                  })
                ) {
                  setEditing(false);
                }
              }}
            >
              {meta.knob && (
                <label
                  htmlFor={`rule-${id}-value`}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  {meta.knob === "usd"
                    ? "When any agent goes over $"
                    : "Alert after"}
                  <Input
                    id={`rule-${id}-value`}
                    type="number"
                    min={meta.knob === "usd" ? 1 : 0.25}
                    step={meta.knob === "usd" ? 1 : 0.25}
                    required
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="h-9 w-24"
                  />
                  {meta.knob === "usd" ? "per day" : "hours"}
                </label>
              )}
              {meta.knob === "usd" && (
                <p className="text-xs text-muted-foreground">
                  Estimated, at API list price.
                </p>
              )}
              <fieldset className="flex flex-wrap items-center gap-2 text-sm">
                <legend className="sr-only">Send to</legend>
                <span className="text-muted-foreground">Send to</span>
                {channels.map((c) => {
                  const on = picked.includes(c.id);
                  return (
                    <Button
                      key={c.id}
                      type="button"
                      size="sm"
                      variant={on ? "secondary" : "outline"}
                      aria-pressed={on}
                      onClick={() =>
                        setPicked(
                          on
                            ? picked.filter((p) => p !== c.id)
                            : [...picked, c.id],
                        )
                      }
                    >
                      {CHANNEL[c.type].name}
                    </Button>
                  );
                })}
                {channels.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    Add a channel first
                  </span>
                )}
              </fieldset>
              <div className="flex gap-2">
                <Button type="submit" disabled={!canEdit}>
                  Save
                </Button>
                <Button type="button" variant="outline" onClick={cancel}>
                  Cancel
                </Button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function ComingRow({
  icon,
  name,
  badges,
  detail,
  action,
  dim,
}: {
  icon: LucideIcon;
  name: string;
  badges?: ReactNode;
  detail: string;
  action?: ReactNode;
  dim?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-3 sm:px-6",
        dim && "opacity-60",
      )}
    >
      <IconTile icon={icon} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {name}
          {badges}
        </p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      {action}
    </li>
  );
}

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

function Chip({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md border px-1.5 text-xs font-medium",
        muted ? "text-muted-foreground" : "bg-muted",
      )}
    >
      {children}
    </span>
  );
}
