"use client";

import { useHasMounted, useTheme } from "@rtorcato/react-common";
import {
  Eye,
  EyeOff,
  Lock,
  Monitor,
  Moon,
  Pin,
  RotateCcw,
  Search,
  Sun,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Avatar } from "@/components/agents-view";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SORTS } from "@/lib/agents";
import { formatClock, formatWhen } from "@/lib/format-time";
import type { Agent } from "@/lib/hive";
import {
  QUIET_AFTER_MINUTES,
  resetSettings,
  type Settings,
  updateSettings,
  useSettings,
  VIEWS,
} from "@/lib/settings";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

type Option<T extends string> = { value: T; label: string; icon?: ReactNode };

// A single-choice ToggleGroup. A second press on the chosen item clears it
// only when `onClear` is given.
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  onClear,
}: {
  label: string;
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
  onClear?: () => void;
}) {
  return (
    <ToggleGroup
      variant="outline"
      aria-label={label}
      value={value ? [value] : []}
      onValueChange={(next) => {
        if (next[0]) onChange(next[0] as T);
        else onClear?.();
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="h-9 px-3 max-md:h-11"
        >
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">{children}</CardContent>
    </Card>
  );
}

// Label and hint on the left, the control on the right; stacked on phones.
function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="font-medium">
          {label}
        </label>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ThemeChoice() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the stored theme once mounted.
  const mounted = useHasMounted();
  return (
    <Choice
      label="Theme"
      value={mounted ? (theme ?? "system") : null}
      onChange={setTheme}
      options={[
        { value: "system", label: "System", icon: <Monitor aria-hidden /> },
        { value: "light", label: "Light", icon: <Sun aria-hidden /> },
        { value: "dark", label: "Dark", icon: <Moon aria-hidden /> },
      ]}
    />
  );
}

function Notifications({ settings }: { settings: Settings }) {
  const id = useId();
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    setBlocked(
      typeof Notification !== "undefined" &&
        Notification.permission === "denied",
    );
  }, []);

  const toggleNotify = async (on: boolean) => {
    if (!on) return updateSettings({ notify: false });
    const unsupported = typeof Notification === "undefined";
    // The browser asks the first time; a denial leaves the switch off.
    const permission = unsupported
      ? "denied"
      : await Notification.requestPermission();
    setBlocked(permission !== "granted");
    updateSettings({ notify: permission === "granted" });
  };

  return (
    <Row
      label="Desktop notification"
      hint="When Needs you goes up. Your browser asks for permission the first time."
      htmlFor={id}
    >
      <div className="flex items-center gap-3">
        {blocked && (
          <span className="text-sm text-muted-foreground">
            Blocked in your browser settings
          </span>
        )}
        <Switch
          id={id}
          checked={settings.notify && !blocked}
          onCheckedChange={toggleNotify}
        />
      </div>
    </Row>
  );
}

function PinnedAndHidden({
  agents,
  settings,
}: {
  agents: Agent[];
  settings: Settings;
}) {
  const [query, setQuery] = useState("");
  const shown = agents.filter((a) =>
    a.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const flip = (key: "pinned" | "hidden", name: string, on: boolean) =>
    updateSettings({
      [key]: on
        ? [...settings[key], name]
        : settings[key].filter((n) => n !== name),
    });
  return (
    <div className="space-y-3 py-4 last:pb-0">
      <div>
        <p className="font-medium">Pinned and hidden</p>
        <p className="text-sm text-muted-foreground">
          Pinned agents sit at the top. Hidden agents leave the Agents view, but
          they still count in Needs you.
        </p>
      </div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter agents"
          aria-label="Filter agents"
          className="pl-8"
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {agents.length === 0 ? "No agents yet." : "No agent matches."}
        </p>
      ) : (
        <ul className="space-y-1">
          {shown.map((a) => {
            const pinned = settings.pinned.includes(a.name);
            const hidden = settings.hidden.includes(a.name);
            return (
              <li
                key={a.name}
                className={`flex min-h-11 items-center gap-3 ${hidden ? "opacity-60" : ""}`}
              >
                <Avatar agent={a} className="size-8 text-xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{a.name}</p>
                  {a.role && (
                    <p className="truncate text-sm text-muted-foreground">
                      {a.role}
                    </p>
                  )}
                </div>
                <Toggle
                  pressed={pinned}
                  onPressedChange={(on) => flip("pinned", a.name, on)}
                  aria-label={`Pin ${a.name}`}
                  className="size-9 aria-pressed:bg-accent max-md:size-11"
                >
                  <Pin aria-hidden />
                </Toggle>
                <Toggle
                  pressed={hidden}
                  onPressedChange={(on) => flip("hidden", a.name, on)}
                  aria-label={`Hide ${a.name}`}
                  className="size-9 aria-pressed:bg-accent max-md:size-11"
                >
                  {hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                </Toggle>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// DESIGN.md → Settings (#58). Every control writes to localStorage at once.
export function SettingsForm({
  agents,
  version,
  publishedAt,
}: {
  agents: Agent[];
  version: string;
  publishedAt: number | null;
}) {
  const s = useSettings();
  const { setTheme } = useTheme();
  const tabCountId = useId();
  const now = Date.now();
  const fmt = {
    clock: s.clock,
    timeZone: s.timeZone,
    timestamps: s.timestamps,
  };

  const quietItems = QUIET_AFTER_MINUTES.map((m) => ({
    value: String(m),
    label: m < 60 ? `${m} minutes` : `${m / 60} ${m === 60 ? "hour" : "hours"}`,
  }));
  const viewItems = VIEWS.map((v) => ({ value: v, label: capitalize(v) }));
  const sortItems = Object.entries(SORTS).map(([value, label]) => ({
    value,
    label: capitalize(label),
  }));

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-muted-foreground">
        Preferences for this browser. Changes apply right away.
      </p>
      <div className="flex items-start gap-3 rounded-lg border p-3 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          Stored in this browser only (localStorage). Nothing is sent anywhere,
          and nothing here changes the hive.
        </p>
      </div>

      <Section
        title="Appearance"
        description="How the dashboard looks on this device."
      >
        <Row label="Theme">
          <ThemeChoice />
        </Row>
        <Row
          label="Density"
          hint="Compact tightens agent cards and table rows."
        >
          <Choice
            label="Density"
            value={s.density}
            onChange={(density) => updateSettings({ density })}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </Row>
        <Row
          label="Motion"
          hint="System follows your OS reduce-motion setting."
        >
          <Choice
            label="Motion"
            value={s.motion}
            onChange={(motion) => updateSettings({ motion })}
            options={[
              { value: "system", label: "System" },
              { value: "reduced", label: "Reduced" },
              { value: "full", label: "Full" },
            ]}
          />
        </Row>
      </Section>

      <Section
        title="Time"
        description="Logs and messages are recorded in UTC."
      >
        <Row label="Timestamps">
          <Choice
            label="Timestamps"
            value={s.timestamps}
            onChange={(timestamps) => updateSettings({ timestamps })}
            options={[
              { value: "relative", label: "Relative" },
              { value: "absolute", label: "Absolute" },
            ]}
          />
        </Row>
        <Row label="Clock" hint="Unset follows your browser locale.">
          <Choice
            label="Clock"
            value={s.clock === "auto" ? null : s.clock}
            onChange={(clock) => updateSettings({ clock })}
            onClear={() => updateSettings({ clock: "auto" })}
            options={[
              { value: "12h", label: "12h" },
              { value: "24h", label: "24h" },
            ]}
          />
        </Row>
        <Row label="Time zone">
          <div className="space-y-2">
            <Choice
              label="Time zone"
              value={s.timeZone}
              onChange={(timeZone) => updateSettings({ timeZone })}
              options={[
                { value: "local", label: "Local" },
                { value: "utc", label: "UTC" },
              ]}
            />
            <p
              className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              Preview:{" "}
              {formatWhen(now - 2 * 3600_000, now, {
                ...fmt,
                timestamps: "relative",
              })}
              {" · "}
              {formatClock(new Date(now), fmt, true)}
            </p>
          </div>
        </Row>
      </Section>

      <Section
        title="Data and refresh"
        description="The page re-reads the hive on this schedule."
      >
        <Row label="Auto-refresh" hint="Off still lets you refresh by hand.">
          <Choice
            label="Auto-refresh"
            value={s.refresh}
            onChange={(refresh) => updateSettings({ refresh })}
            options={[
              { value: "off", label: "Off" },
              { value: "30s", label: "30s" },
              { value: "1m", label: "1m" },
              { value: "5m", label: "5m" },
            ]}
          />
        </Row>
        <Row
          label="Quiet after"
          hint="An agent with no messages for this long shows as Quiet."
        >
          <Select
            items={quietItems}
            value={String(s.quietAfterMinutes)}
            onValueChange={(v) =>
              v && updateSettings({ quietAfterMinutes: Number(v) })
            }
          >
            <SelectTrigger className="h-9! min-w-40" aria-label="Quiet after">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {quietItems.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Section>

      <Section
        title="Agents"
        description="The Agents view and the default landing page."
      >
        <Row label="Open on" hint="The view you land on at /.">
          <Select
            items={viewItems}
            value={s.openOn}
            onValueChange={(v) =>
              v && updateSettings({ openOn: v as Settings["openOn"] })
            }
          >
            <SelectTrigger className="h-9! min-w-40" aria-label="Open on">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {viewItems.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Default filter">
          <Choice
            label="Default filter"
            value={s.agentFilter}
            onChange={(agentFilter) => updateSettings({ agentFilter })}
            options={(["all", "active", "quiet", "stopped"] as const).map(
              (value) => ({ value, label: capitalize(value) }),
            )}
          />
        </Row>
        <Row label="Default sort">
          <Select
            items={sortItems}
            value={s.agentSort}
            onValueChange={(v) =>
              v && updateSettings({ agentSort: v as Settings["agentSort"] })
            }
          >
            <SelectTrigger className="h-9! min-w-44" aria-label="Default sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortItems.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <PinnedAndHidden agents={agents} settings={s} />
      </Section>

      <Section
        title="Notifications"
        description="Uses your browser only. No push service."
      >
        <Notifications settings={s} />
        <Row label="Count in tab title" htmlFor={tabCountId}>
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              (3) Hive
            </span>
            <Switch
              id={tabCountId}
              checked={s.tabCount}
              onCheckedChange={(tabCount) => updateSettings({ tabCount })}
            />
          </div>
        </Row>
      </Section>

      <Section title="About" description="This dashboard.">
        <Row label="Version">
          <span className="font-mono text-sm">{version}</span>
        </Row>
        <Row label="Last publish">
          <span className="text-sm" suppressHydrationWarning>
            {publishedAt
              ? formatWhen(publishedAt * 1000, now, fmt)
              : "Not reported"}
          </span>
        </Row>
        <Row
          label="Reset all settings"
          hint="Clears every preference on this page in this browser."
        >
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  className="text-destructive max-md:h-11"
                />
              }
            >
              <RotateCcw aria-hidden />
              Reset…
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
                <AlertDialogDescription>
                  Every preference on this page goes back to its default in this
                  browser. Nothing else changes.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    resetSettings();
                    setTheme("system");
                  }}
                >
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Row>
      </Section>
    </div>
  );
}
