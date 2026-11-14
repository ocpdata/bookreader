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
| GET | `/api/summaries?search=&categoryId=` | Listar/buscar (solo `READY`; sin distinguir acentos) |
| GET | `/api/summaries/:id` | Consultar un resumen |
| POST | `/api/summaries` | Crear registro `PENDING` y obtener URL de carga |
| POST | `/api/summaries/:id/complete` | Verificar el objeto en S3 y marcar `READY` |
| PATCH | `/api/summaries/:id` | Editar título, autor, categoría y descripción |
| POST | `/api/summaries/:id/playback` | URL temporal de reproducción |

Formatos aceptados: MP3 y M4A, hasta 200 MB. Cada carga usa una clave nueva `audios/{uuid}/audio.ext`.
