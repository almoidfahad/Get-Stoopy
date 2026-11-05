import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_ERROR_MESSAGES,
  NOTIFICATION_ISSUE_MESSAGES,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  commandKeyHash,
  escapeBodyText,
  notificationErrorMessage,
  parseNotificationInput,
  type NotificationInput,
} from '../src/index.js';

const validBase: Record<string, unknown> = {
  userId: '11111111-1111-4111-8111-111111111111',
  type: 'ORDER_STATUS',
  channel: 'EMAIL',
  subject: 'Your order is confirmed',
  body: 'Thank you for your order #12345.',
  templateId: null,
  commandKey: 'notif-abc123def456',
};

describe('notification types and channels', () => {
  it('defines the supported notification types', () => {
    expect(NOTIFICATION_TYPES).toContain('ORDER_STATUS');
    expect(NOTIFICATION_TYPES).toContain('DELIVERY_UPDATE');
    expect(NOTIFICATION_TYPES).toContain('PAYMENT_REMINDER');
    expect(NOTIFICATION_TYPES).toContain('KYC_UPDATE');
    expect(NOTIFICATION_TYPES).toContain('PROMOTIONAL');
    expect(NOTIFICATION_TYPES).toContain('SYSTEM_ALERT');
    expect(NOTIFICATION_TYPES).toHaveLength(6);
  });

  it('defines the supported delivery channels', () => {
    expect(NOTIFICATION_CHANNELS).toContain('EMAIL');
    expect(NOTIFICATION_CHANNELS).toContain('SMS');
    expect(NOTIFICATION_CHANNELS).toContain('PUSH');
    expect(NOTIFICATION_CHANNELS).toContain('IN_APP');
    expect(NOTIFICATION_CHANNELS).toHaveLength(4);
  });

  it('defines the supported statuses', () => {
    expect(NOTIFICATION_STATUSES).toContain('PENDING');
    expect(NOTIFICATION_STATUSES).toContain('SENT');
    expect(NOTIFICATION_STATUSES).toContain('DELIVERED');
    expect(NOTIFICATION_STATUSES).toContain('FAILED');
    expect(NOTIFICATION_STATUSES).toContain('READ');
    expect(NOTIFICATION_STATUSES).toHaveLength(5);
  });
});

describe('parseNotificationInput', () => {
  it('parses a valid notification input', () => {
    const result = parseNotificationInput({ ...validBase });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userId).toBe(validBase.userId as string);
      expect(result.value.type).toBe('ORDER_STATUS');
      expect(result.value.channel).toBe('EMAIL');
      expect(result.value.commandKey).toBe('notif-abc123def456');
    }
  });

  it('accepts a template id when provided', () => {
    const result = parseNotificationInput({
      ...validBase,
      templateId: '22222222-2222-4222-8222-222222222222',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.templateId).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('rejects a non-object input', () => {
    expect(parseNotificationInput(null)).toEqual({ ok: false, code: 'body-invalid' });
    expect(parseNotificationInput('x')).toEqual({ ok: false, code: 'body-invalid' });
    expect(parseNotificationInput(42)).toEqual({ ok: false, code: 'body-invalid' });
  });

  it('rejects an invalid user id', () => {
    for (const userId of [undefined, '', 'not-a-uuid', 42]) {
      expect(parseNotificationInput({ ...validBase, userId })).toEqual({
        ok: false,
        code: 'user-id-invalid',
      });
    }
  });

  it('rejects an invalid notification type', () => {
    for (const type of [undefined, '', 'ORDER', 'order_status', 'MARKETING']) {
      expect(parseNotificationInput({ ...validBase, type })).toEqual({
        ok: false,
        code: 'type-invalid',
      });
    }
  });

  it('rejects an invalid delivery channel', () => {
    for (const channel of [undefined, '', 'email', 'WHATSAPP', 'PHONE']) {
      expect(parseNotificationInput({ ...validBase, channel })).toEqual({
        ok: false,
        code: 'channel-invalid',
      });
    }
  });

  it('rejects an invalid subject', () => {
    for (const subject of [undefined, '', 'a'.repeat(201)]) {
      expect(parseNotificationInput({ ...validBase, subject })).toEqual({
        ok: false,
        code: 'subject-invalid',
      });
    }
  });

  it('rejects an invalid body', () => {
    for (const body of [undefined, '', 'a'.repeat(4001)]) {
      expect(parseNotificationInput({ ...validBase, body })).toEqual({
        ok: false,
        code: 'body-invalid',
      });
    }
  });

  it('rejects an invalid template id', () => {
    expect(
      parseNotificationInput({ ...validBase, templateId: 'not-a-uuid' }),
    ).toEqual({ ok: false, code: 'user-id-invalid' });
  });

  it('rejects an invalid command key', () => {
    for (const commandKey of [undefined, '', 'short', 'a'.repeat(129), 'key with spaces']) {
      expect(parseNotificationInput({ ...validBase, commandKey })).toEqual({
        ok: false,
        code: 'command-key-invalid',
      });
    }
  });
});

describe('command key hashing', () => {
  it('produces a stable sha256 hash', () => {
    const hash = commandKeyHash('notif-abc123def456');
    expect(hash).toHaveLength(64);
    expect(commandKeyHash('notif-abc123def456')).toBe(hash);
  });

  it('produces different hashes for different keys', () => {
    expect(commandKeyHash('key-a')).not.toBe(commandKeyHash('key-b'));
  });
});

describe('escapeBodyText', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeBodyText('a & b < c > d " e \' f')).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &#39; f',
    );
  });

  it('leaves safe text unchanged', () => {
    expect(escapeBodyText('Hello, your order is ready.')).toBe(
      'Hello, your order is ready.',
    );
  });
});

describe('notification issue messages', () => {
  it('has copy for every issue kind', () => {
    const kinds = [
      'type-invalid',
      'channel-invalid',
      'subject-invalid',
      'body-invalid',
      'command-key-invalid',
      'user-id-invalid',
    ] as const;
    for (const kind of kinds) {
      expect(NOTIFICATION_ISSUE_MESSAGES[kind].length).toBeGreaterThan(10);
    }
  });
});

describe('notification error copy', () => {
  it('explains owner-only access', () => {
    expect(notificationErrorMessage('NOTIFICATION_FOR_OWNER_ONLY', 403)).toContain(
      'own notifications',
    );
  });

  it('falls back by status class for unknown codes', () => {
    expect(notificationErrorMessage('SOMETHING_NEW', 502)).toContain('unavailable');
    expect(notificationErrorMessage(undefined, 400)).toContain(
      'could not be completed',
    );
  });
});
