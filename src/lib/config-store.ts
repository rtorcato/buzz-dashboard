import "server-only";

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { schnorr } from "@noble/curves/secp256k1.js";

// Values saved by the setup wizard (#73), keyed by the env var they stand in
// for. One flat JSON file on the config volume. It holds the dashboard's own
// private key in the clear (it is the root key #68 wraps other secrets with),
// so the 0600 file mode is its only protection, like BUZZ_PRIVATE_KEY in an
// env file.
export type SavedConfig = Record<string, string>;

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.BUZZ_CONFIG_DIR || "./data", "config.json");
}

export function readSavedConfig(path = configPath()): SavedConfig {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        (e): e is [string, string] => typeof e[1] === "string" && e[1] !== "",
      ),
    );
  } catch {
    return {}; // missing or unreadable: nothing saved yet
  }
}

export function saveConfig(patch: SavedConfig, path = configPath()): void {
  const next = { ...readSavedConfig(path), ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600); // mode is ignored when the file already exists
}

// Env always beats saved config, value by value. Empty env counts as unset.
export function mergeConfig(
  env: Record<string, string | undefined>,
  saved: SavedConfig,
): Record<string, string | undefined> {
  const set = Object.entries(env).filter(([, v]) => v);
  return { ...saved, ...Object.fromEntries(set) };
}

// First visit to the key step: make the dashboard's own identity, once. Only
// the public key leaves this module.
export function ensureDashboardKey(path = configPath()): string {
  let hex = readSavedConfig(path).BUZZ_PRIVATE_KEY;
  if (!hex) {
    hex = randomBytes(32).toString("hex");
    saveConfig({ BUZZ_PRIVATE_KEY: hex }, path);
  }
  return Buffer.from(schnorr.getPublicKey(Buffer.from(hex, "hex"))).toString(
    "hex",
  );
}

// Puts saved values into process.env where the env has none, so the readers
// that look at process.env (GitHub, media, history) see them. Env wins. Only
// once setup is finished: while it is open, saved relay keys in process.env
// would read as the env file setting them and close setup early.
export function applySavedConfig(
  env: Record<string, string | undefined> = process.env,
  saved: SavedConfig = readSavedConfig(),
): void {
  if (saved.SETUP_DONE !== "1") return;
  for (const [k, v] of Object.entries(saved)) if (!env[k]) env[k] = v;
}
