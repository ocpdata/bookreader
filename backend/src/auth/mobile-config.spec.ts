import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { absCompatEnabled } from '../abs/abs.constants';
import { ApiTokenService } from './api-token.service';
import { AppPasswordService } from './app-password.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { USER_RESOLVER, UserRequest } from './user.constants';
import { UserGuard } from './user.guard';

describe('Configuración de apps móviles', () => {
  let app: INestApplication;
  const originalEnabled = process.env.ABS_COMPAT_ENABLED;
  const originalUrl = process.env.APP_PUBLIC_URL;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: SessionService, useValue: {} },
        { provide: ApiTokenService, useValue: {} },
        { provide: AppPasswordService, useValue: {} },
        {
          provide: USER_RESOLVER,
          useValue: {
            resolve: (req: UserRequest) => {
              if (req.headers['x-device']) req.apiToken = true;
              return req.headers['x-user'];
            },
          },
        },
        { provide: APP_GUARD, useClass: UserGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    if (originalEnabled === undefined) delete process.env.ABS_COMPAT_ENABLED;
    else process.env.ABS_COMPAT_ENABLED = originalEnabled;
    if (originalUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = originalUrl;
    await app.close();
  });

  it('requiere sesión web y refleja si la compatibilidad está habilitada', async () => {
    process.env.APP_PUBLIC_URL = 'https://audio.example.test/';
    delete process.env.ABS_COMPAT_ENABLED;
    expect(absCompatEnabled()).toBe(true);
    await request(app.getHttpServer()).get('/api/auth/mobile-config').expect(401);
    await request(app.getHttpServer()).get('/api/auth/mobile-config').set('x-user', 'user').set('x-device', '1').expect(403);
    const enabled = await request(app.getHttpServer()).get('/api/auth/mobile-config').set('x-user', 'user').expect(200);
    expect(enabled.body).toEqual({ enabled: true, serverUrl: 'https://audio.example.test' });

    process.env.ABS_COMPAT_ENABLED = 'false';
    expect(absCompatEnabled()).toBe(false);
    const disabled = await request(app.getHttpServer()).get('/api/auth/mobile-config').set('x-user', 'user').expect(200);
    expect(disabled.body.enabled).toBe(false);
  });

  it.each([
    undefined,
    'no es una URL',
    'http://audio.example.test',
    'https://localhost:5500',
    'https://127.0.0.1:3000',
    'https://[::1]:3000',
    'https://user:password@audio.example.test',
    'https://audio.example.test/ruta',
  ])('no ofrece una dirección no válida para móviles: %s', async (url) => {
    if (url === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = url;
    const response = await request(app.getHttpServer()).get('/api/auth/mobile-config').set('x-user', 'user').expect(200);
    expect(response.body.serverUrl).toBeNull();
  });
});
