import * as client from 'openid-client';
export interface OidcConfig { issuer: string; clientId: string; clientSecret: string; redirectUri: string; scope?: string; }
export interface LoginTransaction { state: string; nonce: string; verifier: string; redirectUri: string; createdAt: number; }
export async function discover(cfg: OidcConfig): Promise<client.Configuration> {
  return client.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret);
}
export async function beginLogin(cfg: OidcConfig, config?: client.Configuration): Promise<{ url: URL; transaction: LoginTransaction }> {
  const c = config ?? await discover(cfg);
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(c, {
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope ?? 'openid profile email',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce
  });
  return { url, transaction: { state, nonce, verifier, redirectUri: cfg.redirectUri, createdAt: Date.now() } };
}
export async function completeLogin(cfg: OidcConfig, callbackUrl: URL, tx: LoginTransaction, config?: client.Configuration): Promise<client.TokenEndpointResponse> {
  if (Date.now() - tx.createdAt > 10 * 60_000) throw new Error('OIDC_TRANSACTION_EXPIRED');
  if (callbackUrl.searchParams.get('state') !== tx.state) throw new Error('OIDC_STATE_MISMATCH');
  const c = config ?? await discover(cfg);
  return client.authorizationCodeGrant(c, callbackUrl, {
    pkceCodeVerifier: tx.verifier,
    expectedState: tx.state,
    expectedNonce: tx.nonce
  });
}
export function endSessionUrl(cfg: OidcConfig, c: client.Configuration, idToken: string, postLogoutRedirectUri: string): URL {
  return client.buildEndSessionUrl(c, { id_token_hint: idToken, post_logout_redirect_uri: postLogoutRedirectUri });
}
