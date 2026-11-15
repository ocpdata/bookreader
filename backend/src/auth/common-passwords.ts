/** Contraseñas muy usadas que cumplen el largo mínimo (12): se rechazan al registrarse o restablecer. */
const COMMON = [
  '123456789012', '1234567890123', '12345678901234', '123456123456', '111111111111', '000000000000',
  'password1234', 'password12345', 'password123456', 'passw0rd1234', 'contrasena123', 'contrasena1234',
  'contraseña123', 'contraseña1234', 'micontrasena', 'micontraseña', 'qwertyuiop12', 'qwertyuiopas',
  'qwerty123456', 'asdfghjkl123', 'abcdefgh1234', 'abc123abc123', 'iloveyou1234', 'welcome12345',
  'letmein12345', 'letmein123456', 'administrator', 'administrador', 'changeme1234', 'bienvenido123',
  'bookreader123', 'bookreader1234', 'audiobook123', 'football1234', 'baseball1234', 'superman1234',
  'trustno11234', 'mexico123456', 'colombia1234', 'argentina123', 'te amo te amo', 'teamoteamote',
].map((p) => p.replace(/\s/g, '').toLowerCase());

const BLOCKED = new Set(COMMON);

export function isCommonPassword(plain: string): boolean {
  const lower = plain.toLowerCase();
  if (BLOCKED.has(lower)) return true;
  // Un solo carácter repetido ("aaaaaaaaaaaa").
  return new Set(lower).size === 1;
}
