/**
 * Versión de Audiobookshelf que se anuncia. Las apps comparan contra 2.22.0: desde esa versión usan la URL
 * de audio pública por sesión (sin token), que es la que implementamos.
 */
export const ABS_VERSION = '2.22.0';

export const LIBRARY_ID = 'lib_resumenes';
export const LIBRARY_FOLDER_ID = 'fol_resumenes';
export const LIBRARY_NAME = 'Resúmenes';

/** Los clientes no mandan Origin ni cookies; estas rutas viven en la raíz (fuera del prefijo /api). */
export const ROOT_ROUTES = ['ping', 'status', 'login', 'logout', 'public/(.*)'];
