"use client";

import { copyToClipboard } from "@rtorcato/browser-common/clipboard";
import { cn } from "cn";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  Folder,
  ImageOff,
  Link as LinkIcon,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type Tile = {
  key: string;
  name: string;
  repo: string;
  dateLabel: string;
  time: string;
  size: string;
  /** Public URL of the original. */
  url: string;
  /** Thumbnail URL, or null for files that are not images. */
  thumb: string | null;
};

export type GallerySection = {
  repo: string;
  count: number;
  dates: { date: string; label: string; total: number; files: Tile[] }[];
};

const ALL = "__all__";

export function RepoSelect({
  repos,
  value,
}: {
  repos: string[];
  value: string | null;
}) {
  const router = useRouter();
  const items = [
    { value: ALL, label: "All repos" },
    ...repos.map((r) => ({ value: r, label: r })),
  ];
  return (
    <Select
      items={items}
      value={value ?? ALL}
      onValueChange={(v) =>
        router.push(
          !v || v === ALL ? "/media" : `/media?repo=${encodeURIComponent(v)}`,
        )
      }
    >
      <SelectTrigger className="h-9! min-w-32" aria-label="Repo">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem
            key={i.value}
            value={i.value}
            className={i.value === ALL ? undefined : "font-mono text-[13px]"}
          >
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Clipboard write with a 2s "Copied" state (DESIGN.md → Media tab → Copy).
function useCopy(): [string | null, (label: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = (label: string, text: string) =>
    copyToClipboard(text).then((ok) => setCopied(ok ? label : null));
  return [copied, copy];
}

function NoPreview() {
  return (
    <span className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <ImageOff className="size-8" aria-hidden />
      <span className="text-xs">No preview</span>
    </span>
  );
}

const thumbArea =
  "block aspect-[4/3] w-full overflow-hidden bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function MediaTile({ tile, onOpen }: { tile: Tile; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const [copied, copy] = useCopy();
  const ext = tile.name.includes(".") ? tile.name.split(".").pop() : "";

  return (
    <li className="group overflow-hidden rounded-xl border bg-card shadow-sm">
      {tile.thumb ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${tile.name}`}
          className={thumbArea}
        >
          {broken ? (
            <NoPreview />
          ) : (
            // biome-ignore lint/performance/noImgElement: Cloudflare already resizes; next/image would proxy it again.
            <img
              src={tile.thumb}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setBroken(true)}
              className="size-full object-cover object-top transition-transform group-hover:scale-[1.02]"
            />
          )}
        </button>
      ) : (
        // Never render non-images: an .html file would run on the media host.
        <a
          href={tile.url}
          download={tile.name}
          aria-label={`Download ${tile.name}`}
          className={thumbArea}
        >
          <span className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileCode className="size-8" aria-hidden />
            {ext ? <span className="font-mono text-xs">.{ext}</span> : null}
          </span>
        </a>
      )}
      <div className="flex items-center gap-1 border-t py-1.5 pr-1 pl-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[13px]" title={tile.key}>
            {tile.name}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {tile.time} · {tile.size}
          </p>
        </div>
        {!tile.thumb ? (
          <a
            href={tile.url}
            download={tile.name}
            aria-label={`Download ${tile.name}`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "size-9 text-muted-foreground",
            )}
          >
            <Download aria-hidden />
          </a>
        ) : copied ? (
          <span className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-success">
            <Check className="size-3.5" aria-hidden />
            <span className="sr-only sm:not-sr-only">Copied</span>
          </span>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground"
            aria-label={`Copy link to ${tile.name}`}
            onClick={() => copy("link", tile.url)}
          >
            <LinkIcon aria-hidden />
          </Button>
        )}
        <output className="sr-only">
          {copied ? `Copied link to ${tile.name}` : ""}
        </output>
      </div>
    </li>
  );
}

type FitMode = "fit" | "width" | "actual";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
// Images this much taller than wide are long screenshots: open them readable.
const TALL = 2.5;

const clampZoom = (s: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The next 10% stop above (1) or below (-1) the current scale. */
function stepZoom(scale: number, dir: 1 | -1) {
  const pct = Math.round(scale * 1000) / 10;
  const next =
    dir > 0
      ? Math.floor(pct / 10 + 1e-6) * 10 + 10
      : Math.ceil(pct / 10 - 1e-6) * 10 - 10;
  return clampZoom(next / 100);
}

type Stage = { w: number; h: number; pad: number };
type Natural = { url: string; w: number; h: number };

function scaleFor(mode: FitMode, img: Natural, stage: Stage) {
  if (mode === "actual" || !stage.w) return 1;
  const byWidth = (stage.w - stage.pad) / img.w;
  if (mode === "width") return Math.min(2, byWidth);
  return Math.min(1, byWidth, (stage.h - stage.pad) / img.h);
}

/** Tall images open at 100%, or at full width when that is smaller. */
function defaultMode(img: Natural, stage: Stage): FitMode {
  if (img.h / img.w <= TALL) return "fit";
  return scaleFor("width", img, stage) >= 1 ? "actual" : "width";
}

function measure(vp: HTMLElement): Stage {
  const canvas = vp.firstElementChild;
  const pad = canvas
    ? Number.parseFloat(getComputedStyle(canvas).paddingLeft)
    : 0;
  return { w: vp.clientWidth, h: vp.clientHeight, pad: pad * 2 };
}

/**
 * Where to keep still while zooming: the image point (as a 0–1 fraction) under
 * a viewport point (the cursor, or the centre).
 */
type Anchor = { fx: number; fy: number; ax: number; ay: number } | "top";

function anchorAt(
  vp: HTMLElement,
  img: HTMLElement,
  x?: number,
  y?: number,
): Anchor {
  const v = vp.getBoundingClientRect();
  const r = img.getBoundingClientRect();
  const px = x ?? v.left + vp.clientWidth / 2;
  const py = y ?? v.top + vp.clientHeight / 2;
  return {
    fx: clamp01((px - r.left) / r.width),
    fy: clamp01((py - r.top) / r.height),
    ax: px - v.left,
    ay: py - v.top,
  };
}

type Scroll = {
  l: number;
  t: number;
  w: number;
  h: number;
  sw: number;
  sh: number;
};

const kbd =
  "rounded border border-b-2 px-1 font-mono text-[11px] text-foreground";

function Viewer({
  list,
  index,
  onIndex,
  onClose,
}: {
  list: Tile[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const tile = list[index];
  const [natural, setNatural] = useState<Natural>();
  const [view, setView] = useState<{ mode: FitMode | null; scale: number }>({
    mode: "fit",
    scale: 1,
  });
  const [stage, setStage] = useState<Stage>({ w: 0, h: 0, pad: 0 });
  const [scroll, setScroll] = useState<Scroll>();
  const [vp, setVp] = useState<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, copy] = useCopy();
  const imgRef = useRef<HTMLImageElement>(null);
  const anchor = useRef<Anchor | null>(null);
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(
    null,
  );
  const touchX = useRef<number | null>(null);
  const step = (d: number) => onIndex((index + d + list.length) % list.length);

  const img = natural?.url === tile.url ? natural : undefined;
  const scale = img
    ? view.mode
      ? scaleFor(view.mode, img, stage)
      : view.scale
    : 1;
  const overflow =
    !!img &&
    (img.w * scale + stage.pad > stage.w + 1 ||
      img.h * scale + stage.pad > stage.h + 1);
  const size = img ? `${img.w} × ${img.h} · ` : "";

  // Latest values for the native wheel listener.
  const live = useRef({ scale, img });
  useLayoutEffect(() => {
    live.current = { scale, img };
  });

  const setMode = (mode: FitMode) => {
    // A long screenshot shown whole reads from its top, as on first open.
    const whole = img && img.h * scale + stage.pad <= stage.h + 1;
    if (img && whole && img.h / img.w > TALL) anchor.current = "top";
    else if (vp && imgRef.current)
      anchor.current = anchorAt(vp, imgRef.current);
    setView({ mode, scale });
  };
  const zoomTo = (next: number, x?: number, y?: number) => {
    if (vp && imgRef.current)
      anchor.current = anchorAt(vp, imgRef.current, x, y);
    setView({ mode: null, scale: clampZoom(next) });
  };

  const syncScroll = () => {
    if (!vp) return;
    const next = {
      l: vp.scrollLeft,
      t: vp.scrollTop,
      w: vp.clientWidth,
      h: vp.clientHeight,
      sw: vp.scrollWidth,
      sh: vp.scrollHeight,
    };
    setScroll((prev) =>
      prev &&
      (Object.keys(next) as (keyof Scroll)[]).every((k) => prev[k] === next[k])
        ? prev
        : next,
    );
  };

  // After a zoom renders, scroll so the anchored image point stays put.
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = imgRef.current;
    anchor.current = null;
    if (vp && el && a) {
      if (a === "top") {
        vp.scrollTop = 0;
        vp.scrollLeft = (vp.scrollWidth - vp.clientWidth) / 2;
      } else {
        vp.scrollLeft = el.offsetLeft + a.fx * el.offsetWidth - a.ax;
        vp.scrollTop = el.offsetTop + a.fy * el.offsetHeight - a.ay;
      }
    }
    syncScroll();
  });

  useEffect(() => {
    if (!vp) return;
    const ro = new ResizeObserver(() => setStage(measure(vp)));
    ro.observe(vp);
    // Ctrl/⌘ + wheel and trackpad pinch zoom at the cursor. Needs a
    // non-passive listener to stop the browser zooming the page.
    const onWheel = (e: WheelEvent) => {
      const { scale: s, img: loaded } = live.current;
      if (!(e.ctrlKey || e.metaKey) || !loaded || !imgRef.current) return;
      e.preventDefault();
      anchor.current = anchorAt(vp, imgRef.current, e.clientX, e.clientY);
      setView({
        mode: null,
        scale: clampZoom(s * Math.exp(-e.deltaY * 0.01)),
      });
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      vp.removeEventListener("wheel", onWheel);
    };
  }, [vp]);

  const mini = (() => {
    if (!img || !overflow || !scroll) return null;
    const w = Math.max(28, Math.min(64, (160 * img.w) / img.h));
    const h = Math.min(160, (w * img.h) / img.w);
    return {
      w,
      h,
      box: {
        left: `${(scroll.l / scroll.sw) * 100}%`,
        top: `${(scroll.t / scroll.sh) * 100}%`,
        width: `${Math.min(1, scroll.w / scroll.sw) * 100}%`,
        height: `${Math.min(1, scroll.h / scroll.sh) * 100}%`,
      },
    };
  })();

  const zoomBtn = "size-8 max-sm:size-10";
  const segItem = "h-8 px-2.5 text-[13px] max-sm:h-10";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") step(-1);
          if (e.key === "ArrowRight") step(1);
          if (
            !img ||
            e.ctrlKey ||
            e.metaKey ||
            e.altKey ||
            e.target instanceof HTMLInputElement
          )
            return;
          const k = e.key;
          if (k === "0") setMode("fit");
          else if (k === "w" || k === "W") setMode("width");
          else if (k === "1") setMode("actual");
          else if (k === "+" || k === "=") zoomTo(stepZoom(scale, 1));
          else if (k === "-" || k === "_") zoomTo(stepZoom(scale, -1));
          else return;
          e.preventDefault();
        }}
        className="inset-0 top-0 left-0 flex h-auto w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 sm:inset-6 sm:mx-auto sm:max-w-6xl sm:rounded-xl sm:border"
      >
        <div className="flex items-center gap-3 border-b py-2 pr-2 pl-4 sm:pl-6">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate font-mono text-sm font-semibold">
              {tile.name}
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              <span className="font-mono">{tile.repo}</span> · {tile.dateLabel},{" "}
              {tile.time} · {size}
              {tile.size}
            </DialogDescription>
          </div>
          <span className="hidden text-sm text-muted-foreground tabular-nums sm:inline">
            {index + 1} of {list.length}
          </span>
          <DialogClose
            render={<Button variant="ghost" size="icon" className="size-10" />}
          >
            <X className="size-5" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>

        <div
          role="toolbar"
          aria-label="Zoom"
          className="flex items-center gap-1 border-b bg-card py-1.5 pr-3 pl-2 sm:pl-6"
        >
          <ToggleGroup
            variant="outline"
            spacing={0}
            aria-label="Fit mode"
            disabled={!img}
            value={img && view.mode ? [view.mode] : []}
            onValueChange={(v) => {
              const mode = (v[0] as FitMode | undefined) ?? view.mode;
              if (mode) setMode(mode);
            }}
          >
            <ToggleGroupItem
              value="fit"
              title="Fit whole image (0)"
              className={segItem}
            >
              Fit
            </ToggleGroupItem>
            <ToggleGroupItem
              value="width"
              title="Fit width (W)"
              className={segItem}
            >
              Fit width
            </ToggleGroupItem>
            <ToggleGroupItem
              value="actual"
              title="Actual size (1)"
              className={segItem}
            >
              100%
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="mx-1 h-5 w-px bg-border sm:mx-2" aria-hidden />
          <Button
            variant="ghost"
            size="icon"
            className={zoomBtn}
            aria-label="Zoom out"
            title="Zoom out (−)"
            disabled={!img || scale <= MIN_ZOOM}
            onClick={() => zoomTo(stepZoom(scale, -1))}
          >
            <ZoomOut aria-hidden />
          </Button>
          <output
            aria-live="polite"
            className="w-12 text-center text-[13px] tabular-nums"
          >
            {img ? `${Math.round(scale * 100)}%` : "–"}
          </output>
          <Button
            variant="ghost"
            size="icon"
            className={zoomBtn}
            aria-label="Zoom in"
            title="Zoom in (+)"
            disabled={!img || scale >= MAX_ZOOM}
            onClick={() => zoomTo(stepZoom(scale, 1))}
          >
            <ZoomIn aria-hidden />
          </Button>
          <span className="ml-auto hidden text-xs text-muted-foreground lg:inline">
            <kbd className={kbd}>0</kbd> fit · <kbd className={kbd}>W</kbd>{" "}
            width · <kbd className={kbd}>1</kbd> 100% ·{" "}
            <kbd className={kbd}>+</kbd>
            <kbd className={kbd}>−</kbd> zoom · double-click to toggle · drag to
            pan
          </span>
        </div>

        <div
          className="relative min-h-0 flex-1 bg-muted/60"
          onTouchStart={(e) => {
            touchX.current = overflow ? null : e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (touchX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
          }}
        >
          {/* Scroll container: drag pans, double-click toggles 100%. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse pan and double-click zoom; the toolbar and shortcuts cover the keyboard. */}
          <div
            ref={setVp}
            onScroll={syncScroll}
            onPointerDown={(e) => {
              if (!overflow || e.button !== 0 || e.pointerType !== "mouse")
                return;
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                l: e.currentTarget.scrollLeft,
                t: e.currentTarget.scrollTop,
              };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const dx = e.clientX - d.x;
              const dy = e.clientY - d.y;
              if (!dragging) {
                if (Math.hypot(dx, dy) < 4) return;
                setDragging(true);
                e.currentTarget.setPointerCapture(e.pointerId);
              }
              e.currentTarget.scrollLeft = d.l - dx;
              e.currentTarget.scrollTop = d.t - dy;
            }}
            onPointerUp={() => {
              drag.current = null;
              setDragging(false);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragging(false);
            }}
            onDoubleClick={(e) => {
              if (!img) return;
              if (view.mode === "actual") {
                const back = defaultMode(img, stage);
                setMode(back === "actual" ? "fit" : back);
              } else if (vp && imgRef.current) {
                anchor.current = anchorAt(
                  vp,
                  imgRef.current,
                  e.clientX,
                  e.clientY,
                );
                setView({ mode: "actual", scale: 1 });
              }
            }}
            className={cn(
              "absolute inset-0 overflow-auto overscroll-contain",
              overflow && (dragging ? "cursor-grabbing" : "cursor-grab"),
            )}
          >
            <div className="relative flex min-h-full w-max min-w-full items-center justify-center p-3 sm:p-6">
              {/* biome-ignore lint/performance/noImgElement: the original from the public bucket, shown as-is. */}
              <img
                ref={imgRef}
                key={tile.url}
                src={tile.url}
                alt={tile.name}
                decoding="async"
                draggable={false}
                onLoad={(e) => {
                  const loaded = {
                    url: tile.url,
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  };
                  const now = vp ? measure(vp) : stage;
                  setStage(now);
                  setNatural(loaded);
                  anchor.current = "top";
                  setView({ mode: defaultMode(loaded, now), scale: 1 });
                }}
                style={
                  img
                    ? { width: img.w * scale, height: img.h * scale }
                    : undefined
                }
                className={cn(
                  "max-w-none select-none rounded-md shadow-sm",
                  !img && "absolute size-px opacity-0",
                )}
              />
            </div>
          </div>
          {list.length > 1 ? (
            <>
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous image"
                onClick={() => step(-1)}
                className="absolute top-1/2 left-4 hidden size-10 -translate-y-1/2 rounded-full bg-background/90 shadow-sm sm:inline-flex"
              >
                <ChevronLeft className="size-5" aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next image"
                onClick={() => step(1)}
                className="absolute top-1/2 right-4 hidden size-10 -translate-y-1/2 rounded-full bg-background/90 shadow-sm sm:inline-flex"
              >
                <ChevronRight className="size-5" aria-hidden />
              </Button>
            </>
          ) : null}
          {mini && scroll ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Minimap: click to jump there"
              onClick={(e) => {
                if (!vp) return;
                const r = e.currentTarget.getBoundingClientRect();
                vp.scrollLeft =
                  ((e.clientX - r.left) / r.width) * scroll.sw - scroll.w / 2;
                vp.scrollTop =
                  ((e.clientY - r.top) / r.height) * scroll.sh - scroll.h / 2;
              }}
              style={{ width: mini.w, height: mini.h }}
              className="absolute right-4 bottom-4 hidden cursor-pointer overflow-hidden rounded-md border bg-background shadow-sm sm:block"
            >
              {/* biome-ignore lint/performance/noImgElement: same cached original, scaled down. */}
              <img
                src={tile.url}
                alt=""
                draggable={false}
                className="size-full object-fill opacity-70"
              />
              <span
                className="absolute rounded-sm border-2 border-primary"
                style={mini.box}
                aria-hidden
              />
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t p-3 sm:flex-row sm:items-center sm:px-6">
          <Input
            readOnly
            value={tile.url}
            aria-label="Public URL"
            onFocus={(e) => e.currentTarget.select()}
            className="h-9 min-w-0 flex-1 bg-muted/40 font-mono text-[13px] text-muted-foreground"
          />
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              className="col-span-2 h-11 sm:h-9"
              onClick={() => copy("link", tile.url)}
            >
              {copied === "link" ? (
                <Check aria-hidden />
              ) : (
                <LinkIcon aria-hidden />
              )}
              {copied === "link" ? "Copied" : "Copy link"}
            </Button>
            <Button
              variant="outline"
              className="h-11 sm:h-9"
              onClick={() => copy("md", `![${tile.name}](${tile.url})`)}
            >
              {copied === "md" ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied === "md" ? "Copied" : "Markdown"}
            </Button>
            <a
              href={tile.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-11 sm:h-9",
              )}
            >
              <ExternalLink aria-hidden />
              Original
            </a>
          </div>
          <output className="sr-only">
            {copied === "link"
              ? "Link copied"
              : copied === "md"
                ? "Markdown copied"
                : ""}
          </output>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MediaGallery({
  sections,
  viewAll,
}: {
  sections: GallerySection[];
  /** "All repos": each repo header links to its own filtered view. */
  viewAll: boolean;
}) {
  const [open, setOpen] = useState<{ repo: string; index: number } | null>(
    null,
  );
  // The viewer steps through the images of one repo, in on-screen order.
  const images = (repo: string) =>
    (sections.find((s) => s.repo === repo)?.dates ?? [])
      .flatMap((d) => d.files)
      .filter((t) => t.thumb);

  return (
    <>
      {sections.map((s) => (
        <section
          key={s.repo}
          className="space-y-3"
          aria-labelledby={`media-${s.repo}`}
        >
          <div className="flex items-center gap-2 border-b pb-2">
            <Folder className="size-4 text-muted-foreground" aria-hidden />
            <h3
              id={`media-${s.repo}`}
              className="font-mono text-sm font-semibold"
            >
              {s.repo}
            </h3>
            <span className="rounded-full bg-muted px-2 text-xs leading-5 text-muted-foreground tabular-nums">
              {s.count}
            </span>
            {viewAll ? (
              <Link
                href={`/media?repo=${encodeURIComponent(s.repo)}`}
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  "ml-auto h-9",
                )}
              >
                View all<span className="sr-only"> in {s.repo}</span>
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </div>
          {s.dates.map((d) => (
            <div key={d.date} className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">
                <time dateTime={d.date}>{d.label}</time> ·{" "}
                <span className="tabular-nums">{d.total}</span>
              </p>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
                {d.files.map((t) => (
                  <MediaTile
                    key={t.key}
                    tile={t}
                    onOpen={() =>
                      setOpen({
                        repo: s.repo,
                        index: images(s.repo).findIndex((x) => x.key === t.key),
                      })
                    }
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {open ? (
        <Viewer
          list={images(open.repo)}
          index={open.index}
          onIndex={(index) => setOpen({ ...open, index })}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
