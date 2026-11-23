import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  // rawBody: el webhook de Stripe verifica la firma sobre el cuerpo sin procesar.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Detrás de Nginx: req.ip toma la IP real del cliente (X-Forwarded-For), necesaria para limitar intentos.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  configureApp(app);
  // Solo escucha en loopback: sin autenticación no debe exponerse a la red.
  await app.listen(process.env.PORT ?? 3000, '127.0.0.1');
}
bootstrap();
