import { TEST_DATABASE_URL } from './test-config';

// Debe ejecutarse antes de importar la app: ConfigModule no pisa variables ya definidas.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.AWS_REGION = 'us-east-1';
process.env.S3_BUCKET = 'bucket-de-pruebas';
// Los tests ejecutan la purga a mano (PurgeService.run); el temporizador no debe correr.
process.env.PURGE_ENABLED = 'false';
