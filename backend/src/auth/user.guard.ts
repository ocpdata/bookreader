import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { USER_RESOLVER, UserResolver } from './user.constants';

/** Fija request.userId desde el resolvedor. El id de usuario nunca viene de parámetros de la petición. */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(@Inject(USER_RESOLVER) private readonly resolver: UserResolver) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const userId = this.resolver.resolve(request);
    if (!userId) throw new UnauthorizedException();
    request.userId = userId;
    return true;
  }
}
