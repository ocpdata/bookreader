import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Marca un endpoint como accesible sin sesión (salud, inicio y cierre de sesión). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
