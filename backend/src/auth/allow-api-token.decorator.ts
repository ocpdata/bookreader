import { SetMetadata } from '@nestjs/common';

export const ALLOW_API_TOKEN = 'allowApiToken';

/**
 * Los tokens de dispositivo (apps compatibles con Audiobookshelf) solo valen en los controladores
 * marcados con este decorador; el resto de la API exige la sesión web.
 */
export const AllowApiToken = () => SetMetadata(ALLOW_API_TOKEN, true);
