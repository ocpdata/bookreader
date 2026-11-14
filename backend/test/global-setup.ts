import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-config';

// Aplica las migraciones a la base de pruebas (Prisma la crea si no existe).
export default function globalSetup() {
  execSync('npx prisma migrate deploy', {
    cwd: `${__dirname}/..`,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, CHECKPOINT_DISABLE: '1' },
    stdio: 'pipe',
  });
}
