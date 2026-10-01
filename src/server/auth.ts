import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE_NAME = "ja_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function secretFrom(password: string): Buffer {
  return createHash("sha256").update(`jira-autowork:${password}`).digest();
}

export function issueSessionToken(password: string, now = Date.now()): string {
  const expires = String(now + SESSION_TTL_MS);
  const nonce = randomBytes(16).toString("base64url");
  const signature = createHmac("sha256", secretFrom(password))
    .update(`${expires}.${nonce}`)
    .digest("base64url");
  return `${expires}.${nonce}.${signature}`;
}

export function verifySessionToken(
  token: string | undefined | null,
  password: string,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const [expires, nonce, signature] = token.split(".");
  if (!expires || !nonce || !signature) return false;
  const expected = createHmac("sha256", secretFrom(password))
    .update(`${expires}.${nonce}`)
    .digest("base64url");
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return false;
  const expiry = Number(expires);
  return Number.isFinite(expiry) && expiry > now;
}

export function maskCookie(cookie: string): string {
  return cookie.trim().length > 0 ? "••••••••" : "";
}
