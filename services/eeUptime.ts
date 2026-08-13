/** Estimate file-line delay from the minimum wall-clock minus game-uptime offset. */

const UPTIME_PREFIX = /^(\d+)\.(\d{3}) /;

export class EeUptimeTracker {
  private offsetMs: number | null = null;
  private lastUptimeMs = 0;
  private lastStalenessMs = 0;

  reset(): void {
    this.offsetMs = null;
    this.lastUptimeMs = 0;
    this.lastStalenessMs = 0;
  }

  /** Return line staleness; unstamped rows inherit the current batch delay. */
  observe(line: string, nowMs: number): number {
    const m = UPTIME_PREFIX.exec(line);
    if (!m) return this.lastStalenessMs;

    const uptimeMs = Number(m[1]) * 1000 + Number(m[2]);
    if (uptimeMs < this.lastUptimeMs - 5_000) this.offsetMs = null; // game restarted
    this.lastUptimeMs = uptimeMs;

    const offset = nowMs - uptimeMs;
    if (this.offsetMs === null || offset < this.offsetMs) this.offsetMs = offset;
    this.lastStalenessMs = Math.max(0, offset - this.offsetMs);
    return this.lastStalenessMs;
  }
}
