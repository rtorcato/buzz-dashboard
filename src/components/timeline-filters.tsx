"use client";

import {
  Calendar,
  Folder,
  Layers2,
  type LucideIcon,
  Search,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DEFAULT_RANGE, type Filters, RANGES, TYPES } from "@/lib/timeline";

export const ALL = "__all__";

type Item = { value: string; label: string; mono?: boolean };

export function FilterSelect({
  label,
  icon: Icon,
  items,
  value,
  onChange,
}: {
  label: string;
  icon?: LucideIcon;
  items: Item[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(v) => onChange(v ?? ALL)}
    >
      <SelectTrigger className="h-9! shrink-0 max-md:h-11!" aria-label={label}>
        {Icon && <Icon className="text-muted-foreground" aria-hidden />}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem
            key={i.value}
            value={i.value}
            className={i.mono ? "font-mono text-[13px]" : undefined}
          >
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// DESIGN.md → Timeline → Search card. Every control writes the URL, so a
// search is a link and the server does the querying. `live` (no database,
// #53) keeps only the agent and type filters.
export function TimelineFilters({
  filters,
  repos,
  agents,
  live = false,
}: {
  filters: Filters;
  repos: string[];
  agents: string[];
  live?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setQ(filters.q), [filters.q]);

  // "/" focuses the search from anywhere on the page, unless you're typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        e.key !== "/" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        t?.closest("input, textarea, select, [contenteditable=true]") ||
        !input.current
      )
        return;
      e.preventDefault();
      input.current.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value && value !== ALL) next.set(key, value);
    else next.delete(key);
    // A new filter starts from the newest page again.
    next.delete("n");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="space-y-3">
      {!live && (
        <search>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              set("q", q.trim() || null);
            }}
            className="relative"
          >
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={input}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search messages, issues, PRs and labels"
              aria-label="Search the timeline"
              className="h-11 pr-20 pl-9 [&::-webkit-search-cancel-button]:hidden"
            />
            <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
              {q && (
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    set("q", null);
                  }}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
              <kbd
                className="hidden h-5 min-w-5 items-center justify-center rounded border px-1 font-mono text-xs text-muted-foreground md:flex"
                aria-hidden
              >
                /
              </kbd>
            </div>
          </form>
        </search>
      )}

      {/* On phones the row scrolls sideways in one line. */}
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
        {!live && (
          <FilterSelect
            label="Repo"
            icon={Folder}
            items={[
              { value: ALL, label: "All repos" },
              ...repos.map((r) => ({ value: r, label: r, mono: true })),
            ]}
            value={filters.repo ?? ALL}
            onChange={(v) => set("repo", v)}
          />
        )}
        <FilterSelect
          label="Agent"
          items={[
            { value: ALL, label: "All agents" },
            ...agents.map((a) => ({ value: a, label: a })),
          ]}
          value={filters.agent ?? ALL}
          onChange={(v) => set("agent", v)}
        />
        {!live && (
          <FilterSelect
            label="Source"
            icon={Layers2}
            items={[
              { value: ALL, label: "All sources" },
              { value: "github", label: "GitHub" },
              { value: "buzz", label: "Buzz" },
              { value: "ingest", label: "Agent events" },
            ]}
            value={filters.source ?? ALL}
            onChange={(v) => set("source", v)}
          />
        )}
        <ToggleGroup
          variant="outline"
          aria-label="Event type"
          className="shrink-0"
          spacing={0}
          value={[filters.type ?? ALL]}
          onValueChange={(next) => set("type", next[0] ?? null)}
        >
          {[
            { value: ALL, label: "All" },
            ...Object.entries(TYPES).map(([value, t]) => ({
              value,
              label: t.label,
            })),
          ].map((o) => (
            <ToggleGroupItem
              key={o.value}
              value={o.value}
              className="h-9 px-3 max-md:h-11"
            >
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {!live && (
          <FilterSelect
            label="Range"
            icon={Calendar}
            items={Object.entries(RANGES).map(([value, r]) => ({
              value,
              label: r.label,
            }))}
            value={filters.range}
            onChange={(v) => set("range", v === DEFAULT_RANGE ? null : v)}
          />
        )}
      </div>
    </div>
  );
}
