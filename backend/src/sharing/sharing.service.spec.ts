import {
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  ShareScope,
  ShareStatus,
  SummaryStatus,
  UserStatus,
} from '@prisma/client';
import { SlidingWindowLimiter } from '../auth/rate-limiter';
import { MailService } from '../mail/mail.service';
import { shareInvitationMessage } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { SharingService } from './sharing.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RECIPIENT = '22222222-2222-4222-8222-222222222222';
const AUDIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DAY = 24 * 60 * 60 * 1000;

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    ownerId: OWNER,
    recipientId: null as string | null,
    email: 'recipient@example.test',
    scope: ShareScope.ITEMS,
    status: ShareStatus.PENDING as ShareStatus,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + DAY),
    deliveredAt: new Date() as Date | null,
    activeKey: 'key' as string | null,
    owner: { name: 'Propietaria <b>' },
    items: [
      {
        shareId: 'share',
        summaryId: AUDIO,
        summary: {
          title: 'Audio',
          author: 'Autor',
          status: SummaryStatus.READY,
          deletedAt: null,
        },
      },
    ],
    ...overrides,
  };
}

describe('SharingService', () => {
  let service: SharingService;
  let limiter: SlidingWindowLimiter;
  let rows: ReturnType<typeof invitation>[];
  let counter: number;
  const users = [
    {
      id: OWNER,
      name: 'Propietaria <b>',
      email: 'owner@example.test',
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      plan: 'FOUNDER',
      planExpiresAt: null as Date | null,
    },
    {
      id: RECIPIENT,
      name: 'Destinatario',
      email: ' RECIPIENT@EXAMPLE.TEST ',
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date() as Date | null,
      plan: 'TRIAL',
      planExpiresAt: new Date(0),
    },
  ];
  const userFind = jest.fn(
    async ({ where }) => users.find((user) => user.id === where.id) ?? null,
  );
  const findUnique = jest.fn(async ({ where }) => {
    const row = rows.find((row) =>
      where.id ? row.id === where.id : row.activeKey === where.activeKey,
    );
    return row ? { ...row } : null;
  });
  const update = jest.fn(async ({ where, data }) => {
    const row = rows.find((entry) => entry.id === where.id)!;
    const changes = { ...data };
    delete changes.mailAttempts;
    Object.assign(row, changes);
    return row;
  });
  const updateMany = jest.fn(async ({ where, data }) => {
    if (typeof where.id === 'string') {
      const row = rows.find(
        (entry) =>
          entry.id === where.id &&
          (!where.status || entry.status === where.status),
      );
      if (row) Object.assign(row, data);
      return { count: row ? 1 : 0 };
    }
    return { count: 0 };
  });
  const create = jest.fn(async ({ data }) => {
    const row = invitation({
      id: `share-${++counter}`,
      ...data,
      deliveredAt: null,
      items: (data.items?.create ?? []).map((item: { summaryId: string }) => ({
        ...item,
        summary: {
          title: 'Audio',
          author: 'Autor',
          status: SummaryStatus.READY,
          deletedAt: null,
        },
      })),
    });
    rows.push(row);
    return row;
  });
  const summaryCount = jest.fn(async () => 1);
  const summaryRead = jest.fn(async () => ({ id: AUDIO }));
  const attemptCount = jest.fn(async () => 0);
  const findMany = jest.fn(async () => rows);
  const deleteShares = jest
    .fn<Promise<{ count: number }>, [{ where: Prisma.ShareWhereInput }]>()
    .mockResolvedValue({ count: 1 });
  const deleteAttempts = jest.fn(async () => ({ count: 1 }));
  const tx = {
    user: { findUnique: userFind },
    share: {
      findUnique,
      findUniqueOrThrow: findUnique,
      create,
      update,
      updateMany,
      findMany,
      count: jest.fn(async () => 0),
      deleteMany: deleteShares,
    },
    summary: { count: summaryCount, findFirst: summaryRead },
    shareMailAttempt: { count: attemptCount, deleteMany: deleteAttempts },
    $queryRaw: jest.fn(async () => []),
  };
  const prisma = { ...tx, $transaction: jest.fn(async (work) => work(tx)) };
  const send = jest.fn<Promise<void>, [unknown]>().mockResolvedValue(undefined);

  beforeEach(() => {
    process.env.SHARING_ENABLED = 'true';
    process.env.APP_PUBLIC_URL =
      'https://books.example.test/private?token=secret#secret';
    users[1].emailVerifiedAt = new Date();
    users[1].status = UserStatus.ACTIVE;
    rows = [];
    counter = 0;
    jest.clearAllMocks();
    summaryCount.mockResolvedValue(1);
    attemptCount.mockResolvedValue(0);
    send.mockResolvedValue(undefined);
    limiter = new SlidingWindowLimiter();
    service = new SharingService(
      prisma as unknown as PrismaService,
      { send } as unknown as MailService,
      limiter,
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SHARING_ENABLED;
    delete process.env.APP_PUBLIC_URL;
  });

  it('invita sin buscar cuentas destinatarias, normaliza el correo y no envía secretos', async () => {
    const result = await service.create(OWNER, {
      email: ' New@Example.Test ',
      scope: ShareScope.LIBRARY,
    });
    expect(result).toMatchObject({
      email: 'new@example.test',
      ownerName: users[0].name,
      status: 'PENDING',
      summaryIds: [],
    });
    expect(result.expiresAt.getTime() - result.createdAt.getTime()).toBeCloseTo(
      7 * DAY,
      -3,
    );
    expect(userFind.mock.calls.map(([args]) => args.where)).toEqual([
      { id: OWNER },
    ]);
    expect(rows[0].recipientId).toBeNull();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'new@example.test',
        text: expect.stringContaining('https://books.example.test/compartidos'),
      }),
    );
    expect(JSON.stringify(send.mock.calls)).not.toMatch(
      /token=|secret|private|share-1/,
    );
    expect(result).not.toHaveProperty('recipientId');
    expect(result).not.toHaveProperty('activeKey');
  });

  it('rechaza auto-compartición y selecciones ajenas, borradas o no READY antes de enviar', async () => {
    await expect(
      service.create(OWNER, {
        email: ' OWNER@EXAMPLE.TEST ',
        scope: ShareScope.LIBRARY,
      }),
    ).rejects.toThrow('contigo mismo');
    summaryCount.mockResolvedValueOnce(0);
    await expect(
      service.create(OWNER, {
        email: 'recipient@example.test',
        scope: ShareScope.ITEMS,
        summaryIds: [AUDIO],
      }),
    ).rejects.toThrow('propios disponibles');
    expect(summaryCount).toHaveBeenCalledWith({
      where: {
        id: { in: [AUDIO] },
        userId: OWNER,
        status: 'READY',
        deletedAt: null,
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rechaza selecciones vacías, duplicadas o ids enviados con LIBRARY', async () => {
    for (const dto of [
      { scope: ShareScope.ITEMS, summaryIds: [] },
      { scope: ShareScope.ITEMS, summaryIds: [AUDIO, AUDIO.toUpperCase()] },
      { scope: ShareScope.LIBRARY, summaryIds: [AUDIO] },
    ]) {
      await expect(
        service.create(OWNER, { email: 'recipient@example.test', ...dto }),
      ).rejects.toThrow('selección válida');
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('deduplica contenido ordenado y permite ITEMS y LIBRARY superpuestos', async () => {
    summaryCount.mockResolvedValue(2);
    await service.create(OWNER, {
      email: 'recipient@example.test',
      scope: ShareScope.ITEMS,
      summaryIds: [AUDIO, SECOND],
    });
    await expect(
      service.create(OWNER, {
        email: 'RECIPIENT@EXAMPLE.TEST',
        scope: ShareScope.ITEMS,
        summaryIds: [SECOND.toUpperCase(), AUDIO],
      }),
    ).rejects.toThrow('Ya existe');
    await service.create(OWNER, {
      email: 'recipient@example.test',
      scope: ShareScope.LIBRARY,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].activeKey).not.toBe(rows[1].activeKey);
  });

  it('solo vincula al aceptar con correo verificado y conserva permisos después de vencer la prueba', async () => {
    rows = [invitation()];
    users[1].emailVerifiedAt = null;
    await expect(service.accept(RECIPIENT, rows[0].id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    users[1].emailVerifiedAt = new Date();
    await expect(service.accept(OWNER, rows[0].id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const accepted = await service.accept(RECIPIENT, rows[0].id);
    expect(accepted.status).toBe('ACCEPTED');
    expect(rows[0].recipientId).toBe(RECIPIENT);
    rows[0].expiresAt = new Date(0);
    const where = await service.readableWhere(RECIPIENT);
    expect(where.OR).toContainEqual({ userId: RECIPIENT });
    expect(JSON.stringify(where)).toContain('"status":"ACCEPTED"');
    expect(JSON.stringify(where)).not.toMatch(
      /expiresAt|planExpiresAt|READY|deletedAt/,
    );
    await service.canRead(RECIPIENT, AUDIO);
    expect(summaryRead).toHaveBeenCalledWith({
      where: { AND: [{ id: AUDIO }, where] },
      select: { id: true },
    });
  });

  it.each([
    { status: ShareStatus.REVOKED },
    { status: ShareStatus.REJECTED },
    { status: ShareStatus.ACCEPTED, recipientId: RECIPIENT },
    { expiresAt: new Date(0) },
  ])(
    'no acepta decisiones terminales o invitaciones caducadas: %j',
    async (overrides) => {
      rows = [invitation(overrides)];
      await expect(service.accept(RECIPIENT, rows[0].id)).rejects.toThrow(
        'ya no está pendiente',
      );
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('no lista para correos sin verificar ni acepta invitaciones sin entrega confirmada', async () => {
    rows = [invitation({ deliveredAt: null })];
    await expect(service.accept(RECIPIENT, rows[0].id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    users[1].emailVerifiedAt = null;
    await expect(service.received(RECIPIENT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('deshabilitado por defecto conserva owned, rechazar y revocar, pero no crear/aceptar/reenviar', async () => {
    delete process.env.SHARING_ENABLED;
    expect(service.isEnabled()).toBe(false);
    expect(await service.readableWhere(RECIPIENT)).toEqual({
      userId: RECIPIENT,
    });
    rows = [invitation()];
    await expect(
      service.create(OWNER, {
        email: 'recipient@example.test',
        scope: ShareScope.LIBRARY,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.accept(RECIPIENT, rows[0].id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.resend(OWNER, rows[0].id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect((await service.reject(RECIPIENT, rows[0].id)).status).toBe(
      'REJECTED',
    );
    rows = [
      invitation({ status: ShareStatus.ACCEPTED, recipientId: RECIPIENT }),
    ];
    expect((await service.revoke(OWNER, rows[0].id)).status).toBe('REVOKED');
    await service.canRead(RECIPIENT, AUDIO);
    expect(summaryRead).toHaveBeenCalledWith({
      where: { AND: [{ id: AUDIO }, { userId: RECIPIENT }] },
      select: { id: true },
    });
  });

  it('revoca solo por propietario y no altera otros permisos superpuestos', async () => {
    rows = [
      invitation({ status: ShareStatus.ACCEPTED, recipientId: RECIPIENT }),
      invitation({
        id: 'other',
        scope: ShareScope.LIBRARY,
        status: ShareStatus.ACCEPTED,
        recipientId: RECIPIENT,
      }),
    ];
    await expect(service.revoke(RECIPIENT, rows[0].id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await service.revoke(OWNER, rows[0].id);
    expect(rows.map((row) => row.status)).toEqual(['REVOKED', 'ACCEPTED']);
    expect(rows[0].activeKey).toBeNull();
  });

  it('expone fallos de entrega y revoca lo no entregado sin registrar direcciones', async () => {
    send.mockRejectedValueOnce(new Error('SMTP recipient@example.test'));
    await expect(
      service.create(OWNER, {
        email: 'recipient@example.test',
        scope: ShareScope.LIBRARY,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(rows[0]).toMatchObject({
      status: 'REVOKED',
      recipientId: null,
      deliveredAt: null,
      activeKey: null,
    });
    expect(Logger.prototype.error).toHaveBeenCalled();
    expect(
      JSON.stringify((Logger.prototype.error as jest.Mock).mock.calls),
    ).not.toContain('recipient@example.test');
  });

  it('reenviar renueva siete días, solo para propietario y PENDING, y conserva el id', async () => {
    rows = [invitation({ expiresAt: new Date(0) })];
    await expect(service.resend(RECIPIENT, rows[0].id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const result = await service.resend(OWNER, rows[0].id);
    expect(result.id).toBe(rows[0].id);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect(rows[0].recipientId).toBeNull();
    expect(rows[0].deliveredAt).not.toBeNull();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mailAttempts: { create: {} },
          deliveredAt: null,
        }),
      }),
    );
    rows[0].status = ShareStatus.ACCEPTED;
    await expect(service.resend(OWNER, rows[0].id)).rejects.toThrow(
      'no admite reenvío',
    );
  });

  it('reenvío fallido restaura entrega y plazo anterior y bloquea spam persistente', async () => {
    rows = [invitation()];
    const expiresAt = rows[0].expiresAt;
    const deliveredAt = rows[0].deliveredAt;
    send.mockRejectedValueOnce(new Error('SES no disponible'));
    await expect(service.resend(OWNER, rows[0].id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(rows[0]).toMatchObject({
      status: 'PENDING',
      expiresAt,
      deliveredAt,
    });
    attemptCount.mockResolvedValue(20);
    await expect(service.resend(OWNER, rows[0].id)).rejects.toThrow('límite');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('una revocación durante la entrega no se sobrescribe al completar el reenvío', async () => {
    rows = [invitation()];
    send.mockImplementationOnce(async () => {
      await expect(
        service.accept(RECIPIENT, rows[0].id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await service.revoke(OWNER, rows[0].id);
    });
    expect((await service.resend(OWNER, rows[0].id)).status).toBe('REVOKED');
    expect(rows[0]).toMatchObject({
      status: 'REVOKED',
      activeKey: null,
      deliveredAt: null,
    });
  });

  it('rechaza una configuración con credenciales y escapa HTML del propietario', async () => {
    process.env.APP_PUBLIC_URL = 'https://user:password@books.example.test';
    await expect(
      service.create(OWNER, {
        email: 'recipient@example.test',
        scope: ShareScope.LIBRARY,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(create).not.toHaveBeenCalled();
    expect(
      shareInvitationMessage(
        '<img src=x>',
        'LIBRARY',
        'https://books.example.test/compartidos',
      ).html,
    ).not.toContain('<img');
  });

  it('limpia caducadas/terminales sin eliminar ACCEPTED por antigüedad', async () => {
    expect(await service.cleanup()).toEqual({ shares: 1, mailAttempts: 1 });
    const where = deleteShares.mock.calls[0][0].where;
    expect(where.OR!.map((clause) => clause.status)).toEqual([
      'PENDING',
      { in: ['REJECTED', 'REVOKED'] },
    ]);
    expect(
      (where.OR![0].expiresAt as { lte: Date }).lte.getTime(),
    ).toBeLessThan(Date.now() - 29 * DAY);
  });
});
