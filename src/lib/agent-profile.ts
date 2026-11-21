// DESIGN.md → "Edit profile (#113)". The avatar, display name and About sit in
// the agent's own profile event, which only its key can sign, so a change is a
// set of Buzz Desktop steps. Nothing is saved from the dashboard.

export const PROFILE_FIELDS = ["Avatar", "Display name", "About"] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Every name Buzz Desktop shows in step 1, each one a chip in the modal. */
export const desktopPath = (name: string) => [
  "Buzz Desktop",
  "Agents",
  name,
  "Edit",
];

/**
 * Steps 2 and 3. Each step is a list of parts; odd-indexed parts are the ones
 * the modal bolds. Step 1 is `desktopPath`, so it is not repeated here.
 */
export function profileSteps(field: ProfileField, value: string): string[][] {
  const v = value.trim();
  if (field === "Avatar") {
    return [
      ["Click the avatar and pick a new image"],
      ["Save. The new picture shows here."],
    ];
  }
  return [
    v ? [`Set ${field} to `, v] : [`Set ${field}`],
    [
      field === "Display name"
        ? "Save. The new name shows here."
        : "Save. The new About is published on its profile.",
    ],
  ];
}

/** The steps as plain numbered text, with `›` between the path names. */
export function profileText(name: string, steps: string[][]): string {
  return [[desktopPath(name).join(" › ")], ...steps.map((s) => [s.join("")])]
    .map((s, i) => `${i + 1}. ${s[0]}`)
    .join("\n");
}
