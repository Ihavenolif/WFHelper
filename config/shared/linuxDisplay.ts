/** Which display backend the app joins on Linux. */
export type DisplayPreference = "auto" | "x11" | "wayland";

export interface LinuxDisplayInfo {
  preference: DisplayPreference;
  /** What this session actually launched with. */
  active: "x11" | "auto";
}

export function isDisplayPreference(value: unknown): value is DisplayPreference {
  return value === "auto" || value === "x11" || value === "wayland";
}
