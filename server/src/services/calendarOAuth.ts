import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppConfig, GoogleOAuthConfig, YandexOAuthConfig } from '../config.js';
import type { Repository } from '../db/repository.js';
import type { CalendarOAuthToken, CalendarProviderName } from '../types/domain.js';

/**
 * OAuth2 authorization-code helper for the external-calendar providers.
 *
 * Responsibilities (transport-only — no persistence):
 *  - build the provider authorize URL with a signed, expiring `state` (CSRF +
 *    binds the flow to the initiating user);
 *  - verify that state on the callback;
 *  - exchange an authorization code for tokens;
 *  - refresh an access token;
 *  - fetch the account login/email for the connection label + CalDAV path.
 *
 * All HTTP is done with the global `fetch` (Node 20+) so there are no extra
 * dependencies. Provider-specific field names are normalised here.
 */

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string;
  /** Epoch millis when the access token expires (0 = unknown). */
  expiresAt: number;
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
}

/** Narrow a provider name to its configured OAuth block, or null if not live. */
export function oauthConfigFor(
  config: AppConfig,
  provider: CalendarProviderName,
): GoogleOAuthConfig | YandexOAuthConfig | null {
  return provider === 'google' ? config.calendar.google : config.calendar.yandex;
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the consent flow

export class CalendarOAuthService {
  constructor(private readonly config: AppConfig, private readonly repo: Repository) {}

  /**
   * A signed state token: `<userId>.<provider>.<expiryMs>.<nonce>.<hmac>`.
   * The HMAC (keyed by the app's JWT secret) makes it unforgeable, so the
   * callback can trust which user + provider initiated the flow without server
   * session storage. Expiry bounds replay.
   */
  buildState(userId: string, provider: CalendarProviderName): string {
    const expiry = Date.now() + STATE_TTL_MS;
    const nonce = randomBytes(8).toString('hex');
    const payload = `${userId}.${provider}.${expiry}.${nonce}`;
    return `${payload}.${this.signState(payload)}`;
  }

  /** Verify a state token; returns the bound {userId, provider} or null. */
  verifyState(state: string): { userId: string; provider: CalendarProviderName } | null {
    const parts = state.split('.');
    if (parts.length !== 5) return null;
    const [userId, provider, expiryStr, nonce, sig] = parts;
    const payload = `${userId}.${provider}.${expiryStr}.${nonce}`;
    const expected = this.signState(payload);
    // Constant-time compare to avoid leaking the signature via timing.
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    if (provider !== 'google' && provider !== 'yandex') return null;
    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || Date.now() > expiry) return null;
    return { userId, provider };
  }

  private signState(payload: string): string {
    return createHmac('sha256', this.config.jwtSecret).update(payload).digest('base64url');
  }

  /** Build the provider consent URL the browser is redirected to. */
  authorizeUrl(provider: CalendarProviderName, state: string): string | null {
    const cfg = oauthConfigFor(this.config, provider);
    if (!cfg) return null;
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: cfg.scope,
      state,
    });
    // Google needs these to return a refresh token on first consent.
    if (provider === 'google') {
      params.set('access_type', 'offline');
      params.set('prompt', 'consent');
    }
    return `${cfg.authUrl}?${params.toString()}`;
  }

  /** Exchange an authorization code for a token set. */
  async exchangeCode(provider: CalendarProviderName, code: string): Promise<TokenSet> {
    const cfg = oauthConfigFor(this.config, provider);
    if (!cfg) throw new Error(`Provider ${provider} is not configured`);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
    });
    return this.postToken(cfg.tokenUrl, body);
  }

  /** Refresh an access token using a stored refresh token. */
  async refresh(provider: CalendarProviderName, refreshToken: string): Promise<TokenSet> {
    const cfg = oauthConfigFor(this.config, provider);
    if (!cfg) throw new Error(`Provider ${provider} is not configured`);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
    const set = await this.postToken(cfg.tokenUrl, body);
    // Refresh responses often omit the refresh token — preserve the old one.
    if (!set.refreshToken) set.refreshToken = refreshToken;
    return set;
  }

  private async postToken(tokenUrl: string, body: URLSearchParams): Promise<TokenSet> {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Token endpoint ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = JSON.parse(text) as {
      access_token?: string;
      refresh_token?: string;
      token_type?: string;
      scope?: string;
      expires_in?: number;
    };
    if (!json.access_token) throw new Error('Token response missing access_token');
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? '',
      tokenType: json.token_type ?? 'Bearer',
      scope: json.scope ?? '',
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : 0,
    };
  }

  /**
   * Fetch the account login/email for labelling the connection and (Yandex)
   * building the CalDAV collection path. Returns '' if it can't be determined.
   */
  async fetchAccountLogin(provider: CalendarProviderName, accessToken: string): Promise<string> {
    const cfg = oauthConfigFor(this.config, provider);
    if (!cfg) return '';
    try {
      const res = await fetch(cfg.userinfoUrl, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
      if (!res.ok) return '';
      const json = (await res.json()) as Record<string, unknown>;
      // Google (OpenID): { email, sub }. Yandex: { login, default_email, real_name }.
      return (
        (json.email as string) ||
        (json.default_email as string) ||
        (json.login as string) ||
        ''
      );
    } catch {
      return '';
    }
  }

  /**
   * Return a currently-valid access token for (user, provider), refreshing it
   * via the stored refresh token when it's expired (or expires within a 60s
   * skew window) and persisting the refreshed token. Returns null if there's no
   * usable token (e.g. refresh failed / no refresh token). A 0 `expiresAt` is
   * treated as "unknown" and used as-is.
   */
  async getValidAccessToken(
    userId: string,
    provider: CalendarProviderName,
    token: CalendarOAuthToken,
  ): Promise<string | null> {
    const SKEW_MS = 60 * 1000;
    const stillValid = token.expiresAt === 0 || Date.now() < token.expiresAt - SKEW_MS;
    if (stillValid) return token.accessToken;
    if (!token.refreshToken) return null;
    try {
      const refreshed = await this.refresh(provider, token.refreshToken);
      this.repo.updateCalendarAccessToken(userId, provider, refreshed.accessToken, refreshed.expiresAt);
      return refreshed.accessToken;
    } catch {
      return null;
    }
  }
}
