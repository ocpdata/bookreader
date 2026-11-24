# BookBrief

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

### Importar desde Google Drive (opcional)

En un proyecto de Google Cloud habilita Google Drive API y Google Picker API, configura la pantalla de consentimiento y crea un cliente OAuth de tipo aplicación web con los orígenes autorizados de BookBrief. Crea una clave de API para Picker restringida a la API y a los orígenes necesarios (incluido `https://docs.google.com/*`, según la documentación de Google). Copia `frontend/.env.example` a `frontend/.env.local` y configura `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_PICKER_API_KEY` y `VITE_GOOGLE_PROJECT_NUMBER`. Son valores públicos del cliente y Vite los incorpora al compilar: no pongas secretos en estas variables. Reinicia Vite o recompila el frontend después de configurarlos.

La integración aparece solo si están configurados los tres valores. El usuario prepara el selector, autoriza el permiso `drive.file` y elige sus archivos. La aplicación no usa Google para iniciar sesión, no solicita acceso a toda la unidad y solo lee los archivos seleccionados. Google puede exigir verificación de la aplicación antes de publicarla; durante las pruebas hay que configurar los usuarios de prueba correspondientes.

Cada archivo se lee desde Drive para calcular su huella y comprobar duplicados; al confirmar se lee nuevamente y se copia a S3, donde se valida su tamaño, huella y contenido. Si el archivo cambia o se revoca el acceso, la importación falla y se puede reintentar. La copia consume cuota, no sincroniza cambios posteriores y eliminarla no afecta el original de Drive. Mantén la página abierta: no hay trabajos de importación persistentes y no se guardan tokens de Google. Al regresar se deben seleccionar nuevamente los archivos pendientes; se puede revocar el permiso desde el botón de desconexión o desde la cuenta de Google. Una operación ya iniciada podría terminar aunque se cierre la página. Las cargas fallidas o canceladas siguen sujetas a la reserva y limpieza de pendientes.

En la VM hay que actualizar la configuración Nginx generada por `scripts/setup_https.sh`: las dos rutas de Drive necesitan un plazo de espera mayor porque pueden leer hasta 200 MB.

## API

| Método | Endpoint | Función |
| --- | --- | --- |
| GET | `/api/categories` | Listar categorías predeterminadas y propias (`isCustom` identifica las propias) |
| POST | `/api/categories` | Crear categoría privada con `name` |
| DELETE | `/api/categories/:id` | Eliminar una categoría propia sin audios asociados |
| GET | `/api/summaries` | Listar/buscar los audios del usuario (solo `READY`; sin distinguir acentos ni mayúsculas). Parámetros: `search` (título, autor, título del resumen o etiqueta), `categoryId`, `folderId` (id o `root` = sin carpeta) con `includeSubfolders=true`, `tag`, `favorite=true`, `status=finished\|unfinished`, `sort=recent\|title\|duration\|listened` |
| GET | `/api/summaries/:id` | Consultar un resumen |
| POST | `/api/summaries` | Crear registro `PENDING` y obtener URL de carga |
| POST | `/api/summaries/:id/complete` | Verificar el objeto en S3, leer su duración real (rechaza archivos que no son audio) y marcar `READY` |
| POST | `/api/summaries/drive/inspect` | Leer un archivo seleccionado de Google Drive y calcular su huella |
| POST | `/api/summaries/:id/drive-import` | Copiar el archivo seleccionado a la reserva del usuario y completarla |
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
| GET / POST / DELETE | `/api/summaries/:id/cover` | Descargar la portada (JPEG) / subir o reemplazar (multipart, campo `file`, hasta 1 MB) / quitarla |
| POST | `/api/summaries/:id/cover/from-audio` | Usar la portada incrustada en el propio archivo de audio |
| GET / POST | `/api/folders` | Listar las carpetas del usuario (plana, con `parentId` y `count` de audios directos) / crear una (`name`, `parentId` opcional) |
| PATCH / DELETE | `/api/folders/:id` | Renombrar o mover (`name`, `parentId`; `null` = raíz) / eliminar |
| POST | `/api/summaries/move` | Mover varios audios (`ids` hasta 100, `folderId` o `null`); todo o nada |
| GET | `/api/health` | Estado de la API y de la base de datos |

Formatos aceptados: MP3 y M4A, hasta 200 MB. Cada carga usa una clave nueva `audios/{userId}/{uuid}/audio.ext`.

## Progreso de reproducción

Cada usuario tiene su posición en cada audio (`playback_progress`); la lista y la ficha la devuelven en `progress`. El reproductor guarda cada 10 s mientras suena y al pausar, saltar, terminar o salir de la pantalla. Reglas: al reabrir retoma desde la posición guardada, salvo que el audio esté terminado (entonces empieza de cero); se marca **terminado** al llegar al 95 % o al final, se mantiene hasta que se cambie a mano ("Marcar como pendiente") y "Reiniciar" borra el progreso.

## Pantallas

### Compartir entre cuentas

La función está **desactivada por defecto**. Para habilitarla, configura `SHARING_ENABLED=true` en el entorno del backend; en producción, usa la variable de GitHub del mismo nombre y despliega. Revisa antes los términos, el aviso de privacidad y los derechos de distribución con asesoría legal.

Desde `/invitaciones`, la biblioteca o la ficha de un audio se puede invitar por correo a escuchar toda la biblioteca (incluye audios futuros) o una selección fija de hasta 200 audios propios. La invitación vence a los siete días y puede reenviarse. La persona puede registrarse después de recibirla, pero debe verificar el mismo correo y aceptarla antes de escuchar. El enlace del correo no concede acceso por sí solo. `/compartidos` muestra lo recibido; la cuenta mantiene progreso y favoritos propios, incluso después de vencer la prueba. El almacenamiento se cobra solo al propietario.

El propietario puede revocar cada permiso; si hay varios permisos sobre un audio, el acceso continúa mientras alguno esté vigente. Los audios en papelera dejan de estar disponibles y vuelven al restaurarlos si hay un permiso válido. Solo el propietario puede editar o eliminar; los compartidos no se muestran en las apps Audiobookshelf. Las etiquetas y categorías privadas no se muestran al destinatario. Al revocar se impiden nuevas solicitudes, pero no se pueden retirar copias ya descargadas ni garantizar cortar una transferencia en curso.

La reproducción compartida pasa por la API con comprobación de permisos y soporte de rangos; las portadas web no se guardan en caché. Los correos fallidos se notifican al remitente. El servicio limita invitaciones y reenvíos; limpia las invitaciones vencidas, rechazadas o revocadas y los registros de envío después de 30 días. Desactivar la función suspende el acceso compartido, pero permite consultar, rechazar y revocar invitaciones.

Rutas bajo `/api`, con sesión:

- `POST /shares`: `{email, scope: 'LIBRARY' | 'ITEMS', summaryIds?: string[]}`; `summaryIds` se envía solo para `ITEMS`, con al menos un audio propio.
- `GET /shares/config`: `{enabled: boolean}`, controlado por `SHARING_ENABLED` en backend (deshabilitado por defecto).
- `GET /shares/sent` y `GET /shares/received`: `Share[]`.
- `POST /shares/:id/accept`, `POST /shares/:id/reject`, `DELETE /shares/:id`: aceptar, rechazar y revocar.
- `POST /shares/:id/resend`: reenviar una invitación pendiente y renovar su vencimiento.
- `GET /shares/items`: `Summary[]` accesibles para el destinatario.
- `Share` incluye destinatario, propietario, ámbito, estado, fechas y selección; en una invitación vigente también incluye los títulos y autores disponibles de la selección.
- Los audios compartidos incluyen `isOwner=false` y `ownerName`; los propios incluyen `isOwner=true` en su ficha.

Validación frontend: `cd frontend && node --test tests/sharing-api.test.mjs && npm run build`. Las pruebas de API usan Vite ya instalado; no requieren nuevas dependencias.

`/` es el **inicio**: continuar escuchando (empezados y no terminados, el último escuchado primero), agregados recientemente, favoritos (el marcado más reciente primero) y categorías con su conteo, más una búsqueda que lleva a la biblioteca. `/biblioteca` es la lista completa con búsqueda, filtros y orden. `/papelera` lista lo eliminado. Luego están la ficha con el reproductor (`/audios/:id`) y el formulario de alta y edición (`/audios/nuevo`, `/audios/:id/editar`).

En la biblioteca se puede elegir entre lista y cuadrícula; la preferencia se guarda en el navegador. Los filtros activos se pueden quitar individualmente y las acciones de edición, movimiento y eliminación están en el menú de cada audio.

En Inicio y en la biblioteca, las tarjetas muestran hasta tres líneas de la descripción y permiten expandirla cuando no cabe completa.

Al subir o editar un audio, «Buscar información en OpenLibrary.org» abre una búsqueda de título y autor en otra pestaña. La consulta y la dirección IP se envían a ese servicio solo al abrirla; BookBrief no copia información ni portadas de los resultados. La portada manual o incrustada sigue disponible.

Desde «Agregar resumen» se puede elegir «Subir varios audios». Cada archivo crea un resumen independiente: se revisan título, autor, categoría y carpeta y se comprueban posibles duplicados antes de subir. Los archivos idénticos se detectan por SHA-256; una coincidencia de título y autor solo indica un posible duplicado. Se comparan únicamente audios de la cuenta, también en la papelera, y el usuario decide si continúa. Si quedan audios antiguos sin huella se avisa de que la comprobación exacta está incompleta.

El lote se sube de uno en uno. Su estado se guarda en el navegador por cuenta, pero los archivos no: al volver a la página hay que seleccionar de nuevo los pendientes. Un identificador por archivo permite recuperar una carga interrumpida sin crear otro resumen. Las cargas canceladas siguen reservando cuota hasta que se ejecute la limpieza de pendientes: no antes de 24 horas desde la última URL de carga y solo si la purga está habilitada.

Las categorías predeterminadas son compartidas. Cada usuario puede crear categorías privadas desde la biblioteca o el formulario de audio y eliminar las suyas si no tienen audios asociados, incluidos los pendientes y los de la papelera. Los nombres se comparan sin distinguir mayúsculas ni acentos; no se permiten duplicados frente a las categorías visibles del usuario.

## Papelera y limpieza

"Eliminar" mueve el audio a la papelera: deja de verse y reproducirse, pero conserva su fila, su archivo de S3, sus etiquetas, favorito y progreso, así que **restaurar** lo devuelve intacto (la interfaz ofrece "Deshacer"). Se borra de forma definitiva desde `/papelera` (con confirmación), al vaciarla, o automáticamente a los 30 días (`TRASH_RETENTION_DAYS`).

Un proceso interno (`PurgeService`, cada 6 horas) borra la papelera vencida y las cargas que nunca se completaron en 24 h; se desactiva con `PURGE_ENABLED=false` (en desarrollo local conviene dejarlo apagado). Salvaguardas: siempre se borra primero el archivo y después la fila (si S3 falla, la fila se conserva y se reintenta); el servidor solo borra la clave exacta guardada en la fila y solo si tiene la forma `audios/{userId}/{uuid}/audio.mp3|m4a` (o el formato anterior sin usuario); cada ejecución procesa como máximo 100 filas; un audio vivo nunca se purga. El rol de IAM de la VM necesita `s3:DeleteObject` sobre `audios/*` (definido en `infra/`).

## Apps compatibles con Audiobookshelf

BookBrief habla la API de Audiobookshelf (ABS) para que apps como **Absorb** (Android/iOS) y **AudioBooth** (iOS) puedan escuchar la biblioteca. En la app: servidor `https://audio.digitalvs.com`, usuario = el correo de la cuenta y la misma contraseña de la web. Se desactiva con `ABS_COMPAT_ENABLED=false`.

- **Qué funciona**: una biblioteca "Resúmenes" con todos los audios del usuario (lista con orden, paginación y filtros por progreso, género=categoría, etiqueta, autor y narrador), detalle, búsqueda, inicio (continuar escuchando, agregados recientemente, escuchar de nuevo), autores y narradores, portadas, reproducción con progreso sincronizado con la web (sesiones `sync`/`close`, `PATCH /api/me/progress`, progreso grabado sin conexión) y ocultar de "continuar escuchando". Los **marcadores** se guardan por usuario y audio (se identifican por su posición, hasta 200 por audio) y viajan también en el objeto de usuario. Las **carpetas con audios** se ofrecen como colecciones de solo lectura (nombre = ruta completa, con sus audios directos). Las **descargas sin conexión** usan `GET /api/items/:id/file/:ino[/download]` (Bearer o `?token=`, con `Range` y `HEAD`; el `ino` sale de las pistas del detalle) y lo escuchado sin conexión se sincroniza. Las series y las listas de reproducción se devuelven vacías, y el historial y las estadísticas también. Las apps son de solo lectura: editar, borrar y subir se hace en la web (los permisos `update`, `delete` y `upload` van en `false`).
- **Rutas**: viven en la raíz (`/ping`, `/status`, `/login`, `/logout`, `/public/session/...`) y bajo `/api` (`/api/libraries`, `/api/items`, `/api/me`, `/api/session`...), por eso la pantalla web de acceso pasó a `/entrar` (`GET /login` redirige).
- **Versión anunciada**: `2.22.0`, el mínimo desde el que las apps usan la URL de audio pública por sesión.
- **Seguridad**: `POST /login` devuelve un token opaco por dispositivo (`brt_...`, solo se guarda su hash; hasta 20 por usuario) que se envía como `Authorization: Bearer`. **Solo vale en las rutas de las apps**: la API web (`/api/summaries`, `/api/folders`...) lo rechaza con 403. `?token=` se acepta únicamente en `GET`/`HEAD` de `/api/items/:id/cover` y `/api/items/:id/file/:ino[/download]`. Cerrar sesión desde la app y cambiar la contraseña revocan los tokens. El audio se sirve en `GET /public/session/:id/track/1` sin cabeceras: el id aleatorio de la sesión de reproducción (caduca a los 7 días sin uso) es el secreto; se transmite desde S3 con soporte de `Range` (206/416) y deja de servir si el audio pasa a la papelera.
- **Progreso**: `sync`/`close` aplican la regla del 95 % (terminado). Un `isFinished: false` con la posición ya al final no anula el estado; con una posición anterior sí lo reinicia. El progreso sin conexión solo se aplica si es más reciente que el guardado.
- **Dispositivos**: en `/cuenta` → "Apps vinculadas" se ven las apps que iniciaron sesión (`GET /api/auth/devices`, solo con la sesión web) y se pueden quitar una a una o todas (`DELETE /api/auth/devices[/:id]`); la app afectada pierde el acceso de inmediato.
- **Nginx** (`scripts/setup_https.sh`, workflow `https` con `stage=prepare`): enruta esas rutas a la API, desactiva el búfer en `/public/session/` y en las descargas de archivos, limita los accesos (10/min por IP, `/login` y `/api/auth/login`) y registra los accesos sin la query (`?token=`) ni los ids de sesión.
- **Pruebas**: `backend/test/abs.e2e-spec.ts` valida la forma de las respuestas contra los modelos de las apps (fechas en milisegundos enteros, campos obligatorios) y los flujos completos. La verificación final con una app real se hace en el móvil.

## Portadas

Cada resumen puede tener una portada. Al completar la carga se toma la portada incrustada en el MP3/M4A (si la trae) y, desde la edición, se puede subir otra, usar la del audio o quitarla. El servidor valida el contenido real (JPEG, PNG o WebP; rechaza SVG, GIF y cualquier otra cosa), la recodifica a un JPEG de hasta 800 px sin metadatos (EXIF/GPS) y la guarda como `cover-{8 hex}.jpg` junto al audio (`summaries.cover_key`), así que el rol de IAM no cambia. Cada carga usa una clave nueva: la URL (`?v=`) cambia y la anterior se borra. La API web indica que la portada no se almacene en caché, para respetar los cambios de acceso. El borrado definitivo elimina audio y portada.

El navegador reduce la imagen antes de subirla (800 px, JPEG) porque Nginx admite 1 MB por petición por defecto (`client_max_body_size`); el servidor aplica el mismo tope. Sin portada se muestra la inicial del título sobre un color. La portada también se envía a la pantalla de bloqueo (Media Session).

## Carpetas

Cada usuario organiza sus audios en carpetas anidadas (hasta 5 niveles y 200 carpetas). Un audio está en **una sola** carpeta (`summaries.folder_id`; nulo = raíz) y las etiquetas y la categoría siguen sirviendo para agrupar de otras formas. El nombre es único entre carpetas hermanas (sin distinguir mayúsculas ni acentos). Una carpeta ajena responde 404.

- **Mover**: una carpeta no puede ir dentro de sí misma ni de sus subcarpetas, ni superar los 5 niveles. Los audios se mueven uno a uno (`PATCH /api/summaries/:id` con `folderId`) o en lote (`POST /api/summaries/move`).
- **Eliminar una carpeta** no borra nada: sus audios (también los de la papelera) y subcarpetas suben a la carpeta padre; una subcarpeta cuyo nombre ya existe arriba se renombra "X (2)". Restaurar un audio de la papelera lo deja en su carpeta (o en la que heredó).
- **Concurrencia**: las escrituras de carpetas de un usuario se serializan con un bloqueo sobre su fila (`FoldersService`), así que nombre único, ciclos, profundidad y tope no compiten entre peticiones.
- **Interfaz**: `/biblioteca?carpeta=<id>` navega por carpetas con migas de pan; con búsqueda o filtros se mira toda la biblioteca y cada audio muestra su ruta.

## Etiquetas y favoritos

Las etiquetas son libres y de cada usuario (hasta 10 por audio, 50 caracteres). MySQL las compara sin distinguir mayúsculas ni acentos, así que "Ventas" y "ventas" son la misma etiqueta y se conserva la primera grafía. Al quitar la última referencia a una etiqueta, esta desaparece de las sugerencias. Los favoritos también son por usuario. La biblioteca filtra por etiqueta, favoritos, estado (terminados o pendientes), categoría y texto, y ordena por fecha, título, duración o última escucha; filtros y orden viven en la URL.

## Usuarios y acceso

Cada audio pertenece a un usuario; solo su propietario puede modificarlo y un audio ajeno sin permiso responde 404. Toda la API exige sesión salvo las rutas públicas de salud y autenticación.

- **Sesiones en servidor**: el login (`POST /api/auth/login`, correo + contraseña) crea una fila en `sessions` y entrega la cookie `br_session` (`HttpOnly`, `SameSite=Lax`, `Secure` si `NODE_ENV=production` o `COOKIE_SECURE=true`). La BD guarda solo el hash SHA-256 del token. Caducan a los 30 días de inactividad (se renuevan como máximo una vez al día) y las vencidas se limpian cada hora. `GET /api/auth/me` devuelve el usuario; `POST /api/auth/password` cambia la contraseña y cierra las demás sesiones (contraseña actual errónea → 400).
- **Contraseñas**: bcrypt (`BCRYPT_COST`, 12 por defecto), de 12 a 72 bytes. Mismo error genérico para correo desconocido y contraseña errónea. Límite de intentos en memoria: 5 fallos por IP + correo y 30 por IP cada 15 min (429).
- **CSRF**: `OriginGuard` rechaza peticiones que cambian datos si `Origin` no coincide con el host (o con `ALLOWED_ORIGINS`, separados por comas) o si `Sec-Fetch-Site` es cross-site. El proxy debe conservar `Host` (Nginx y el proxy de Vite lo hacen).
- **Registro con correo y contraseña** (`REGISTRATION_MODE`: `closed` por defecto, `invite` o `open`; variable de GitHub del mismo nombre, que el despliegue copia a la VM):
  - `POST /api/auth/register` (nombre, correo, contraseña, aceptar términos y, en `invite`, el código). Crea la cuenta **pendiente** y envía por correo un enlace de verificación (24 h); hasta verificarla no se puede entrar (ni en la web ni en las apps). `POST /api/auth/verify-email` canjea el enlace (la pantalla `/verificar` lo hace con un POST: un escáner de enlaces no lo gasta). `POST /api/auth/resend-verification` reenvía.
  - `POST /api/auth/forgot-password` y `POST /api/auth/reset-password` (enlace de 1 h, de un solo uso): al restablecer se cierran todas las sesiones y las apps vinculadas, la cuenta queda verificada y se avisa por correo. Cambiar la contraseña desde la cuenta también avisa por correo.
  - **Sin enumeración**: el registro, el reenvío y "olvidé mi contraseña" responden siempre lo mismo; es el correo el que dice qué pasó (cuenta existente, enlace nuevo...). Una cuenta pendiente que se vuelve a registrar recibe un enlace nuevo, pero su contraseña **no se pisa** (si no, quien se adelantara se quedaría con la cuenta que la persona verifica).
  - **Límites**: registro 10/h por IP; reenvío y "olvidé" 10/h por IP; como máximo 3 correos por hora a una misma dirección (se omiten en silencio); Nginx limita además estas rutas por IP. Las contraseñas comunes, o que contienen el correo o el nombre, se rechazan. Las cuentas pendientes de más de 7 días se borran.
  - Los enlaces y las invitaciones se guardan solo como hash SHA-256. Se acepta una versión de términos (`TERMS_VERSION`) que queda registrada.
  - **Invitaciones** (`invite`): `user-admin.js invite [--email x] [--uses n] [--days n] [--note ...]` crea un código `BR-XXXX-XXXX-XXXX` que se muestra una sola vez; se consume de forma atómica al crear la cuenta.
  - **Correo**: `MailService` envía por Amazon SES en producción (`MAIL_DRIVER=ses`, `MAIL_FROM`, `SES_CONFIGURATION_SET`, `APP_PUBLIC_URL`); en desarrollo y pruebas solo registra el mensaje (el enlace sale en la consola del backend). `scripts/mail-test.js <correo>` prueba el envío en la VM. Mientras SES esté en modo de pruebas solo escribe a direcciones verificadas.
- **Cuotas por usuario**: almacenamiento (2 GB por defecto, `DEFAULT_STORAGE_LIMIT_BYTES`) y número de audios (500, `DEFAULT_MAX_AUDIOS`); cada cuenta puede tener los suyos con `user-admin.js set-quota <correo> [--gb n] [--audios n] [--reset]` (`users.storage_limit_bytes` y `max_audios`). Cuentan **todas** las filas del usuario: lo subido, las cargas pendientes (reservan su espacio) y la papelera (su archivo sigue en S3 hasta el borrado definitivo); las portadas (JPEG de hasta 800 px) no se descuentan. La comprobación y el alta van juntas bajo un bloqueo sobre la fila del usuario (`QuotaService.reserve`), así que cargas simultáneas no pueden superarla; al excederla `POST /api/summaries` responde 413 con `code` `QUOTA_STORAGE` o `QUOTA_AUDIOS`. `GET /api/usage` devuelve el uso (también la parte en papelera); `/cuenta` lo muestra y el formulario de alta avisa antes de subir un archivo que no cabe.
- **Huellas de audio**: al completar una carga se calcula SHA-256 leyendo el archivo de S3. Las cargas recuperables incluyen esa huella en la URL firmada y se verifica antes de marcar el audio como listo. La validación también lee el archivo de S3 y puede necesitar una segunda lectura para M4A fragmentados; permite hasta 15 minutos en total y cancela si no recibe datos durante 45 segundos. Un fallo de lectura permite reintentar sin declarar inválido el archivo. Un proceso en segundo plano calcula hasta 10 huellas antiguas cada 15 minutos, sin modificar los archivos; se puede desactivar con `HASH_BACKFILL_ENABLED=false` y también se detiene si `PURGE_ENABLED=false`. Los fallos se registran y se reintentan.
- **Eliminar la cuenta** (derecho de cancelación): `DELETE /api/auth/account` con la contraseña (solo sesión web; un token de dispositivo recibe 403; la contraseña mala es un 400, y se limita como el acceso). `AccountEraser` borra primero **todos los archivos de S3** de la cuenta (audios, portadas, también los de la papelera y las cargas pendientes) con `DeleteObjects` por lotes y la misma lista de claves permitidas que el borrado normal, y después las filas (carpetas anidadas incluidas), sesiones y apps vinculadas. Si S3 no puede borrar algo, se conserva la cuenta con lo que falta (502) y se puede reintentar. La cuenta propietaria no se puede eliminar desde la web. Se envía un correo de confirmación. El bucket tiene versionado: las copias técnicas tardan hasta 14 días en desaparecer (se dice en el aviso de privacidad).
- **Términos y privacidad**: al registrarse se guarda la versión aceptada (`TERMS_VERSION` en `registration.config.ts`; súbela cuando cambien los textos). `GET /api/auth/me` y el login devuelven `needsTerms`; si es verdadero, la web bloquea con un diálogo hasta que se acepta (`POST /api/auth/accept-terms`). Las cuentas anteriores al registro (y las creadas por CLI) lo ven en su primer acceso. Las apps compatibles no lo exigen.
- **Retiro de contenido** (reclamaciones de derechos): desde la VM, `user-admin.js audios <correo>` lista los audios con su id, `remove-audio <id> --reason "..."` elimina uno al instante (archivo, portada y fila, sin papelera ni posibilidad de restaurarlo), `suspend <correo>` bloquea una cuenta reincidente y `delete-user <correo> --confirm` la elimina con todo. Estos comandos usan el código compilado (`dist/`), con las mismas salvaguardas que la aplicación; avisa a la persona por correo manualmente. El contacto para reclamaciones es el de los términos (`/terminos`).
- **Administración**: el script crea cuentas ya verificadas, suspende (`suspend` cierra sus sesiones y apps; no entra ni recibe correos) y reactiva, y gestiona invitaciones; pide la contraseña sin eco (o `USER_ADMIN_PASSWORD`); nunca la pases por chat ni la dejes en el historial.
- **Administradores**: la migración asigna `ADMIN` al propietario existente; los registros nuevos tienen `USER`. En Administración, los administradores activos pueden listar las cuentas; solo el propietario puede nombrar o retirar administradores, confirmando con su contraseña. No se puede cambiar el rol ni suspender o eliminar al propietario. Los cambios de rol se registran en `admin_role_changes` con identificadores de actor y cuenta, roles y fecha; no contienen contraseñas y se borran al eliminar cualquiera de las cuentas. Los permisos se comprueban en el servidor y los tokens de dispositivo no sirven para administrar.
- **Acceso inicial y recuperación**: el propietario no recibe una contraseña predeterminada. Se le asignan correo y contraseña con `set-owner`; si ya tiene correo, debe ser el mismo. Para recuperar el acceso se puede usar `set-password` con ese correo desde la VM. Ambos comandos cierran las sesiones y apps vinculadas del propietario cuando cambian su contraseña.

```bash
cd backend
npm run user -- set-owner correo@dominio.com "Nombre"   # asigna correo y contraseña al usuario inicial
npm run user -- create correo@dominio.com "Nombre"
npm run user -- set-password correo@dominio.com
npm run user -- list
npm run user -- suspend correo@dominio.com               # y: activate
npm run user -- invite --email correo@dominio.com --uses 1 --days 14 --note "para Ana"
npm run user -- invitations
npm run user -- audios correo@dominio.com                # y: remove-audio <id> --reason "..." · delete-user correo --confirm
```

En la VM: `ssh -t … "cd /var/app/bookreader/current/backend && node --env-file=/var/app/bookreader/shared/api.env scripts/user-admin.js set-owner correo@dominio.com 'Nombre'"`.

`UserResolver` (`backend/src/auth/`) es el único punto que decide quién es el usuario de la petición; `users.external_id` está reservado para el `sub` de Amazon Cognito, al que se podrá migrar después (con una Lambda de migración de usuarios): se conserva el hash bcrypt y `email_verified_at` expresa lo mismo que `email_verified` de Cognito. Pendiente: quitar el valor por defecto de `summaries.user_id`. Los términos y el aviso de privacidad (`/terminos`, `/privacidad`) no han pasado por revisión legal.

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

Seguridad: SSH (22) solo desde `allowed_cidr_blocks` (Terraform rechaza `0.0.0.0/0` ahí). HTTPS (443) está abierto a Internet (`https_cidr_blocks`, por defecto `0.0.0.0/0`) para que la web y las apps móviles funcionen fuera de casa; para cerrarlo, pon tu IP en esa variable. Lo protegen el login (sesión o token por dispositivo revocable), el límite de intentos de acceso en Nginx y en la API, las cabeceras de seguridad (HSTS, `nosniff`, `X-Frame-Options`) y un registro de accesos sin `?token=` ni ids de sesión. El puerto 80 está abierto a Internet (`http_cidr_blocks`) únicamente porque Let's Encrypt valida y renueva por ahí; Nginx no sirve la aplicación en el 80, solo la validación y la redirección a HTTPS. Las variables van en un `terraform.tfvars` local (ver `terraform.tfvars.example`), que no se versiona.

## Despliegue (GitHub Actions, siempre manual)

Los dos workflows son `workflow_dispatch`: ninguno se ejecuta solo con un `push`. Se lanzan desde la pestaña **Actions**.

1. **`infra`**: Terraform sobre `infra/`. Ejecútalo primero con `apply=false`, revisa el plan en el resumen del job y luego con `apply=true`.
2. **`deploy`**: compila backend y frontend en GitHub, empaqueta un release, lo envía por SSH a la VM y lo activa (con migraciones de Prisma opcionales). El release queda en `/var/app/bookreader/releases/<id>`, `current` apunta al activo y se conservan los últimos 5. Si el healthcheck falla, vuelve al release anterior cuando es compatible. El rollback a una versión anterior a las categorías privadas o a la compartición se bloquea y se detiene el servicio para evitar exponer datos; hay que desplegar una versión compatible.

3. **`https`**: configura Let's Encrypt y Nginx para el dominio de `APP_DOMAIN` (hoy `audio.digitalvs.com`; el registro A debe apuntar a la IP de la VM). Orden: `https` con `stage=prepare` → `infra` con `apply=true` (abre el puerto 80) → `https` con `stage=issue`. La renovación es automática (`certbot.timer`). Después, define `APP_ORIGIN=https://<dominio>` y vuelve a ejecutar `deploy` para añadirlo al CORS del bucket.

Durante el despliegue, el workflow abre el puerto 22 solo a la IP del runner y lo cierra siempre al terminar, ya que el Security Group solo permite tu IP.

**Protección y monitoreo** (`infra/monitoring.tf`):
- **S3**: el bucket tiene versionado y las versiones anteriores o borradas se eliminan a los 14 días (`noncurrent_version_days`). Un borrado por error se recupera con `aws s3api list-object-versions` y `get-object --version-id` (o quitando el marcador de borrado). Un borrado definitivo desde la app deja por tanto una copia recuperable durante esos 14 días.
- **Alarmas** (SNS por correo; la suscripción se confirma una vez desde el enlace del correo): la VM falla los chequeos de AWS, a la base le quedan menos de 4 GiB y la web deja de responder (chequeo HTTPS externo de Route 53 a `/api/health`, que también consulta la base).
- **Presupuesto**: aviso al 80 % real y al 100 % previsto del gasto mensual **de toda la cuenta AWS** (`MONTHLY_BUDGET_USD`, 25 por defecto).
- Solo se crean si existe la variable `ALERT_EMAIL`.
- **Copias de la base**: RDS conserva 7 días de copias automáticas. La restauración se probó (punto en el tiempo a una instancia temporal en la misma VPC, comparación de datos y borrado): `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier bookreader-mysql --target-db-instance-identifier <temporal> --use-latest-restorable-time --db-instance-class db.t4g.micro --db-subnet-group-name bookreader-db --vpc-security-group-ids <sg de la base> --no-publicly-accessible --no-deletion-protection`; desde la VM se compara con producción y la instancia temporal se borra.

**Variables** (Settings → Secrets and variables → Actions → Variables): `AWS_REGION`, `TFC_ORG`, `TFC_WORKSPACE`, `INSTANCE_TYPE`, `ALLOWED_CIDR_BLOCKS` (JSON, ej. `["1.2.3.4/32"]`), `VPC_CIDR`, `PUBLIC_SUBNET_CIDR`, `PRIVATE_SUBNET_1_CIDR`, `PRIVATE_SUBNET_2_CIDR`, `DB_INSTANCE_CLASS`, `DB_ENGINE_VERSION`, `DB_ALLOCATED_STORAGE`, `DB_NAME`. `APP_DOMAIN` y `LETSENCRYPT_EMAIL` (workflow `https`). Opcionales: `ALERT_EMAIL` y `MONTHLY_BUDGET_USD` (alarmas y presupuesto), `S3_BUCKET` (por defecto `resumen-book-reader`) y `APP_ORIGIN` (dominio con HTTPS, se añade al CORS del bucket).

**Secrets:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `TFC_TOKEN`, `SSH_KEY_PEM`, `DB_USER`, `DB_PASSWORD`.

Las credenciales de AWS necesitan permisos para Terraform (VPC, EC2, RDS, IAM), para abrir y cerrar reglas del Security Group y para `s3:PutBucketCORS` sobre el bucket. Si falta este último, el despliegue termina con una advertencia y los audios no se podrán subir desde el navegador hasta ajustar el CORS.

