import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Defensa CSRF adicional a SameSite=Lax: una petición que cambia datos y trae `Origin` debe venir del
 * mismo sitio. Los clientes que no son navegadores (curl) no envían Origin y no sufren CSRF.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly extraOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!UNSAFE_METHODS.has(request.method)) return true;

    const origin = request.headers.origin as string | undefined;
    if (origin) {
      const host = (request.headers['x-forwarded-host'] ?? request.headers.host) as string | undefined;
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        throw new ForbiddenException('Origen no permitido');
      }
      if (originHost !== host && !this.extraOrigins.includes(origin)) {
        throw new ForbiddenException('Origen no permitido');
      }
      return true;
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new ForbiddenException('Origen no permitido');
    return true;
  }
}
