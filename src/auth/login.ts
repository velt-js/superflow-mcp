// `npx superflow-mcp login`: sign in with the browser instead of pasting an API key.
// OAuth 2.1 authorization code + PKCE on a loopback redirect (RFC 8252): a one-shot HTTP
// server on 127.0.0.1 receives the code, then the tokens are saved to the credential
// store. The same consent screen as the hosted connector: a new user can sign up there.
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AuthError, discover, exchangeCode, registerClient, type AuthServerMetadata } from "./oauth.ts";
import { challengeFor, createState, createVerifier } from "./pkce.ts";
import { fileStore, defaultCredentialsFile, type CredentialStore, type StoredSession } from "./store.ts";

export const LOGIN_TIMEOUT_MS = 5 * 60_000;
const CALLBACK_PATH = "/callback";

const PAGE = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;line-height:1.5">` +
  `<h1 style="font-size:1.25rem">${title}</h1><p>${body}</p></body></html>`;

/** Opens a URL in the default browser. Best effort: the URL is printed too. */
export function openInBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  try {
    const [command, args] =
      platform === "darwin" ? ["open", [url]] : platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
    const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The printed URL is the fallback.
  }
}

interface CallbackResult {
  code: string;
}

/** Starts the loopback server and resolves its redirect URI and a promise for the code. */
async function startCallbackServer(params: { state: string; timeoutMs: number }): Promise<{
  redirectUri: string;
  code: Promise<CallbackResult>;
  close: () => void;
}> {
  let settle: { resolve: (value: CallbackResult) => void; reject: (error: Error) => void } | undefined;
  const code = new Promise<CallbackResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    const send = (status: number, title: string, body: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(PAGE(title, body));
    };
    if (url.searchParams.get("state") !== params.state) {
      // Not our request (or a forged one): refuse it and keep waiting for the real one.
      send(400, "This sign-in link is not valid", "Go back to the terminal and run the login command again.");
      return;
    }
    const error = url.searchParams.get("error");
    if (error) {
      send(200, "Sign-in cancelled", "Nothing was connected. You can close this tab.");
      settle?.reject(new AuthError(error === "access_denied" ? "The sign-in was cancelled in the browser." : `The sign-in failed in the browser (${error}).`, error));
      return;
    }
    const received = url.searchParams.get("code");
    if (!received) {
      send(400, "This sign-in link is not valid", "Go back to the terminal and run the login command again.");
      return;
    }
    send(200, "Superflow is connected", "You can close this tab and go back to the terminal.");
    settle?.resolve({ code: received });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const timer = setTimeout(() => settle?.reject(new AuthError("The sign-in timed out after 5 minutes. Run the login command again.")), params.timeoutMs);
  const port = (server.address() as AddressInfo).port;
  return {
    redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
    code,
    close: () => {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
    },
  };
}

export function buildAuthorizeUrl(params: {
  metadata: AuthServerMetadata;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL(params.metadata.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  if (params.scope) url.searchParams.set("scope", params.scope);
  return url.toString();
}

export interface LoginOptions {
  authUrl: string;
  apiBaseUrl: string;
  store: CredentialStore;
  /** Space-separated scopes. Default: what the consent screen ticks by default. */
  scope?: string;
  /** Prints a line for the person (stderr). */
  print: (line: string) => void;
  open?: (url: string) => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

/** Runs the whole sign-in and saves it. Resolves with the session and where it was saved. */
export async function login(options: LoginOptions): Promise<{ session: StoredSession; savedTo: string; warning?: string }> {
  const fetchOption = options.fetch ? { fetch: options.fetch } : {};
  const metadata = await discover({ authUrl: options.authUrl, ...fetchOption });
  const verifier = createVerifier();
  const state = createState();
  const callback = await startCallbackServer({ state, timeoutMs: options.timeoutMs ?? LOGIN_TIMEOUT_MS });
  try {
    const clientId = await registerClient({ metadata, redirectUri: callback.redirectUri, ...fetchOption });
    const url = buildAuthorizeUrl({ metadata, clientId, redirectUri: callback.redirectUri, challenge: challengeFor(verifier), state, ...(options.scope ? { scope: options.scope } : {}) });
    options.print("Opening Superflow in your browser to sign in. New to Superflow? You can sign up on the same page.");
    options.print(`If the browser does not open, visit:\n${url}`);
    (options.open ?? openInBrowser)(url);
    const { code } = await callback.code;
    const tokens = await exchangeCode({ metadata, code, verifier, clientId, redirectUri: callback.redirectUri, ...fetchOption, now: options.now ? options.now() : Date.now() });
    const session: StoredSession = {
      version: 1,
      authUrl: options.authUrl.replace(/\/+$/, ""),
      apiBaseUrl: options.apiBaseUrl,
      clientId,
      tokenEndpoint: metadata.tokenEndpoint,
      revocationEndpoint: metadata.revocationEndpoint,
      ...tokens,
    };
    try {
      const preferred = options.store.location;
      await options.store.write(session);
      // A keyring store from chooseCredentialStore falls back to the file on its own: say so.
      const savedTo = options.store.location;
      return savedTo === preferred ? { session, savedTo } : { session, savedTo, warning: `${preferred} refused the sign-in, so it is saved in ${savedTo}, readable only by you.` };
    } catch {
      // A keyring that refuses (locked, no session bus) must not lose a finished sign-in.
      const fallback = fileStore(defaultCredentialsFile(options.env ?? process.env));
      await fallback.write(session);
      return { session, savedTo: fallback.location, warning: `${options.store.location} refused the sign-in, so it is saved in ${fallback.location}, readable only by you.` };
    }
  } finally {
    callback.close();
  }
}
