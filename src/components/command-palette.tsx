"use client";

import { cn } from "cn";
import {
  Bot,
  GitPullRequest,
  type LucideIcon,
  PanelsTopLeft,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Fragment,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { matchItems, type PaletteItem } from "@/lib/palette";

const GROUP_ICON: Record<PaletteItem["group"], LucideIcon> = {
  Views: PanelsTopLeft,
  Agents: Bot,
  "Needs you": GitPullRequest,
};

// DESIGN.md → Obsidian redesign → Shell changes: the header search field and
// ⌘K open a palette over what the dashboard already loads.
export function CommandPalette({ items }: { items: PaletteItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => matchItems(items, query), [items, query]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A new query starts at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on query change
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (item: PaletteItem | undefined) => {
    if (!item) return;
    setOpen(false);
    setQuery("");
    router.push(item.href);
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter that confirms an IME composition must not pick a result.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <>
      {/* Desktop: a field-shaped button. Phones: a search icon button. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 w-full max-w-sm items-center gap-2 rounded-[10px] border bg-chip px-3 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:flex"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">
          Search agents, PRs, views…
        </span>
        <kbd className="rounded border px-1.5 font-mono text-[11px] text-muted-foreground">
          ⌘K
        </kbd>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 md:hidden"
        aria-label="Search"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Type to find a view, an agent or an item that needs you, then press
            Enter to go there.
          </DialogDescription>
          <div className="flex items-center gap-2 border-b px-3">
            <Search
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={
                results[active] ? optionId(active) : undefined
              }
              aria-autocomplete="list"
              aria-label="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search agents, PRs, views…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          )}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Results"
            className="max-h-80 overflow-y-auto p-1.5 empty:hidden"
          >
            {results.map((item, i) => {
              const Icon = GROUP_ICON[item.group];
              const first = i === 0 || results[i - 1].group !== item.group;
              return (
                <Fragment key={`${item.group}:${item.href}:${item.label}`}>
                  {first && (
                    <div
                      className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                      aria-hidden
                    >
                      {item.group}
                    </div>
                  )}
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: the input owns the keyboard (aria-activedescendant) */}
                  <div
                    id={optionId(i)}
                    data-index={i}
                    role="option"
                    // Reachable by aria-activedescendant, not by Tab.
                    tabIndex={-1}
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(item)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm",
                      i === active && "bg-chip text-foreground",
                    )}
                  >
                    <Icon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="truncate">{item.label}</span>
                    {item.hint && (
                      <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">
                        {item.hint}
                      </span>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
