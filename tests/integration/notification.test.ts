import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import { urls, asSuper, asUser } from './helpers';

const u = urls();
let app: any;
const origin = 'http://localhost:3000';
let pool: pg.Pool;
let privilegedPool: pg.Pool;
let customer: any;
let stranger: any;

async function makeUser(label: string) {
  const userId = randomUUID();
  const token = `notif-${label}-${randomUUID()}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Notif ${label}`]);
    await c.query(`INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '15 minutes',1)`, [sessionId, userId, tokenHash]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, sessionId, token, csrf: me.body.csrfToken as string };
}

function post(path: string, user: { token: string; csrf: string }, body: unknown = {}) {
  return request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body);
}

function get(path: string, user: { token: string }) {
  return request(app.getHttpServer()).get(path).set('Cookie', `gs_session_dev=${user.token}`);
}

function patch(path: string, user: { token: string; csrf: string }, body: unknown = {}) {
  return request(app.getHttpServer()).patch(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body);
}

describe('notification lifecycle', () => {
  beforeAll(async () => {
    const { createApp } = await import('../../apps/api/src/main');
    app = await createApp();
    await app.init();
    pool = new pg.Pool({ connectionString: u.runtime });
    privilegedPool = new pg.Pool({ connectionString: u.privileged });
    customer = await makeUser('customer');
    stranger = await makeUser('stranger');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await privilegedPool.end();
  });

  it('creates a notification and returns it', async () => {
    const commandKey = `notif-create-${randomUUID().slice(0, 8)}`;
    const res = await post('/api/v1/notifications', customer, {
      userId: customer.userId,
      type: 'ORDER_STATUS',
      channel: 'EMAIL',
      subject: 'Your order is confirmed',
      body: 'Thank you for your order.',
      templateId: null,
      commandKey,
    }).expect(201);

    expect(res.body.notificationId).toBeDefined();
    expect(res.body.userId).toBe(customer.userId);
    expect(res.body.type).toBe('ORDER_STATUS');
    expect(res.body.channel).toBe('EMAIL');
    expect(res.body.status).toBe('PENDING');
    expect(res.body.subject).toBe('Your order is confirmed');
    expect(res.body.body).toBe('Thank you for your order.');
    expect(res.body.commandKey).toBe(commandKey);
    expect(res.body.duplicate).toBe(false);
  });

  it('rejects a duplicate command key with the same notification', async () => {
    const commandKey = `notif-dup-${randomUUID().slice(0, 8)}`;
    await post('/api/v1/notifications', customer, {
      userId: customer.userId,
      type: 'DELIVERY_UPDATE',
      channel: 'IN_APP',
      subject: 'Delivery update',
      body: 'Your item is on the way.',
      templateId: null,
      commandKey,
    }).expect(201);

    const res = await post('/api/v1/notifications', customer, {
      userId: customer.userId,
      type: 'PAYMENT_REMINDER', // different type, same command key
      channel: 'SMS',
      subject: 'Payment reminder',
      body: 'Please pay.',
      templateId: null,
      commandKey,
    }).expect(201);

    // Same command key for same user returns the existing notification (idempotent)
    expect(res.body.duplicate).toBe(true);
    expect(res.body.type).toBe('DELIVERY_UPDATE'); // original type preserved
  });

  it('lists notifications with pagination', async () => {
    // Create 3 notifications
    for (let i = 0; i < 3; i++) {
      await post('/api/v1/notifications', customer, {
        userId: customer.userId,
        type: 'SYSTEM_ALERT',
        channel: 'PUSH',
        subject: `Alert ${i}`,
        body: `Body ${i}`,
        templateId: null,
        commandKey: `notif-list-${randomUUID().slice(0, 8)}`,
      }).expect(201);
    }

    const res = await get(`/api/v1/notifications?userId=${customer.userId}&limit=2`, customer).expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.nextCursor).toBeDefined();

    // Fetch next page (5 total notifications exist from prior tests + this test's 3)
    const res2 = await get(`/api/v1/notifications?userId=${customer.userId}&limit=2&cursor=${res.body.nextCursor}`, customer).expect(200);
    expect(res2.body.items).toHaveLength(2);
    expect(res2.body.nextCursor).toBeDefined();
  });

  it('filters notifications by status', async () => {
    const res = await get(`/api/v1/notifications?userId=${customer.userId}&status=PENDING`, customer).expect(200);
    for (const item of res.body.items) {
      expect(item.status).toBe('PENDING');
    }
  });

  it('gets a single notification', async () => {
    const list = await get(`/api/v1/notifications?userId=${customer.userId}&limit=1`, customer).expect(200);
    const notificationId = list.body.items[0].notificationId;

    const res = await get(`/api/v1/notifications/${notificationId}?userId=${customer.userId}`, customer).expect(200);
    expect(res.body.notificationId).toBe(notificationId);
  });

  it('marks a notification as read', async () => {
    const list = await get(`/api/v1/notifications?userId=${customer.userId}&status=PENDING&limit=1`, customer).expect(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    const notificationId = list.body.items[0].notificationId;

    const res = await patch(`/api/v1/notifications/${notificationId}/read?userId=${customer.userId}`, customer, {}).expect(200);
    expect(res.body.status).toBe('READ');
    expect(res.body.readAt).toBeDefined();
  });

  it('gets and updates notification preferences', async () => {
    const prefs = await get(`/api/v1/notifications/preferences?userId=${customer.userId}`, customer).expect(200);
    expect(Array.isArray(prefs.body)).toBe(true);

    const res = await post(`/api/v1/notifications/preferences?userId=${customer.userId}`, customer, {
      channel: 'EMAIL',
      enabled: false,
    }).expect(201);

    expect(res.body.channel).toBe('EMAIL');
    expect(res.body.enabled).toBe(false);
  });

  it('rejects access to another user\'s notification', async () => {
    const list = await get(`/api/v1/notifications?userId=${customer.userId}&limit=1`, customer).expect(200);
    const notificationId = list.body.items[0].notificationId;

    await get(`/api/v1/notifications/${notificationId}?userId=${stranger.userId}`, stranger).expect(404);
    await patch(`/api/v1/notifications/${notificationId}/read?userId=${stranger.userId}`, stranger, {}).expect(404);
  });

  it('rejects notification creation for another user', async () => {
    await post('/api/v1/notifications', customer, {
      userId: stranger.userId,
      type: 'SYSTEM_ALERT',
      channel: 'IN_APP',
      subject: 'Hack attempt',
      body: 'Trying to create for another user.',
      templateId: null,
      commandKey: `notif-hack-${randomUUID().slice(0, 8)}`,
    }).expect(403);
  });
});
