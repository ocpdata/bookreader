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
| GET | `/api/summaries?search=&categoryId=&sort=` | Listar/buscar los audios del usuario (solo `READY`; sin distinguir acentos; `sort` = `recent`, `title` o `duration`) |
| GET | `/api/summaries/:id` | Consultar un resumen |
| POST | `/api/summaries` | Crear registro `PENDING` y obtener URL de carga |
| POST | `/api/summaries/:id/complete` | Verificar el objeto en S3, leer su duración real (rechaza archivos que no son audio) y marcar `READY` |
| PATCH | `/api/summaries/:id` | Editar título, autor, título del resumen, narrador, categoría y descripción |
| POST | `/api/summaries/:id/playback` | URL temporal de reproducción |
| GET | `/api/health` | Estado de la API y de la base de datos |

Formatos aceptados: MP3 y M4A, hasta 200 MB. Cada carga usa una clave nueva `audios/{userId}/{uuid}/audio.ext`.

## Usuarios

Cada audio pertenece a un usuario y todas las consultas se filtran por él; un audio ajeno responde 404. Hasta que exista el login hay un único usuario fijo (`DEFAULT_USER_ID`, creado en la migración). Para implementar el login solo hay que reemplazar `SingleUserResolver` (`backend/src/auth/`), el único punto que decide quién es el usuario de la petición, y quitar el valor por defecto de `summaries.user_id`.

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

