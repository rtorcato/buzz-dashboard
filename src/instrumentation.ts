// Runs once when the server starts. While setup is open (#73) it prints the
// one-time setup token. With DATABASE_URL set it applies the history store's
// migrations and starts the ingester (#39); without it the dashboard stays
// live-only and nothing here loads.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { newSetupToken, setupOpen, SETUP_TTL_S } = await import("./lib/setup");
  const { applySavedConfig } = await import("./lib/config-store");
  const saved = (await import("./lib/config-store")).readSavedConfig();
  const open = setupOpen(process.env, saved);
  applySavedConfig(process.env, saved);
  if (open) {
    console.log(
      `setup token: ${newSetupToken()} (valid ${SETUP_TTL_S / 60} min)`,
    );
  }
  if (!process.env.DATABASE_URL) return;
  const { startHistory } = await import("./lib/ingest");
  await startHistory();
}
