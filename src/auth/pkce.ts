// PKCE (RFC 7636, S256) and the OAuth `state` value for `superflow-mcp login`.
import { createHash, randomBytes } from "node:crypto";

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh code verifier: 32 random bytes, 43 base64url characters. */
export function createVerifier(): string {
  return base64url(randomBytes(32));
}

/** The S256 challenge for a verifier. */
export function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** A fresh `state`, compared on the callback so a forged redirect is refused. */
export function createState(): string {
  return base64url(randomBytes(16));
}
