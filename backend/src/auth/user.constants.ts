// Usuario único hasta que exista el login. Se crea en la migración users_and_audio_metadata.
export const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';

export const USER_RESOLVER = Symbol('USER_RESOLVER');

export interface UserResolver {
  /** Devuelve el id del usuario de la petición, o undefined si no hay sesión. */
  resolve(request: { headers: Record<string, unknown> }): string | undefined;
}
