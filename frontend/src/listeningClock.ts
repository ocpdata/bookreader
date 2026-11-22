const FLUSH_MS = 30000
const MAX_INTERVAL_MS = 60000

export class ListeningClock {
  private since: number | null = null
  private pendingMs = 0

  start(now: number) {
    if (this.since === null) this.since = now
  }

  collect(now: number, stop: boolean): number[] {
    if (this.since !== null) {
      this.pendingMs += Math.min(MAX_INTERVAL_MS, Math.max(0, now - this.since))
      this.since = stop ? null : now
    }
    if (!stop && this.pendingMs < FLUSH_MS) return []
    let remaining = Math.floor(this.pendingMs)
    this.pendingMs -= remaining
    const chunks: number[] = []
    while (remaining > 0) {
      const chunk = Math.min(remaining, MAX_INTERVAL_MS)
      chunks.push(chunk)
      remaining -= chunk
    }
    return chunks
  }
}
