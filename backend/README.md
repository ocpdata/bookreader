<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Compartición de audios

`SharingModule` exporta `SharingService`. `SHARING_ENABLED` está **desactivado por defecto**:
solo el valor exacto `true` habilita crear, reenviar, aceptar y leer audios compartidos.
Desactivarlo conserva lectura propia, listado, rechazo y revocación.
La API usa sesiones web y las defensas globales de autenticación/CSRF; no admite tokens de dispositivo.

Rutas (con el prefijo global `/api`):

- `GET /shares/config` → `{ enabled: boolean }`, para comprobar disponibilidad.
- `POST /shares`, cuerpo `{ email, scope: 'LIBRARY' | 'ITEMS', summaryIds?: string[] }` → `Share`.
- `GET /shares/sent` y `GET /shares/received` → `Share[]`.
- `POST /shares/:id/accept`, `/reject`, `/resend` y `DELETE /shares/:id` → `Share`.

`Share` contiene `id`, `email`, `ownerName`, `scope`, `status`,
`createdAt`, `expiresAt`, `summaryIds` y `summaries` (títulos y autores disponibles de la
selección mientras la invitación esté vigente o aceptada). Fechas ISO en JSON. Estados:
`PENDING`, `ACCEPTED`, `REJECTED`, `REVOKED`. `expiresAt` es el plazo de respuesta:
un pendiente caducado devuelve 409 al aceptar/rechazar; un aceptado **no caduca**,
ni pierde permiso por vencer la prueba comercial.

Crear requiere propietario activo y correo verificado, pero **no consulta si el destinatario existe**.
Listar recibidas y aceptar/rechazar requieren una sesión de cuenta activa con correo verificado
coincidente después de recortar espacios y convertir a minúsculas. No se vincula la cuenta al invitar
ni al listar; `recipientId` solo se fija al decidir. Borrar esa cuenta elimina sus permisos vinculados
por cascada y las invitaciones aún no vinculadas dirigidas a su correo.

`LIBRARY` incluye los futuros audios; `ITEMS` exige 1–200 ids únicos de audios propios READY sin borrar.
Son referencias, no copias. Distintos ámbitos y selecciones pueden coexistir. La huella única de
propietario/correo/ámbito/ids normalizados y ordenados evita duplicados vigentes del mismo contenido.
Las decisiones y revocaciones bloquean la fila del permiso; crear y reenviar serializan cuotas
por propietario en MySQL.

Reenviar solo permite al propietario renovar un `PENDING` (incluso caducado) durante 7 días,
conservando el id y la selección. Revalida disponibilidad de la selección y evita otro permiso
vigente idéntico. Durante la entrega no puede aceptarse; un fallo restaura plazo/entrega anteriores
sin deshacer una revocación concurrente. Crear con fallo de entrega revoca lo no entregado.
Ambos devuelven 503 y registran el fallo sin direcciones ni contenido del proveedor.
El correo enlaza al origen configurado + `/entrar?from=share` o `/registro?from=share`, sin tokens ni ids.
El registro conserva ese contexto en el correo de verificación y regresa a `/invitaciones` después de iniciar sesión;
la cuenta debe usar el mismo correo y aceptar explícitamente. Los enlaces anteriores a `/compartidos` siguen funcionando.
`APP_PUBLIC_URL` debe ser HTTPS explícito en producción, sin credenciales.

`readableWhere(userId): Promise<Prisma.SummaryWhereInput>` devuelve owned OR permisos aceptados
mediante relaciones evaluadas dentro de la consulta de Summary, sin precargar ids ni cachear acceso.
`canRead(userId, summaryId): Promise<boolean>` usa ese mismo predicado.
Las rutas web de lectura agregan filtros READY/deletedAt y mantienen las escrituras exclusivas del
propietario. La reproducción compartida comprueba el permiso en cada petición de rangos; las apps
Audiobookshelf siguen limitadas al contenido propio.

Antiabuso: máximo 100 permisos vigentes por propietario; 20 intentos de correo/hora y 100/día
persistidos en MySQL, incluidos reenvíos y fallos. Además, 30 envíos/IP/hora y 3/dirección/hora en
memoria por instancia. Para despliegues múltiples, mover estos dos últimos límites a Redis/WAF
y limitar solicitudes generales por IP en el proxy; no confiar en `X-Forwarded-For` arbitrario.
La limitación nunca depende de la existencia de la cuenta destinataria.

`SharingService.cleanup()` se ejecuta cada hora (salvo `PURGE_ENABLED=false`):
borra pendientes 30 días después de caducar y rechazadas/revocadas 30 días después de su última
actualización, además de intentos de correo de más de 30 días. Nunca borra permisos aceptados por edad.
La retención permite renovar pendientes caducadas y mostrar decisiones recientes.
Si se desactiva el temporizador, programar este método externamente para mantener la retención.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
