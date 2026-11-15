import { Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_ACCOUNT_AND_IP = 5;
const MAX_FAILURES_PER_IP = 30;

/**
 * Límite de intentos fallidos en memoria (una sola instancia). Se cuenta por IP + cuenta, así un
 * atacante solo bloquea su propia IP y no deja fuera al dueño de la cuenta.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  private recent(key: string, now: number): number[] {
    const recent = (this.failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length) this.failures.set(key, recent);
    else this.failures.delete(key);
    return recent;
  }

  isBlocked(ip: string, email: string, now = Date.now()): boolean {
    return (
      this.recent(`pair:${ip}|${email}`, now).length >= MAX_FAILURES_PER_ACCOUNT_AND_IP ||
      this.recent(`ip:${ip}`, now).length >= MAX_FAILURES_PER_IP
    );
  }

  recordFailure(ip: string, email: string, now = Date.now()) {
    for (const key of [`pair:${ip}|${email}`, `ip:${ip}`]) {
      this.failures.set(key, [...this.recent(key, now), now]);
    }
  }

  reset(ip: string, email: string) {
    this.failures.delete(`pair:${ip}|${email}`);
  }
}
