import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ROOT_ROUTES } from './abs/abs.constants';

/** Configuración común de la API (la usan main.ts y las pruebas e2e). */
export function configureApp(app: INestApplication) {
  // Las rutas de las apps compatibles con Audiobookshelf viven en la raíz, sin el prefijo /api.
  app.setGlobalPrefix('api', { exclude: ROOT_ROUTES });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
