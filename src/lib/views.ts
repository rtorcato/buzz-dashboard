import {
  Activity,
  Bot,
  Coins,
  GitPullRequest,
  HeartPulse,
  Images,
  LayoutDashboard,
  type LucideIcon,
  Rocket,
} from "lucide-react";
import type { NeedsYouKind, View } from "@/lib/needs-you";

// Overview, Media and Cost never need the owner, so they have no count.
export type Item = View | "overview" | "media" | "cost";

/** The route of a view: Overview is the home at /. */
export const viewHref = (view: Item) =>
  view === "overview" ? "/" : `/${view}`;

/** The view a pathname belongs to: "/" is Overview, "/agents/x" is Agents. */
export const viewOf = (pathname: string): string =>
  pathname.split("/")[1] || "overview";

// DESIGN.md → Obsidian redesign → Shell changes: the Views group order.
// `history: true` marks a view
// that reads the history store (#39), like Health and Cost; it leaves the
// sidebar when DATABASE_URL is unset.
export const VIEWS: {
  view: Item;
  label: string;
  icon: LucideIcon;
  history?: true;
}[] = [
  { view: "overview", label: "Overview", icon: LayoutDashboard },
  { view: "agents", label: "Agents", icon: Bot },
  { view: "pipeline", label: "Pipeline", icon: GitPullRequest },
  { view: "health", label: "Health", icon: HeartPulse, history: true },
  { view: "cost", label: "Cost", icon: Coins, history: true },
  { view: "timeline", label: "Timeline", icon: Activity },
  { view: "releases", label: "Releases", icon: Rocket },
  { view: "media", label: "Media", icon: Images },
];

/** The views shown with or without the history store. */
export const visibleViews = (history: boolean) =>
  VIEWS.filter((v) => history || !v.history);

// Counts are solid --primary pills, or solid --destructive when they are
// failures: an agent failing turns or red CI. A release waiting, a blocked
// issue or a merge-ready PR is waiting on you, not a failure.
const FAILURE_KINDS: ReadonlySet<NeedsYouKind> = new Set(["failing", "ci"]);

/** The views whose count includes at least one failure. */
export function failingViews(
  rows: { kind: NeedsYouKind }[],
  kindView: Record<NeedsYouKind, View>,
): Partial<Record<Item, true>> {
  const out: Partial<Record<Item, true>> = {};
  for (const r of rows)
    if (FAILURE_KINDS.has(r.kind)) out[kindView[r.kind]] = true;
  return out;
}
