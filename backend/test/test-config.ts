// Base de datos de pruebas: nunca la de desarrollo. Se puede cambiar con TEST_DATABASE_URL.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'mysql://root:bookreader@127.0.0.1:3307/bookreader_test';
