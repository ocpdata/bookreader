# BookReader

Biblioteca personal de resúmenes de libros en audio (un solo usuario, uso local).

- **Frontend:** React + TypeScript + Vite + MUI (`frontend/`)
- **Backend:** NestJS + Prisma (`backend/`)
- **Base de datos:** MySQL 8.4 en Docker (`compose.yaml`, puerto local 3307)
- **Audios:** bucket S3 privado; el navegador sube y reproduce con URLs prefirmadas temporales.

> No tiene autenticación: no lo publiques en Internet. El backend solo escucha en `127.0.0.1`.

## Requisitos

Node 20+, Docker, AWS CLI con credenciales locales (`~/.aws`) y un bucket S3 privado.

## Puesta en marcha

```bash
docker compose up -d                      # MySQL
cp .env.example backend/.env              # ajusta S3_BUCKET y AWS_REGION

cd backend
npm install
npx prisma migrate deploy
npx prisma db seed                        # categorías iniciales
npm run start:dev                         # http://127.0.0.1:3000/api

cd ../frontend                            # en otra terminal
npm install
npm run dev                               # http://localhost:5500
```

### CORS del bucket (una sola vez)

La carga desde el navegador requiere CORS para `http://localhost:5500`:

```bash
aws s3api put-bucket-cors --bucket <tu-bucket> --cors-configuration file://backend/s3-cors.json
```

Las credenciales AWS las toma el SDK de tu perfil local; nunca van al frontend ni al repo.

## API

| Método | Endpoint | Función |
| --- | --- | --- |
| GET | `/api/categories` | Listar categorías |
| GET | `/api/summaries` | Listar/buscar los audios del usuario (solo `READY`; sin distinguir acentos ni mayúsculas). Parámetros: `search` (título, autor, título del resumen o etiqueta), `categoryId`, `folderId` (id o `root` = sin carpeta) con `includeSubfolders=true`, `tag`, `favorite=true`, `status=finished\|unfinished`, `sort=recent\|title\|duration\|listened` |
| GET | `/api/summaries/:id` | Consultar un resumen |
| POST | `/api/summaries` | Crear registro `PENDING` y obtener URL de carga |
| POST | `/api/summaries/:id/complete` | Verificar el objeto en S3, leer su duración real (rechaza archivos que no son audio) y marcar `READY` |
| PATCH | `/api/summaries/:id` | Editar título, autor, título del resumen, narrador, categoría, descripción y etiquetas (`tags`; `[]` las quita todas) |
| POST | `/api/summaries/:id/playback` | URL temporal de reproducción |
| PUT | `/api/summaries/:id/progress` | Guardar la posición (`positionSeconds`) y/o `completed` |
| DELETE | `/api/summaries/:id/progress` | Reiniciar: borra el progreso |
| DELETE | `/api/summaries/:id` | Mover a la papelera (recuperable; el archivo sigue en S3) |
| POST | `/api/summaries/:id/restore` | Restaurar desde la papelera |
| GET | `/api/trash` | Audios en la papelera, con la fecha de borrado definitivo (`purgeAt`) |
| DELETE | `/api/trash/:id` | Borrado definitivo de un audio que ya está en la papelera |
| DELETE | `/api/trash` | Vaciar la papelera del usuario |
| PUT / DELETE | `/api/summaries/:id/favorite` | Marcar / quitar de favoritos |
| GET | `/api/tags?query=` | Etiquetas del usuario con su número de audios (para autocompletar y filtrar) |
| GET | `/api/home` | Datos de la pantalla de inicio: `continueListening` (hasta 10), `recent` (8), `favorites` (8) y `categories` con su conteo |
| GET / POST | `/api/folders` | Listar las carpetas del usuario (plana, con `parentId` y `count` de audios directos) / crear una (`name`, `parentId` opcional) |
| PATCH / DELETE | `/api/folders/:id` | Renombrar o mover (`name`, `parentId`; `null` = raíz) / eliminar |
| POST | `/api/summaries/move` | Mover varios audios (`ids` hasta 100, `folderId` o `null`); todo o nada |
| GET | `/api/health` | Estado de la API y de la base de datos |

Formatos aceptados: MP3 y M4A, hasta 200 MB. Cada carga usa una clave nueva `audios/{userId}/{uuid}/audio.ext`.

## Progreso de reproducción

Cada usuario tiene su posición en cada audio (`playback_progress`); la lista y la ficha la devuelven en `progress`. El reproductor guarda cada 10 s mientras suena y al pausar, saltar, terminar o salir de la pantalla. Reglas: al reabrir retoma desde la posición guardada, salvo que el audio esté terminado (entonces empieza de cero); se marca **terminado** al llegar al 95 % o al final, se mantiene hasta que se cambie a mano ("Marcar como pendiente") y "Reiniciar" borra el progreso.

## Pantallas

`/` es el **inicio**: continuar escuchando (empezados y no terminados, el último escuchado primero), agregados recientemente, favoritos (el marcado más reciente primero) y categorías con su conteo, más una búsqueda que lleva a la biblioteca. `/biblioteca` es la lista completa con búsqueda, filtros y orden. `/papelera` lista lo eliminado. Luego están la ficha con el reproductor (`/audios/:id`) y el formulario de alta y edición (`/audios/nuevo`, `/audios/:id/editar`).

## Papelera y limpieza

"Eliminar" mueve el audio a la papelera: deja de verse y reproducirse, pero conserva su fila, su archivo de S3, sus etiquetas, favorito y progreso, así que **restaurar** lo devuelve intacto (la interfaz ofrece "Deshacer"). Se borra de forma definitiva desde `/papelera` (con confirmación), al vaciarla, o automáticamente a los 30 días (`TRASH_RETENTION_DAYS`).

Un proceso interno (`PurgeService`, cada 6 horas) borra la papelera vencida y las cargas que nunca se completaron en 24 h; se desactiva con `PURGE_ENABLED=false` (en desarrollo local conviene dejarlo apagado). Salvaguardas: siempre se borra primero el archivo y después la fila (si S3 falla, la fila se conserva y se reintenta); el servidor solo borra la clave exacta guardada en la fila y solo si tiene la forma `audios/{userId}/{uuid}/audio.mp3|m4a` (o el formato anterior sin usuario); cada ejecución procesa como máximo 100 filas; un audio vivo nunca se purga. El rol de IAM de la VM necesita `s3:DeleteObject` sobre `audios/*` (definido en `infra/`).

## Carpetas

Cada usuario organiza sus audios en carpetas anidadas (hasta 5 niveles y 200 carpetas). Un audio está en **una sola** carpeta (`summaries.folder_id`; nulo = raíz) y las etiquetas y la categoría siguen sirviendo para agrupar de otras formas. El nombre es único entre carpetas hermanas (sin distinguir mayúsculas ni acentos). Una carpeta ajena responde 404.

- **Mover**: una carpeta no puede ir dentro de sí misma ni de sus subcarpetas, ni superar los 5 niveles. Los audios se mueven uno a uno (`PATCH /api/summaries/:id` con `folderId`) o en lote (`POST /api/summaries/move`).
- **Eliminar una carpeta** no borra nada: sus audios (también los de la papelera) y subcarpetas suben a la carpeta padre; una subcarpeta cuyo nombre ya existe arriba se renombra "X (2)". Restaurar un audio de la papelera lo deja en su carpeta (o en la que heredó).
- **Concurrencia**: las escrituras de carpetas de un usuario se serializan con un bloqueo sobre su fila (`FoldersService`), así que nombre único, ciclos, profundidad y tope no compiten entre peticiones.
- **Interfaz**: `/biblioteca?carpeta=<id>` navega por carpetas con migas de pan; con búsqueda o filtros se mira toda la biblioteca y cada audio muestra su ruta.

## Etiquetas y favoritos

Las etiquetas son libres y de cada usuario (hasta 10 por audio, 50 caracteres). MySQL las compara sin distinguir mayúsculas ni acentos, así que "Ventas" y "ventas" son la misma etiqueta y se conserva la primera grafía. Al quitar la última referencia a una etiqueta, esta desaparece de las sugerencias. Los favoritos también son por usuario. La biblioteca filtra por etiqueta, favoritos, estado (terminados o pendientes), categoría y texto, y ordena por fecha, título, duración o última escucha; filtros y orden viven en la URL.

## Usuarios y acceso

Cada audio pertenece a un usuario y todas las consultas se filtran por él; un audio ajeno responde 404. Toda la API exige sesión salvo `/api/health`, `POST /api/auth/login` y `POST /api/auth/logout`.

- **Sesiones en servidor**: el login (`POST /api/auth/login`, correo + contraseña) crea una fila en `sessions` y entrega la cookie `br_session` (`HttpOnly`, `SameSite=Lax`, `Secure` si `NODE_ENV=production` o `COOKIE_SECURE=true`). La BD guarda solo el hash SHA-256 del token. Caducan a los 30 días de inactividad (se renuevan como máximo una vez al día) y las vencidas se limpian cada hora. `GET /api/auth/me` devuelve el usuario; `POST /api/auth/password` cambia la contraseña y cierra las demás sesiones (contraseña actual errónea → 400).
- **Contraseñas**: bcrypt (`BCRYPT_COST`, 12 por defecto), de 12 a 72 bytes. Mismo error genérico para correo desconocido y contraseña errónea. Límite de intentos en memoria: 5 fallos por IP + correo y 30 por IP cada 15 min (429).
- **CSRF**: `OriginGuard` rechaza peticiones que cambian datos si `Origin` no coincide con el host (o con `ALLOWED_ORIGINS`, separados por comas) o si `Sec-Fetch-Site` es cross-site. El proxy debe conservar `Host` (Nginx y el proxy de Vite lo hacen).
- **Registro cerrado**: los usuarios se crean solo con el script de administración, que pide la contraseña sin eco (o `USER_ADMIN_PASSWORD`); nunca la pases por chat ni la dejes en el historial.

```bash
cd backend
npm run user -- set-owner correo@dominio.com "Nombre"   # asigna correo y contraseña al usuario inicial
npm run user -- create correo@dominio.com "Nombre"
npm run user -- set-password correo@dominio.com
npm run user -- list
```

En la VM: `ssh -t … "cd /var/app/bookreader/current/backend && node --env-file=/var/app/bookreader/shared/api.env scripts/user-admin.js set-owner correo@dominio.com 'Nombre'"`.

`UserResolver` (`backend/src/auth/`) es el único punto que decide quién es el usuario de la petición; `users.external_id` está reservado para el `sub` de Amazon Cognito, al que se migrará (con una Lambda de migración de usuarios) antes de abrir el registro. Pendiente: quitar el valor por defecto de `summaries.user_id`.

## Pruebas

```bash
docker compose up -d
cd backend && npm run test:e2e   # usa la base bookreader_test; S3 está simulado
```

Cubren el aislamiento entre usuarios, la duración real de MP3 y M4A, el rechazo de archivos que no son audio, la búsqueda, el orden y las validaciones. **Entorno local y producción comparten el bucket S3**: al limpiar datos de prueba borra solo las claves concretas que creaste, nunca `audios/` completo.

## Infraestructura (`infra/`)

Terraform para AWS, independiente de cualquier otra app. El estado vive en el workspace `bookreader` de la organización `OCPData` en Terraform Cloud (modo de ejecución **Local**).

Crea: VPC `10.91.0.0/16`, una VM Ubuntu 24.04 `t3.small` con Elastic IP (Nginx, Node 20, servicio `bookreader-api`), una RDS MySQL 8.4 `db.t4g.micro` privada de 20 GB (sin escalado automático) y un rol de IAM con acceso mínimo al bucket de audios.

Red: los rangos se definen como variables de Actions (`VPC_CIDR`, `PUBLIC_SUBNET_CIDR`, `PRIVATE_SUBNET_1_CIDR`, `PRIVATE_SUBNET_2_CIDR`; hoy `10.91.x`) y no tienen valor por defecto. Terraform rechaza el plan si se solapan con NewPeople (`10.90.0.0/16`) o con la VPC por defecto (`172.31.0.0/16`), o si las subredes quedan fuera de la VPC o se solapan entre sí. **No los cambies una vez creada la red**: obligaría a reemplazar la VPC, las subredes y la VM.

Seguridad: SSH (22) y HTTPS (443) solo desde `allowed_cidr_blocks` (Terraform rechaza `0.0.0.0/0` ahí). El puerto 80 está abierto a Internet (`http_cidr_blocks`) únicamente porque Let's Encrypt valida y renueva por ahí; Nginx no sirve la aplicación en el 80, solo la validación y la redirección a HTTPS. La app se abrirá al público (443) cuando exista el login. Las variables van en un `terraform.tfvars` local (ver `terraform.tfvars.example`), que no se versiona.

## Despliegue (GitHub Actions, siempre manual)

Los dos workflows son `workflow_dispatch`: ninguno se ejecuta solo con un `push`. Se lanzan desde la pestaña **Actions**.

1. **`infra`**: Terraform sobre `infra/`. Ejecútalo primero con `apply=false`, revisa el plan en el resumen del job y luego con `apply=true`.
2. **`deploy`**: compila backend y frontend en GitHub, empaqueta un release, lo envía por SSH a la VM y lo activa (con migraciones de Prisma opcionales). El release queda en `/var/app/bookreader/releases/<id>`, `current` apunta al activo y se conservan los últimos 5. Si el healthcheck falla, vuelve al release anterior.

3. **`https`**: configura Let's Encrypt y Nginx para el dominio de `APP_DOMAIN` (hoy `audio.digitalvs.com`; el registro A debe apuntar a la IP de la VM). Orden: `https` con `stage=prepare` → `infra` con `apply=true` (abre el puerto 80) → `https` con `stage=issue`. La renovación es automática (`certbot.timer`). Después, define `APP_ORIGIN=https://<dominio>` y vuelve a ejecutar `deploy` para añadirlo al CORS del bucket.

Durante el despliegue, el workflow abre el puerto 22 solo a la IP del runner y lo cierra siempre al terminar, ya que el Security Group solo permite tu IP.

**Variables** (Settings → Secrets and variables → Actions → Variables): `AWS_REGION`, `TFC_ORG`, `TFC_WORKSPACE`, `INSTANCE_TYPE`, `ALLOWED_CIDR_BLOCKS` (JSON, ej. `["1.2.3.4/32"]`), `VPC_CIDR`, `PUBLIC_SUBNET_CIDR`, `PRIVATE_SUBNET_1_CIDR`, `PRIVATE_SUBNET_2_CIDR`, `DB_INSTANCE_CLASS`, `DB_ENGINE_VERSION`, `DB_ALLOCATED_STORAGE`, `DB_NAME`. `APP_DOMAIN` y `LETSENCRYPT_EMAIL` (workflow `https`). Opcionales: `S3_BUCKET` (por defecto `resumen-book-reader`) y `APP_ORIGIN` (dominio con HTTPS, se añade al CORS del bucket).

**Secrets:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `TFC_TOKEN`, `SSH_KEY_PEM`, `DB_USER`, `DB_PASSWORD`.

Las credenciales de AWS necesitan permisos para Terraform (VPC, EC2, RDS, IAM), para abrir y cerrar reglas del Security Group y para `s3:PutBucketCORS` sobre el bucket. Si falta este último, el despliegue termina con una advertencia y los audios no se podrán subir desde el navegador hasta ajustar el CORS.

