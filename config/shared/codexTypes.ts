export interface CodexScanEntry {
  /** Enemy type path as the profile reports it (e.g. /Lotus/Types/Enemies/...). */
  type: string;
  count: number;
}

export type CodexScansResult =
  | { fetchedAt: number; scans: CodexScanEntry[] }
  | { error: "no-account" | "fetch-failed" | "no-data" };
