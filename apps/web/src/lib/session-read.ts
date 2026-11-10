import { apiFetch } from './bff';

type SessionRead =
  | { state: 'signed-out' }
  | { state: 'unavailable' }
  | { state: 'ok'; data: Record<string, unknown> };

/** Read session information, not authorization for a workspace or action. */
export async function readSession(): Promise<SessionRead> {
  try {
    // Keep the timeout active while the response body is consumed. Do not send
    // a session cookie to an unexpected redirect destination.
    const response = await apiFetch('/auth/me', { redirect: 'manual', signal: AbortSignal.timeout(8_000) });
    if (response.status === 401) return { state: 'signed-out' };
    if (response.status !== 200) return { state: 'unavailable' };
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { state: 'unavailable' };
    const record = data as Record<string, unknown>;
    const user = record.user;
    if (!user || typeof user !== 'object' || Array.isArray(user) ||
        typeof (user as Record<string, unknown>).id !== 'string' || !(user as { id: string }).id.trim()) return { state: 'unavailable' };
    return { state: 'ok', data: record };
  } catch {
    return { state: 'unavailable' };
  }
}
