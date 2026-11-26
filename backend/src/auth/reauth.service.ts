import { Injectable } from '@nestjs/common';

const REAUTH_TTL_MS = 5 * 60 * 1000;

/**
 * Confirmaciones recientes con Google para acciones delicadas (eliminar la cuenta) de quien no tiene contraseña.
 * Cada una vale unos minutos y se gasta al usarla; viven en memoria (una sola instancia).
 */
@Injectable()
export class ReauthService {
  private readonly grants = new Map<string, number>();

  grant(userId: string) {
    this.grants.set(userId, Date.now() + REAUTH_TTL_MS);
  }

  /** true si había una confirmación vigente; en ese caso la gasta. */
  consume(userId: string) {
    const expiresAt = this.grants.get(userId);
    this.grants.delete(userId);
    return expiresAt !== undefined && expiresAt > Date.now();
  }
}
