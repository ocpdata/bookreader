import { Injectable } from '@nestjs/common';

export const HOUR_MS = 60 * 60 * 1000;

/**
 * Ventana deslizante en memoria (una sola instancia). `allow` registra el intento y dice si cabe en el límite;
 * los intentos rechazados no se registran, así que la ventana se libera sola con el tiempo.
 */
@Injectable()
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      return false;
    }
    this.hits.set(key, [...recent, now]);
    return true;
  }

  /** Solo para pruebas. */
  clear() {
    this.hits.clear();
  }
}
