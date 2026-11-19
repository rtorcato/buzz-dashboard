// Regenerates the docs screenshots in apps/docs/static/img/screens/ from the
// real views running on sample data (src/lib/sample-data.ts).
//
//   pnpm screens
//
// Starts `next dev` with BUZZ_SAMPLE_DATA=1 on its own port, walks each view in
// light and dark, writes WebP (quality 82), then stops the server. Needs a
// Playwright Chromium once: `pnpm exec playwright install chromium`.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const PORT = Number(process.env.SCREENS_PORT) || 3123;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL("../apps/docs/static/img/screens/", import.meta.url);
const THEMES = ["light", "dark"];

// A bare env so no real credentials ride along. Next still reads .env.local,
// but sample mode skips every relay, GitHub and R2 read.
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--port",
    String(PORT),
    "--hostname",
    "127.0.0.1",
  ],
  {
    cwd: new URL("..", import.meta.url),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      BUZZ_SAMPLE_DATA: "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  },
);
const stop = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
};
process.on("exit", stop);
// A signal kills Node without emitting "exit", so stop the server on these too.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stop();
    process.exit(1);
  });
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/agents`)).ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`next dev did not answer on ${BASE} within 2 minutes`);
}

const browser = await (async () => {
  await waitForServer();
  return chromium.launch();
})();

// Desktop shots taken so far, reused as the Media view's thumbnails.
const taken = [];
const thumbs = new Map();

async function open(theme, viewport, deviceScaleFactor, isMobile = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    isMobile,
    hasTouch: isMobile,
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  // next-themes reads localStorage first; the dev-tools badge stays out of shot.
  await context.addInitScript((t) => {
    localStorage.setItem("theme", t);
    addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important}";
      document.head.append(s);
    });
  }, theme);
  // Media thumbnails point at media.example.com; answer with earlier shots.
  await context.route("https://media.example.com/**", (route) => {
    const url = route.request().url();
    if (!thumbs.has(url)) thumbs.set(url, taken[thumbs.size % taken.length]);
    route.fulfill({ contentType: "image/png", body: thumbs.get(url) });
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date());
  return page;
}

async function go(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
}

// PNG from Playwright → WebP q82 via the browser's own encoder.
async function save(page, name, png) {
  // Full views and the grid only: a phone or a thin strip makes a poor thumb.
  if (!/^(mobile|needs-you)/.test(name)) taken.push(png);
  const dataUrl = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", 0.82);
  }, png.toString("base64"));
  if (!dataUrl.startsWith("data:image/webp"))
    throw new Error("no WebP encoder");
  await writeFile(
    new URL(name, OUT),
    Buffer.from(dataUrl.split(",")[1], "base64"),
  );
  console.log(`wrote ${name}`);
}

try {
  await mkdir(OUT, { recursive: true });
  // Media goes last so its thumbnails can reuse the other shots.
  for (const theme of THEMES) {
    const page = await open(theme, { width: 1440, height: 900 }, 2);
    await go(page, "/agents");
    await save(page, `agents-${theme}.webp`, await page.screenshot());
    const needsYou = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole("heading", { name: "Needs you" }) });
    await save(page, `needs-you-${theme}.webp`, await needsYou.screenshot());
    const grid = page
      .getByRole("heading", { name: "Agents", exact: true })
      .locator("xpath=../following-sibling::div[1]");
    await save(page, `agents-grid-${theme}.webp`, await grid.screenshot());
    await go(page, "/agents/fern");
    await save(page, `agent-page-${theme}.webp`, await page.screenshot());
    await page.context().close();
  }
  for (const theme of THEMES) {
    const page = await open(theme, { width: 390, height: 844 }, 3, true);
    await go(page, "/agents");
    await save(page, `mobile-${theme}.webp`, await page.screenshot());
    await page.context().close();
  }
  for (const theme of THEMES) {
    const page = await open(theme, { width: 1440, height: 900 }, 2);
    await go(page, "/media");
    await save(page, `media-${theme}.webp`, await page.screenshot());
    await page.context().close();
  }
} finally {
  await browser.close();
  stop();
}
