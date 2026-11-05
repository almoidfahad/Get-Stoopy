/**
 * Notification types, validation, and rendering helpers shared by the storefront
 * and tests.
 *
 * Design rules:
 *
 * 1. **No live email/SMS integration yet.** The API exposes a secure interface
 *    and records delivery attempts, but no real message is sent until the owner
 *    approves a provider contract and live configuration.
 *
 * 2. **Template-first rendering.** Notification bodies are rendered from
 *    server-side templates with escaped variables. Callers cannot inject raw
 *    HTML or arbitrary text into the body.
 *
 * 3. **Idempotent creation.** Each notification carries a client-generated
 *    `commandKey`; the server deduplicates by `(userId, commandKey)` so a
 *    double-clicked button or retried request cannot create duplicate
 *    notifications.
 *
 * 4. **User-scoped.** A notification always belongs to one user; RLS and the
 *    API enforce that users can only read their own notifications.
 */
import { createHash } from 'node:crypto';

export const NOTIFICATION_TYPES = [
  'ORDER_STATUS',
  'DELIVERY_UPDATE',
  'PAYMENT_REMINDER',
  'KYC_UPDATE',
  'PROMOTIONAL',
  'SYSTEM_ALERT',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'IN_APP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export interface NotificationInput {
  readonly userId: string;
  readonly type: NotificationType;
  readonly channel: NotificationChannel;
  readonly subject: string;
  readonly body: string;
  readonly templateId: string | null;
  readonly commandKey: string;
}

export interface NotificationPreferenceInput {
  readonly userId: string;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
}

export interface NotificationSummary {
  readonly notificationId: string;
  readonly type: NotificationType;
  readonly channel: NotificationChannel;
  readonly status: NotificationStatus;
  readonly subject: string | null;
  readonly createdAt: string;
  readonly sentAt: string | null;
  readonly readAt: string | null;
}

export type NotificationIssueKind =
  | 'type-invalid'
  | 'channel-invalid'
  | 'subject-invalid'
  | 'body-invalid'
  | 'command-key-invalid'
  | 'user-id-invalid';

export interface NotificationIssue {
  readonly kind: NotificationIssueKind;
}

export const NOTIFICATION_ISSUE_MESSAGES: Record<NotificationIssueKind, string> = {
  'type-invalid': 'Notification type is not recognized.',
  'channel-invalid': 'Delivery channel is not recognized.',
  'subject-invalid': 'Subject must be between 1 and 200 characters.',
  'body-invalid': 'Body must be between 1 and 4000 characters.',
  'command-key-invalid': 'Command key must be 8-128 characters and contain only letters, digits, colon, underscore, or hyphen.',
  'user-id-invalid': 'User ID must be a valid UUID.',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMAND_KEY_RE = /^[A-Za-z0-9:_-]{8,128}$/;

export type ParseNotificationResult =
  | { ok: true; value: NotificationInput }
  | { ok: false; code: NotificationIssueKind };

export function parseNotificationInput(input: unknown): ParseNotificationResult {
  if (typeof input !== 'object' || input === null) return { ok: false, code: 'body-invalid' };
  const fields = input as Record<string, unknown>;

  const userId = fields['userId'];
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) return { ok: false, code: 'user-id-invalid' };

  const type = fields['type'];
  if (typeof type !== 'string' || !NOTIFICATION_TYPES.includes(type as NotificationType)) {
    return { ok: false, code: 'type-invalid' };
  }

  const channel = fields['channel'];
  if (typeof channel !== 'string' || !NOTIFICATION_CHANNELS.includes(channel as NotificationChannel)) {
    return { ok: false, code: 'channel-invalid' };
  }

  const subject = fields['subject'];
  if (typeof subject !== 'string' || subject.length < 1 || subject.length > 200) {
    return { ok: false, code: 'subject-invalid' };
  }

  const body = fields['body'];
  if (typeof body !== 'string' || body.length < 1 || body.length > 4000) {
    return { ok: false, code: 'body-invalid' };
  }

  const templateId = fields['templateId'];
  if (templateId !== null && templateId !== undefined) {
    if (typeof templateId !== 'string' || !UUID_RE.test(templateId)) {
      return { ok: false, code: 'user-id-invalid' };
    }
  }

  const commandKey = fields['commandKey'];
  if (typeof commandKey !== 'string' || !COMMAND_KEY_RE.test(commandKey)) {
    return { ok: false, code: 'command-key-invalid' };
  }

  return {
    ok: true,
    value: {
      userId,
      type: type as NotificationType,
      channel: channel as NotificationChannel,
      subject,
      body,
      templateId: templateId ?? null,
      commandKey,
    },
  };
}

/**
 * Escapes text for safe insertion into a notification body template.
 * Replaces HTML-significant characters so callers cannot inject markup.
 */
export function escapeBodyText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Derives the idempotency payload hash from a command key so the server can
 * detect a replayed creation request with a different payload.
 */
export function commandKeyHash(commandKey: string): string {
  return createHash('sha256').update(commandKey).digest('hex');
}

export const NOTIFICATION_ERROR_MESSAGES: Record<string, string> = {
  SIGN_IN_REQUIRED: 'Please sign in to view notifications.',
  NOTIFICATION_NOT_FOUND: 'That notification does not exist.',
  NOTIFICATION_FOR_OWNER_ONLY: 'You can only view your own notifications.',
  PREFERENCES_INVALID: 'Notification preferences could not be saved.',
  NOTIFICATION_UNAVAILABLE: 'The notification service could not be reached. Please try again shortly.',
  ORIGIN_DENIED: 'That request was rejected. Reload the page and try again.',
};

export function notificationErrorMessage(code: string | undefined, status: number): string {
  if (code && NOTIFICATION_ERROR_MESSAGES[code]) return NOTIFICATION_ERROR_MESSAGES[code];
  return status >= 500
    ? 'The notification service is unavailable. Please try again shortly.'
    : 'That notification request could not be completed.';
}
