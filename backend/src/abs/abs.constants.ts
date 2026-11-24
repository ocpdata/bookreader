/**
 * Versión de Audiobookshelf que se anuncia. Las apps comparan contra 2.22.0: desde esa versión usan la URL
 * de audio pública por sesión (sin token), que es la que implementamos.
 */
export const ABS_VERSION = '2.22.0';

export const LIBRARY_ID = 'lib_resumenes';
export const LIBRARY_FOLDER_ID = 'fol_resumenes';
export const LIBRARY_NAME = 'Resúmenes';

export const absCompatEnabled = () => process.env.ABS_COMPAT_ENABLED !== 'false';

export function mobileServerUrl(): string | null {
  const configured = process.env.APP_PUBLIC_URL;
  if (!configured || !URL.canParse(configured)) return null;
  const url = new URL(configured);
  if (
    url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
    url.hostname === '[::1]' || url.hostname === '0.0.0.0' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname)
  ) return null;
  return url.origin;
}

/** Los clientes no mandan Origin ni cookies; estas rutas viven en la raíz (fuera del prefijo /api). */
export const ROOT_ROUTES = ['ping', 'status', 'login', 'logout', 'public/(.*)'];
