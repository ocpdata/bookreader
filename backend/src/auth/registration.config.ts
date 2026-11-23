export type RegistrationMode = 'closed' | 'invite' | 'open';

/** closed: solo el administrador crea cuentas; invite: se exige un código de invitación; open: cualquiera. */
export function registrationMode(): RegistrationMode {
  const mode = process.env.REGISTRATION_MODE;
  return mode === 'open' || mode === 'invite' ? mode : 'closed';
}

/** Versión de los términos y del aviso de privacidad que aceptan las personas al registrarse. */
export const TERMS_VERSION = '2026-11-22.2';

/** Duración de la prueba gratuita que inicia al verificar el correo (una por dirección). */
export const TRIAL_DAYS = 30;

export const appUrl = (path: string) => `${(process.env.APP_PUBLIC_URL ?? 'http://localhost:5500').replace(/\/$/, '')}${path}`;
