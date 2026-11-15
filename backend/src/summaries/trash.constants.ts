/** Días que un audio eliminado permanece en la papelera antes de borrarse de forma definitiva. */
export const TRASH_RETENTION_DAYS = Number(process.env.TRASH_RETENTION_DAYS) > 0 ? Number(process.env.TRASH_RETENTION_DAYS) : 30;

/** Una carga que nunca se completó se descarta pasadas estas horas (la URL de subida caduca a los 15 min). */
export const PENDING_TTL_HOURS = 24;

/** Máximo de filas que procesa cada ejecución de la purga: limita el alcance de cualquier error. */
export const PURGE_BATCH_SIZE = 100;

export const DAY_MS = 24 * 60 * 60 * 1000;
