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
  PAYMENTS_SANDBOX_ENABLED: bool.default('false'),
  PAYMENT_SANDBOX_WEBHOOK_SECRET: z.string().min(32).optional(),
  BANGLA_QR_ENABLED: bool.default('false'),
  PAYOUTS_LIVE_ENABLED: bool.default('false'),
  CROSS_BORDER_ENABLED: bool.default('false'),
  AI_ENABLED: bool.default('false'),
  ROAD_ROUTING_ENABLED: bool.default('false'),
  ROAD_ROUTING_PROVIDER: z.enum(['disabled','google_routes']).default('disabled'),
  GOOGLE_ROUTES_API_KEY: z.string().min(20).optional(),
  GOOGLE_ROUTES_BASE_URL: z.string().url().default('https://routes.googleapis.com'),
  DISPATCH_OFFER_TOKEN_SECRET: z.string().min(32).optional(),
  DISPATCH_EXPIRY_ENABLED: bool.default('false'),
  DISPATCH_EXPIRY_POLL_MS: z.coerce.number().int().min(50).max(60000).default(1000),
  DISPATCH_EXPIRY_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100)
});
export const apiEnvSchema = envSchema.extend({
  BFF_API_SHARED_SECRET: z.string().min(32),
  SESSION_TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i),
  DATABASE_PRIVILEGED_URL: z.string().startsWith('postgresql://'),
  API_INTERNAL_URL: z.string().url().default('http://localhost:4000'),
  STORAGE_LOCAL_DIR: z.string().default('.local/private-storage'),
  STORAGE_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i)
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;
export function loadApiEnv(input: NodeJS.ProcessEnv): ApiEnv {
  const env = apiEnvSchema.parse(input);
  if (env.NODE_ENV === 'production') {
    if (env.WEB_ORIGIN.startsWith('http://')) throw new Error('PROD_HTTP_FORBIDDEN');
    if (env.KEYCLOAK_ISSUER.startsWith('http://')) throw new Error('PROD_HTTP_IDP_FORBIDDEN');
    if (!env.SESSION_COOKIE_NAME.startsWith('__Host-')) throw new Error('HOST_COOKIE_REQUIRED');
  }
  if (env.CROSS_BORDER_ENABLED) throw new Error('CROSS_BORDER_NOT_AUTHORIZED');
  if (env.PAYMENTS_LIVE_ENABLED) throw new Error('PAYMENTS_LIVE_NOT_AUTHORIZED');
  if (env.PAYMENTS_SANDBOX_ENABLED && !env.PAYMENT_SANDBOX_WEBHOOK_SECRET) throw new Error('PAYMENT_SANDBOX_WEBHOOK_SECRET_REQUIRED');
  if (env.NODE_ENV === 'production' && env.PAYMENTS_SANDBOX_ENABLED) throw new Error('PAYMENT_SANDBOX_FORBIDDEN_IN_PRODUCTION');
  if (env.ROAD_ROUTING_ENABLED) {
    if (env.NODE_ENV === 'production') throw new Error('ROAD_ROUTING_LIVE_NOT_AUTHORIZED');
    if (env.ROAD_ROUTING_PROVIDER !== 'google_routes' || !env.GOOGLE_ROUTES_API_KEY) throw new Error('ROAD_ROUTING_CONFIG_REQUIRED');
    if (env.NODE_ENV !== 'test' && env.GOOGLE_ROUTES_BASE_URL !== 'https://routes.googleapis.com') throw new Error('ROAD_ROUTING_BASE_URL_NOT_ALLOWED');
  }
  if (env.DISPATCH_EXPIRY_ENABLED && !env.DISPATCH_OFFER_TOKEN_SECRET) throw new Error('DISPATCH_OFFER_TOKEN_SECRET_REQUIRED');
  return env;
}
export type Env = z.infer<typeof envSchema>;
export function loadEnv(input: NodeJS.ProcessEnv): Env {
  const env = envSchema.parse(input);
  if (env.NODE_ENV === 'production') {
    if (env.WEB_ORIGIN.startsWith('http://')) throw new Error('PROD_HTTP_FORBIDDEN');
    if (env.KEYCLOAK_ISSUER.startsWith('http://')) throw new Error('PROD_HTTP_IDP_FORBIDDEN');
    if (!env.SESSION_COOKIE_NAME.startsWith('__Host-')) throw new Error('HOST_COOKIE_REQUIRED');
  }
  if (env.CROSS_BORDER_ENABLED) throw new Error('CROSS_BORDER_NOT_AUTHORIZED');
  if (env.PAYMENTS_LIVE_ENABLED) throw new Error('PAYMENTS_LIVE_NOT_AUTHORIZED');
  if (env.PAYMENTS_SANDBOX_ENABLED && !env.PAYMENT_SANDBOX_WEBHOOK_SECRET) throw new Error('PAYMENT_SANDBOX_WEBHOOK_SECRET_REQUIRED');
  if (env.NODE_ENV === 'production' && env.PAYMENTS_SANDBOX_ENABLED) throw new Error('PAYMENT_SANDBOX_FORBIDDEN_IN_PRODUCTION');
  return env;
}
