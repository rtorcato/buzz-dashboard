// DESIGN.md → "Agent settings, reference-only" (#109). The dashboard can't
// publish a config revision yet, so a change is a set of Buzz Desktop steps.

export const SETTINGS = {
  Model: {
    // Short names are what Desktop takes; a blank model means opus.
    values: ["opus", "sonnet", "haiku", "fable"],
  },
  Effort: {
    // What Desktop's Effort field offers for claude-acp: claude-agent-acp
    // builds it from the Claude SDK's per-model `supportedEffortLevels`, plus
    // "default" (the model decides). Older 4.x models drop xhigh and max.
    values: ["default", "low", "medium", "high", "xhigh", "max"],
  },
} as const;

export type Setting = keyof typeof SETTINGS;

/** The numbered steps for changing `setting` to `value` in Buzz Desktop. */
export function desktopSteps(
  name: string,
  setting: Setting,
  value: string,
  stopped: boolean,
): string[] {
  return [
    `Open Buzz Desktop → Agents → ${name} → Edit`,
    `Set ${setting} to ${value}`,
    stopped
      ? `Save, then Start ${name} so it loads the new value.`
      : `Save. ${name} picks it up on its next turn.`,
  ];
}

/** The steps as plain numbered text, for the clipboard. */
export const stepsText = (steps: string[]) =>
  steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
