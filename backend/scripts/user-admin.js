#!/usr/bin/env node
/**
 * Administración de usuarios. El registro está cerrado: los usuarios se crean solo con este comando.
 *
 *   node scripts/user-admin.js set-owner <correo> "<nombre>"   Reclama el usuario propietario existente
 *   node scripts/user-admin.js create <correo> "<nombre>"      Crea un usuario nuevo
 *   node scripts/user-admin.js set-password <correo>           Cambia la contraseña de un usuario
 *   node scripts/user-admin.js list                            Lista los usuarios
 *
 * La contraseña se pide por teclado (sin mostrarla); no se admite como argumento para que no quede en
 * el historial. Para automatizar, USER_ADMIN_PASSWORD la toma del entorno.
 * En la VM:  node --env-file=/var/app/bookreader/shared/api.env scripts/user-admin.js ...
 */
const readline = require('node:readline');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const MIN_LENGTH = 12;
const MAX_BYTES = 72;
const cost = Number(process.env.BCRYPT_COST) > 0 ? Number(process.env.BCRYPT_COST) : 12;
const prisma = new PrismaClient();

const fail = (message) => {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
};

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => rl.output.write(muted ? '' : text);
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function readPassword() {
  if (process.env.USER_ADMIN_PASSWORD) return process.env.USER_ADMIN_PASSWORD;
  const first = await askHidden('Contraseña nueva: ');
  const second = await askHidden('Repite la contraseña: ');
  if (first !== second) throw new Error('Las contraseñas no coinciden');
  return first;
}

function assertPassword(password) {
  if (password.length < MIN_LENGTH) throw new Error(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres`);
  if (Buffer.byteLength(password, 'utf8') > MAX_BYTES) throw new Error(`La contraseña no puede superar ${MAX_BYTES} bytes`);
}

function normalizeEmail(raw) {
  const email = (raw ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) throw new Error('Correo no válido');
  return email;
}

async function passwordHash() {
  const password = await readPassword();
  assertPassword(password);
  return bcrypt.hash(password, cost);
}

const commands = {
  async 'set-owner'(emailArg, name) {
    const email = normalizeEmail(emailArg);
    const owner = await prisma.user.findUnique({ where: { id: OWNER_ID } });
    if (!owner) throw new Error('No existe el usuario propietario (¿se aplicaron las migraciones?)');
    if (owner.email && owner.email !== email) throw new Error(`El propietario ya tiene el correo ${owner.email}`);
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken && taken.id !== OWNER_ID) throw new Error('Ese correo ya pertenece a otro usuario');
    await prisma.user.update({
      where: { id: OWNER_ID },
      data: { email, name: name?.trim() || owner.name, passwordHash: await passwordHash() },
    });
    console.log(`Propietario listo: ${email} (conserva todos sus audios).`);
  },

  async create(emailArg, name) {
    const email = normalizeEmail(emailArg);
    if (!name?.trim()) throw new Error('Indica el nombre: create <correo> "<nombre>"');
    if (await prisma.user.findUnique({ where: { email } })) throw new Error('Ese correo ya existe');
    const user = await prisma.user.create({ data: { email, name: name.trim(), passwordHash: await passwordHash() } });
    console.log(`Usuario creado: ${email} (${user.id})`);
  },

  async 'set-password'(emailArg) {
    const email = normalizeEmail(emailArg);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('No existe ese usuario');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await passwordHash() } });
    // Una contraseña nueva invalida las sesiones abiertas.
    await prisma.session.deleteMany({ where: { userId: user.id } });
    console.log(`Contraseña actualizada para ${email}; se cerraron sus sesiones.`);
  },

  async list() {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    for (const u of users) {
      console.log(`${u.id}  ${u.email ?? '(sin correo)'}  ${u.name}  contraseña:${u.passwordHash ? 'sí' : 'no'}  último acceso:${u.lastLoginAt?.toISOString() ?? '-'}`);
    }
  },
};

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!commands[command]) {
    console.error('Uso: user-admin.js <set-owner|create|set-password|list> ...');
    process.exitCode = 2;
    return;
  }
  await commands[command](...args);
}

main()
  .catch((error) => fail(error.message))
  .finally(() => prisma.$disconnect());
