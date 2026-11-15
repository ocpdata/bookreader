// Id del usuario propietario creado en la migración users_and_audio_metadata. Hoy solo lo usan las
// migraciones y los scripts de administración: ninguna petición lo asume (la identidad sale de la sesión).
export const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';

export const USER_RESOLVER = Symbol('USER_RESOLVER');

export interface UserRequest {
  headers: Record<string, unknown>;
  method?: string;
  path?: string;
  query?: Record<string, unknown>;
  /** Lo fija el resolver cuando la identidad viene de un token de dispositivo y no de la sesión web. */
  apiToken?: boolean;
}

export interface UserResolver {
  /** Devuelve el id del usuario de la petición, o undefined si no hay sesión válida. */
  resolve(request: UserRequest): string | undefined | Promise<string | undefined>;
}

export const SESSION_COOKIE = 'br_session';
