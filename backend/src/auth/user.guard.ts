import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from './public.decorator';
import { USER_RESOLVER, UserResolver } from './user.constants';

/** Exige sesión salvo en endpoints @Public(). Fija request.userId; nunca viene de parámetros de la petición. */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(
    @Inject(USER_RESOLVER) private readonly resolver: UserResolver,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const userId = await this.resolver.resolve(request);
    if (!userId) throw new UnauthorizedException('Inicia sesión para continuar');
    request.userId = userId;
    return true;
  }
}
