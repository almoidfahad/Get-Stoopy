export function webConfig() {
  const required = ['WEB_ORIGIN','KEYCLOAK_ISSUER','KEYCLOAK_CLIENT_ID','KEYCLOAK_CLIENT_SECRET','API_INTERNAL_URL','BFF_API_SHARED_SECRET','SESSION_TOKEN_ENCRYPTION_KEY'] as const;
  for (const k of required) if (!process.env[k]) throw new Error(`MISSING_ENV_${k}`);
  const production = process.env['NODE_ENV'] === 'production';
  const sessionCookieName = process.env['SESSION_COOKIE_NAME'] ?? (production ? '__Host-gs_session' : 'gs_session_dev');
  if (production && !sessionCookieName.startsWith('__Host-')) throw new Error('HOST_COOKIE_REQUIRED');
  return {
    production,
    webOrigin: process.env['WEB_ORIGIN']!,
    issuer: process.env['KEYCLOAK_ISSUER']!,
    clientId: process.env['KEYCLOAK_CLIENT_ID']!,
    clientSecret: process.env['KEYCLOAK_CLIENT_SECRET']!,
    apiUrl: process.env['API_INTERNAL_URL']!,
    bffSecret: process.env['BFF_API_SHARED_SECRET']!,
    encryptionKey: process.env['SESSION_TOKEN_ENCRYPTION_KEY']!,
    sessionCookieName,
    redirectUri: `${process.env['WEB_ORIGIN']}/api/auth/callback`,
    allowInsecureHttp: process.env['NODE_ENV'] !== 'production'
  };
}
