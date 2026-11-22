#!/usr/bin/env node
/**
 * Administración de usuarios. Las cuentas también se crean solas con el registro (REGISTRATION_MODE=invite|open);
 * este comando sirve para el propietario, para casos especiales y para gestionar invitaciones y suspensiones.
 *
 *   node scripts/user-admin.js set-owner <correo> "<nombre>"   Reclama el usuario propietario existente
 *   node scripts/user-admin.js create <correo> "<nombre>"      Crea un usuario nuevo (ya verificado)
 *   node scripts/user-admin.js set-password <correo>           Cambia la contraseña de un usuario
 *   node scripts/user-admin.js list                            Lista los usuarios
 *   node scripts/user-admin.js suspend <correo>                Suspende la cuenta y cierra sus sesiones y apps
 *   node scripts/user-admin.js activate <correo>               Reactiva una cuenta suspendida
 *   node scripts/user-admin.js set-quota <correo> [--gb n] [--audios n] [--reset]
 *                                                              Cuota propia de la cuenta (--reset vuelve a los valores por defecto)
 *   node scripts/user-admin.js set-plan <correo> <trial|premium|founder> [--days n]
 *                                                              Plan comercial; --days fija el vencimiento (sin --days, premium y founder no vencen)
 *   node scripts/user-admin.js invite [--email x] [--uses n] [--days n] [--note "..."]
 *                                                              Crea un código de invitación (se muestra una sola vez)
 *   node scripts/user-admin.js invitations                     Lista las invitaciones (sin los códigos)
 *   node scripts/user-admin.js audios <correo>                 Lista los audios de una cuenta (con su id)
 *   node scripts/user-admin.js remove-audio <id> [--reason "..."]
 *                                                              Retiro de contenido: elimina un audio al instante
 *   node scripts/user-admin.js delete-user <correo> --confirm  Elimina una cuenta y todos sus datos
 *
 * La contraseña se pide por teclado (sin mostrarla); no se admite como argumento para que no quede en
 * el historial. Para automatizar, USER_ADMIN_PASSWORD la toma del entorno.
 * En la VM:  node --env-file=/var/app/bookreader/shared/api.env scripts/user-admin.js ...
 */
const readline = require('node:readline');
const { createHash, randomInt } = require('node:crypto');
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

/**
 * Borrado definitivo con la misma lógica y las mismas salvaguardas que la aplicación (usa el código compilado:
 * hay que haber ejecutado `npm run build`; en la VM ya viene en el release). ADMIN_SKIP_S3=true solo existe
 * para las pruebas: no toca S3.
 */
function eraser() {
  const { AccountEraser } = require('../dist/accounts/account-eraser');
  let storage = { deleteObjects: async () => [] };
  if (process.env.ADMIN_SKIP_S3 !== 'true') {
    const { StorageService } = require('../dist/storage/storage.service');
    storage = new StorageService({
      getOrThrow: (key) => {
        if (!process.env[key]) throw new Error(`Falta ${key} en el entorno`);
        return process.env[key];
      },
    });
  }
  return new AccountEraser(prisma, storage);
}

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
    const hash = await passwordHash();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: OWNER_ID },
        data: { email, name: name?.trim() || owner.name, passwordHash: hash, status: 'ACTIVE', emailVerifiedAt: owner.emailVerifiedAt ?? new Date() },
      }),
      prisma.session.deleteMany({ where: { userId: OWNER_ID } }),
      prisma.apiToken.deleteMany({ where: { userId: OWNER_ID } }),
    ]);
    console.log(`Propietario listo: ${email} (conserva todos sus audios).`);
  },

  async create(emailArg, name) {
    const email = normalizeEmail(emailArg);
    if (!name?.trim()) throw new Error('Indica el nombre: create <correo> "<nombre>"');
    if (await prisma.user.findUnique({ where: { email } })) throw new Error('Ese correo ya existe');
    const user = await prisma.user.create({
      data: { email, name: name.trim(), passwordHash: await passwordHash(), status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
    console.log(`Usuario creado: ${email} (${user.id})`);
  },

  async 'set-password'(emailArg) {
    const email = normalizeEmail(emailArg);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('No existe ese usuario');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await passwordHash() } });
    // Una contraseña nueva invalida las sesiones abiertas y las apps vinculadas.
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.apiToken.deleteMany({ where: { userId: user.id } });
    console.log(`Contraseña actualizada para ${email}; se cerraron sus sesiones y apps.`);
  },

  async list() {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    for (const u of users) {
      console.log(`${u.id}  ${u.email ?? '(sin correo)'}  ${u.name}  ${u.status}  correo verificado:${u.emailVerifiedAt ? 'sí' : 'no'}  último acceso:${u.lastLoginAt?.toISOString() ?? '-'}`);
    }
  },

  async suspend(emailArg) {
    const email = normalizeEmail(emailArg);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('No existe ese usuario');
    if (user.id === OWNER_ID) throw new Error('No se puede suspender al propietario');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    const sessions = await prisma.session.deleteMany({ where: { userId: user.id } });
    const apps = await prisma.apiToken.deleteMany({ where: { userId: user.id } });
    console.log(`Cuenta suspendida: ${email} (${sessions.count} sesiones y ${apps.count} apps cerradas).`);
  },

  async activate(emailArg) {
    const email = normalizeEmail(emailArg);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('No existe ese usuario');
    await prisma.user.update({ where: { id: user.id }, data: { status: user.emailVerifiedAt ? 'ACTIVE' : 'PENDING' } });
    console.log(`Cuenta reactivada: ${email}`);
  },

  async 'set-quota'(emailArg, ...args) {
    const email = normalizeEmail(emailArg);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('No existe ese usuario');
    const data = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--reset') {
        data.storageLimitBytes = null;
        data.maxAudios = null;
      } else if (args[i] === '--gb' || args[i] === '--audios') {
        const value = Number(args[++i]);
        if (!(value > 0)) throw new Error(`${args[i - 1]} debe ser un número mayor que 0`);
        if (args[i - 1] === '--gb') data.storageLimitBytes = BigInt(Math.floor(value * 1024 ** 3));
        else data.maxAudios = Math.floor(value);
      } else {
        throw new Error('Uso: set-quota <correo> [--gb n] [--audios n] [--reset]');
      }
    }
    if (!Object.keys(data).length) throw new Error('Uso: set-quota <correo> [--gb n] [--audios n] [--reset]');
    const updated = await prisma.user.update({ where: { id: user.id }, data });
    const gb = updated.storageLimitBytes === null ? 'por defecto' : `${(Number(updated.storageLimitBytes) / 1024 ** 3).toFixed(2)} GB`;
    console.log(`Cuota de ${email}: almacenamiento ${gb}, audios ${updated.maxAudios ?? 'por defecto'}.`);
  },

  async 'set-plan'(emailArg, planArg, ...args) {
    const email = normalizeEmail(emailArg);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('No existe ese usuario');
    const plan = { trial: 'TRIAL', premium: 'PREMIUM', founder: 'FOUNDER' }[(planArg ?? '').toLowerCase()];
    if (!plan) throw new Error('Uso: set-plan <correo> <trial|premium|founder> [--days n]');
    let planExpiresAt = null;
    if (args[0] === '--days') {
      const days = Number(args[1]);
      if (!(days > 0)) throw new Error('--days debe ser un número mayor que 0');
      planExpiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);
    } else if (args.length) {
      throw new Error('Uso: set-plan <correo> <trial|premium|founder> [--days n]');
    }
    if (plan === 'TRIAL' && !planExpiresAt) throw new Error('El plan trial requiere --days');
    await prisma.user.update({ where: { id: user.id }, data: { plan, planExpiresAt } });
    console.log(`Plan de ${email}: ${plan}${planExpiresAt ? `, vence ${planExpiresAt.toISOString()}` : ', sin vencimiento'}.`);
  },

  async audios(emailArg) {
    const email = normalizeEmail(emailArg);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('No existe ese usuario');
    const rows = await prisma.summary.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    for (const s of rows) {
      console.log(`${s.id}  ${s.status}${s.deletedAt ? '+PAPELERA' : ''}  ${(s.sizeBytes / 1024 ** 2).toFixed(1)} MB  ${s.title} — ${s.author}`);
    }
    console.log(`${rows.length} audios de ${email}.`);
  },

  /** Retiro de contenido: elimina un audio al instante (archivo, portada y fila), sin pasar por la papelera. */
  async 'remove-audio'(id, ...args) {
    if (!id) throw new Error('Uso: remove-audio <id> [--reason "..."]');
    const reason = args[0] === '--reason' ? args[1] : undefined;
    const removed = await eraser().deleteAudio(id);
    console.log(`Audio eliminado: "${removed.title}" (usuario ${removed.email ?? removed.userId}).${reason ? ` Motivo: ${reason}.` : ''}`);
    console.log('Avisa a la persona por correo: la aplicación no lo envía desde este comando.');
  },

  /** Elimina una cuenta y todos sus datos (solicitud de cancelación o resolución de una reclamación). */
  async 'delete-user'(emailArg, confirm) {
    const email = normalizeEmail(emailArg);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('No existe ese usuario');
    if (confirm !== '--confirm') throw new Error(`Esto borra la cuenta y todo su contenido. Repite con --confirm: delete-user ${email} --confirm`);
    const { audios } = await eraser().deleteAccount(user.id);
    console.log(`Cuenta eliminada: ${email} (${audios} audios).`);
  },

  async invite(...args) {
    const options = { uses: '1', days: '14' };
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]?.replace(/^--/, '');
      if (!['email', 'uses', 'days', 'note'].includes(key) || args[i + 1] === undefined) {
        throw new Error('Uso: invite [--email x] [--uses n] [--days n] [--note "..."]');
      }
      options[key] = args[i + 1];
    }
    const uses = Number.parseInt(options.uses, 10);
    const days = Number.parseInt(options.days, 10);
    if (!(uses >= 1 && uses <= 1000) || !(days >= 1 && days <= 365)) throw new Error('--uses va de 1 a 1000 y --days de 1 a 365');
    // Sin caracteres ambiguos (0/O, 1/I): se puede dictar o copiar a mano.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const raw = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('');
    await prisma.invitation.create({
      data: {
        // El código que se entrega es BR-XXXX-XXXX-XXXX; la API lo normaliza (sin guiones, en mayúsculas) y lo compara con este hash.
        codeHash: createHash('sha256').update(`BR${raw}`).digest('hex'),
        email: options.email ? normalizeEmail(options.email) : null,
        maxUses: uses,
        expiresAt: new Date(Date.now() + days * 24 * 3600 * 1000),
        note: options.note?.slice(0, 200) ?? null,
      },
    });
    console.log(`Código de invitación (se muestra una sola vez): BR-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`);
    console.log(`Vale para ${uses} ${uses === 1 ? 'registro' : 'registros'}${options.email ? ` de ${options.email}` : ''}, durante ${days} días.`);
  },

  async invitations() {
    const rows = await prisma.invitation.findMany({ orderBy: { createdAt: 'asc' } });
    for (const i of rows) {
      console.log(`${i.id}  usos:${i.uses}/${i.maxUses}  caduca:${i.expiresAt?.toISOString() ?? '-'}  correo:${i.email ?? '-'}  nota:${i.note ?? '-'}`);
    }
  },
};

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!commands[command]) {
    console.error('Uso: user-admin.js <set-owner|create|set-password|list|suspend|activate|set-quota|set-plan|invite|invitations|audios|remove-audio|delete-user> ...');
    process.exitCode = 2;
    return;
  }
  await commands[command](...args);
}

main()
  .catch((error) => fail(error.message))
  .finally(() => prisma.$disconnect());
