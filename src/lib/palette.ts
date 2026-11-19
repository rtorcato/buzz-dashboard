/** One place the palette can take you. It only navigates, never acts. */
export type PaletteItem = {
  group: "Views" | "Agents" | "Needs you";
  label: string;
  /** Muted second line: a role, a repo, a reason. */
  hint?: string;
  href: string;
};

const MAX_RESULTS = 30;

// Every word of the query must appear in the label or hint, in any order.
export function matchItems(items: PaletteItem[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice(0, MAX_RESULTS);
  return items
    .filter((it) => {
      const text = `${it.label} ${it.hint ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .slice(0, MAX_RESULTS);
}
