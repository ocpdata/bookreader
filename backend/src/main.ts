import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Detrás de Nginx: req.ip toma la IP real del cliente (X-Forwarded-For), necesaria para limitar intentos.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Solo escucha en loopback: sin autenticación no debe exponerse a la red.
  await app.listen(process.env.PORT ?? 3000, '127.0.0.1');
}
bootstrap();
