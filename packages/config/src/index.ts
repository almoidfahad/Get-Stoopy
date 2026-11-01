import { z } from 'zod';
const bool = z.enum(['true', 'false']).transform(v => v === 'true');
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().startsWith('redis://'),
  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().default('__Host-gs_session'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(15),
  PRIVILEGED_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(8),
  PAYMENTS_LIVE_ENABLED: bool.default('false'),
  BANGLA_QR_ENABLED: bool.default('false'),
  PAYOUTS_LIVE_ENABLED: bool.default('false'),
  CROSS_BORDER_ENABLED: bool.default('false'),
  AI_ENABLED: bool.default('false')
});
export type Env = z.infer<typeof envSchema>;
export function loadEnv(input: NodeJS.ProcessEnv): Env {
  const env = envSchema.parse(input);
  if (env.NODE_ENV === 'production') {
    if (env.WEB_ORIGIN.startsWith('http://')) throw new Error('PROD_HTTP_FORBIDDEN');
    if (env.KEYCLOAK_ISSUER.startsWith('http://')) throw new Error('PROD_HTTP_IDP_FORBIDDEN');
    if (!env.SESSION_COOKIE_NAME.startsWith('__Host-')) throw new Error('HOST_COOKIE_REQUIRED');
  }
  if (env.CROSS_BORDER_ENABLED) throw new Error('CROSS_BORDER_NOT_AUTHORIZED');
  return env;
}
