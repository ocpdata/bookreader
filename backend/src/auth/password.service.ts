import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { isCommonPassword } from './common-passwords';

export const MIN_PASSWORD_LENGTH = 12;
/** bcrypt solo usa los primeros 72 bytes: se rechaza más largo en vez de truncar en silencio. */
export const MAX_PASSWORD_BYTES = 72;

@Injectable()
export class PasswordService {
  private readonly cost = Number(process.env.BCRYPT_COST) > 0 ? Number(process.env.BCRYPT_COST) : 12;
  // Hash de relleno: verificar contra él cuando el usuario no existe iguala el tiempo de respuesta.
  private readonly dummyHash = bcrypt.hashSync('relleno-para-igualar-tiempos', this.cost);

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  /** Verifica sin delatar si el usuario existe: sin hash, compara igualmente contra el relleno. */
  async verify(plain: string, hash: string | null): Promise<boolean> {
    const ok = await bcrypt.compare(plain, hash ?? this.dummyHash);
    return hash !== null && ok;
  }

  /**
   * Reglas de la contraseña. Con `context` (registro y restablecimiento) también se rechaza la que contiene el
   * correo o el nombre de la persona.
   */
  assertAcceptable(plain: string, context?: { email?: string; name?: string }) {
    if (plain.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
    }
    if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
      throw new BadRequestException(`La contraseña no puede superar ${MAX_PASSWORD_BYTES} bytes`);
    }
    if (isCommonPassword(plain)) throw new BadRequestException('Esa contraseña es demasiado común; elige otra');
    if (context) {
      // Se compara solo con letras y números: "laura-prueba-1" también contiene a "Laura Prueba".
      const squash = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const lower = squash(plain);
      const local = squash(context.email?.split('@')[0] ?? '');
      const name = squash(context.name ?? '');
      if ((local.length >= 4 && lower.includes(local)) || (name.length >= 4 && lower.includes(name))) {
        throw new BadRequestException('La contraseña no puede contener tu correo ni tu nombre');
      }
    }
  }
}
