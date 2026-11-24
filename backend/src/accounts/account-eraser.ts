import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Lo único que necesita del almacenamiento (permite usarlo también desde el script de administración). */
export interface EraserStorage {
  /** Devuelve las claves que no se pudieron borrar. */
  deleteObjects(keys: string[]): Promise<string[]>;
}

export const OWNER_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Borrado definitivo de cuentas y de audios concretos (derecho de cancelación y retiro de contenido).
 * Primero los archivos de S3 y después las filas, nunca al revés: si S3 falla, las filas se conservan para
 * poder reintentar y no quedan archivos huérfanos sin dueño.
 */
@Injectable()
export class AccountEraser {
  private readonly logger = new Logger(AccountEraser.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: EraserStorage,
  ) {}

  private keysOf(rows: { s3Key: string; coverKey: string | null }[]) {
    return rows.flatMap((r) => (r.coverKey ? [r.s3Key, r.coverKey] : [r.s3Key]));
  }

  /** Elimina un audio (archivo, portada y fila) sin pasar por la papelera. Devuelve su título y su dueño. */
  async deleteAudio(summaryId: string) {
    const row = await this.prisma.summary.findUnique({
      where: { id: summaryId },
      select: { id: true, title: true, userId: true, s3Key: true, coverKey: true, user: { select: { email: true } } },
    });
    if (!row) throw new NotFoundException('Audio no encontrado');
    const failed = await this.storage.deleteObjects(this.keysOf([row]));
    if (failed.length) throw new BadGatewayException('No se pudo eliminar el archivo; inténtalo de nuevo');
    await this.prisma.summary.delete({ where: { id: row.id } });
    this.logger.warn(`Audio eliminado por el administrador: ${row.id} (usuario ${row.userId})`);
    return { title: row.title, userId: row.userId, email: row.user.email };
  }

  /**
   * Elimina la cuenta y todo lo suyo: archivos de S3 (audios y portadas, también los de la papelera y las cargas
   * pendientes), carpetas, etiquetas, favoritos, progreso, marcadores, sesiones y apps vinculadas.
   * Si S3 no borra todo, conserva la cuenta con lo que falta y lanza un error para reintentar.
   */
  async deleteAccount(userId: string): Promise<{ audios: number }> {
    if (userId === OWNER_ID) throw new Error('La cuenta propietaria no se puede eliminar');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const rows = await this.prisma.summary.findMany({ where: { userId }, select: { id: true, s3Key: true, coverKey: true } });

    const failed = new Set(await this.storage.deleteObjects(this.keysOf(rows)));
    if (failed.size) {
      // Se borran las filas cuyos archivos ya no existen y se conserva el resto para reintentar.
      const done = rows.filter((r) => !failed.has(r.s3Key) && !(r.coverKey && failed.has(r.coverKey))).map((r) => r.id);
      if (done.length) await this.prisma.summary.deleteMany({ where: { id: { in: done } } });
      throw new BadGatewayException('No se pudieron eliminar todos tus archivos; inténtalo de nuevo en un momento');
    }

    await this.prisma.$transaction([
      this.prisma.summary.deleteMany({ where: { userId } }),
      ...(user.email
        ? [this.prisma.share.deleteMany({ where: { email: user.email.trim().toLowerCase(), recipientId: null } })]
        : []),
      // Una carpeta anidada apunta a su padre con una clave foránea: se sueltan antes de borrarlas todas.
      this.prisma.folder.updateMany({ where: { userId }, data: { parentId: null } }),
      this.prisma.folder.deleteMany({ where: { userId } }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
    this.logger.warn(`Cuenta eliminada: ${userId} (${rows.length} audios)`);
    return { audios: rows.length };
  }
}
