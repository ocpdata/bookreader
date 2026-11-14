import { Injectable } from '@nestjs/common';
import { DEFAULT_USER_ID, UserResolver } from './user.constants';

/** Reemplazar por la lectura del token cuando exista el login: es el único punto que cambia. */
@Injectable()
export class SingleUserResolver implements UserResolver {
  resolve(): string {
    return DEFAULT_USER_ID;
  }
}
