import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

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

  assertAcceptable(plain: string) {
    if (plain.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
    }
    if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
      throw new BadRequestException(`La contraseña no puede superar ${MAX_PASSWORD_BYTES} bytes`);
    }
  }
}
