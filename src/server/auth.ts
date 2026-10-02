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

export const PROXY_MASK = "***:***@";

export function maskProxy(proxyUrl: string): string {
  const trimmed = proxyUrl.trim();
  if (!trimmed) return "";
  const schemeEnd = trimmed.indexOf("://");
  if (schemeEnd >= 0) {
    try {
      const url = new URL(trimmed);
      if (!url.username && !url.password) return trimmed;
      const port = url.port ? `:${url.port}` : "";
      return `${url.protocol}//${PROXY_MASK}${url.hostname}${port}`;
    } catch {
      return maskStructural(trimmed, schemeEnd);
    }
  }
  return maskStructural(trimmed, -1);
}

function maskStructural(trimmed: string, schemeEnd: number): string {
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return trimmed;
  const scheme = schemeEnd >= 0 ? trimmed.slice(0, schemeEnd + 3) : "";
  return `${scheme}${PROXY_MASK}${trimmed.slice(at + 1)}`;
}

export function isMaskedProxy(proxyUrl: string): boolean {
  const trimmed = proxyUrl.trim();
  if (!trimmed.includes(PROXY_MASK)) return false;
  const schemeEnd = trimmed.indexOf("://");
  const rest = schemeEnd >= 0 ? trimmed.slice(schemeEnd + 3) : trimmed;
  const at = rest.lastIndexOf("@");
  return at >= 0 && rest.slice(0, at + 1) === PROXY_MASK;
}
