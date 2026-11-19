import { cn } from "cn";
import type { Metadata } from "next";
import Link from "next/link";
import { SettingsForm } from "@/components/settings-form";
import { loadHive } from "@/lib/hive";
import { loadStatusFeed } from "@/lib/status-feed";
import pkg from "../../../../package.json";
import { AlertsTab } from "./alerts";
import { SourcesTab } from "./sources";

export const metadata: Metadata = { title: "Settings · Hive" };

// DESIGN.md → Settings tabs. Links, not client tabs, like Pipeline's Now /
// Flow, so Alerts and Sources are server renders with their own URLs.
type Tab = "general" | "alerts" | "sources";

function SettingsTabs({ tab }: { tab: Tab }) {
  const tabs = [
    { label: "General", href: "/settings", active: tab === "general" },
    { label: "Alerts", href: "/settings?tab=alerts", active: tab === "alerts" },
    {
      label: "Sources",
      href: "/settings?tab=sources",
      active: tab === "sources",
    },
  ];
  return (
    <nav
      aria-label="Settings"
      className="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
    >
      {tabs.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "inline-flex h-full items-center rounded-md px-3 text-sm font-medium text-foreground/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            t.active &&
              "bg-background text-foreground shadow-sm dark:border dark:border-input dark:bg-input/30",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export default async function SettingsPage({
  searchParams,
}: PageProps<"/settings">) {
  const params = await searchParams;
  const tab: Tab =
    params.tab === "sources" || params.tab === "alerts"
      ? params.tab
      : "general";
  const [{ hive }, { feed }] = await Promise.all([
    tab === "alerts" ? { hive: null } : loadHive(),
    tab === "general" ? loadStatusFeed() : { feed: null },
  ]);
  // Same roster as the Agents view, no messages.
  const agents = (hive?.agents ?? []).map((a) => ({ ...a, messages: [] }));
  return (
    <div
      className={cn("space-y-6", tab === "general" ? "max-w-2xl" : "max-w-4xl")}
    >
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <SettingsTabs tab={tab} />
      {tab === "sources" ? (
        <SourcesTab agents={agents} showAll={params.agents === "all"} />
      ) : tab === "alerts" ? (
        <AlertsTab />
      ) : (
        <SettingsForm
          agents={agents}
          version={pkg.version}
          publishedAt={feed?.publishedAt ?? null}
        />
      )}
    </div>
  );
}
