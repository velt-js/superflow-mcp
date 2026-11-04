// Keeps a signed-in session's access token current: refreshes it a minute before it
// expires, and once after a 401, saving each rotated pair so the next start uses it.
import type { TokenProvider } from "../client/api.ts";
import type { Logger } from "../lib/logger.ts";
import { silentLogger } from "../lib/logger.ts";
import { AuthError, refreshTokens } from "./oauth.ts";
import type { CredentialStore, StoredSession } from "./store.ts";

const EARLY_REFRESH_MS = 60_000;

export interface SessionTokenProviderOptions {
  session: StoredSession;
  store: CredentialStore;
  logger?: Logger;
  fetch?: typeof fetch;
  now?: () => number;
}

export class SessionTokenProvider implements TokenProvider {
  private session: StoredSession;
  /** The pair before the last rotation: still redacted, since logs may quote it. */
  private previous: StoredSession | null = null;
  private inFlight: Promise<string | null> | null = null;
  private dead = false;

  private readonly options: SessionTokenProviderOptions;

  constructor(options: SessionTokenProviderOptions) {
    this.options = options;
    this.session = options.session;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  /** The secrets this provider holds now (and the pair before), for the logger's redaction list. */
  secrets(): string[] {
    const held = [this.session.accessToken, this.session.refreshToken];
    if (this.previous) held.push(this.previous.accessToken, this.previous.refreshToken);
    return held;
  }

  async token(): Promise<string> {
    if (this.session.expiresAt - EARLY_REFRESH_MS > this.now()) return this.session.accessToken;
    const fresh = await this.refresh();
    // A failed refresh still sends the old token: the API answers 401 with its own message.
    return fresh ?? this.session.accessToken;
  }

  /**
   * One refresh at a time; concurrent callers share it. Null when the sign-in is over. An ended
   * sign-in reads the store again first: `login` (or another process) may have saved a new one
   * since, and then this one carries on with it instead of staying signed out until a restart.
   */
  refresh(): Promise<string | null> {
    if (!this.inFlight) {
      this.inFlight = (this.dead ? this.revive() : this.doRefresh()).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  /** After the sign-in ended: carry on only when the store now holds a different one. */
  private async revive(): Promise<string | null> {
    let stored: StoredSession | null;
    try {
      stored = await this.options.store.read();
    } catch {
      return null;
    }
    if (!stored || stored.refreshToken === this.session.refreshToken) return null;
    this.adopt(stored);
    this.dead = false;
    if (stored.expiresAt - EARLY_REFRESH_MS > this.now()) return stored.accessToken;
    return this.doRefresh();
  }

  private async doRefresh(): Promise<string | null> {
    const logger = this.options.logger ?? silentLogger;
    try {
      return await this.refreshAndSave(this.session);
    } catch (error) {
      if (error instanceof AuthError && (error.oauthError === "invalid_grant" || error.oauthError === "invalid_client")) {
        // Another process sharing this sign-in may have rotated the refresh token first.
        const recovered = await this.recoverFromStore();
        if (recovered) return recovered;
        this.dead = true;
        logger.error("The Superflow sign-in has ended (revoked or expired). Run npx superflow-mcp login again.");
        return null;
      }
      logger.warn("Could not renew the Superflow sign-in. It will be tried again on the next call.");
      return null;
    }
  }

  private adopt(next: StoredSession): void {
    if (next.accessToken !== this.session.accessToken) this.previous = this.session;
    this.session = next;
  }

  /** Refreshes from `from`, keeps the rotated pair and saves it. Throws what the token endpoint answered. */
  private async refreshAndSave(from: StoredSession): Promise<string> {
    const logger = this.options.logger ?? silentLogger;
    const tokens = await refreshTokens({
      tokenEndpoint: from.tokenEndpoint,
      refreshToken: from.refreshToken,
      clientId: from.clientId,
      now: this.now(),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    this.adopt({ ...from, ...tokens, scope: tokens.scope || from.scope });
    try {
      await this.options.store.write(this.session);
    } catch {
      logger.warn("The renewed Superflow sign-in could not be saved. Run npx superflow-mcp login if the next start fails.");
    }
    return this.session.accessToken;
  }

  /**
   * After the server refused our refresh token: when the store holds a different one (another
   * MCP process refreshed and saved its rotated pair), use that sign-in instead of ending
   * this one. Its access token if it is still fresh, else one refresh with its refresh token.
   * Null when the store has nothing newer, or that refresh fails too.
   */
  private async recoverFromStore(): Promise<string | null> {
    let stored: StoredSession | null;
    try {
      stored = await this.options.store.read();
    } catch {
      return null;
    }
    if (!stored || stored.refreshToken === this.session.refreshToken) return null;
    this.adopt(stored);
    if (stored.expiresAt - EARLY_REFRESH_MS > this.now()) return stored.accessToken;
    try {
      return await this.refreshAndSave(stored);
    } catch {
      return null;
    }
  }
}
