import { Elysia } from "elysia";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Db } from "../core/db";
import { createRoutes } from "./routes";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  issueSessionToken,
  verifySessionToken,
} from "./auth";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export interface AppDeps {
  db: Db;
  applier: Parameters<typeof createRoutes>[0]["applier"];
  alerter: Parameters<typeof createRoutes>[0]["alerter"];
  jira: Parameters<typeof createRoutes>[0]["jira"];
  password: string;
  webDistDir: string;
  cookieSecure?: boolean | "auto";
}

function resolveCookieSecure(explicit?: boolean | "auto"): boolean | "auto" {
  if (explicit !== undefined) return explicit;
  const raw = process.env.PANEL_COOKIE_SECURE;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return "auto";
}

export function createApp(deps: AppDeps) {
  const { password } = deps;
  const distDir = path.resolve(deps.webDistDir);
  const indexPath = path.join(distDir, "index.html");
  const cookieSecure = resolveCookieSecure(deps.cookieSecure);

  const routes = createRoutes({
    db: deps.db,
    applier: deps.applier,
    alerter: deps.alerter,
    jira: deps.jira,
    password,
    verifySession: (token) => verifySessionToken(token, password),
    issueSession: () => issueSessionToken(password),
    sessionCookieName: SESSION_COOKIE_NAME,
    sessionMaxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
    cookieSecure,
  });

  return new Elysia()
    .get("/healthz", () => ({ status: "ok" }))
    .use(routes)
    .get("/*", ({ params, set }) => {
      const raw = (params as { "*"?: string })["*"] ?? "";
      const relative = raw.replace(/^\/+/, "");
      const candidate = path.resolve(distDir, relative);
      if (
        relative.length > 0 &&
        candidate.startsWith(distDir + path.sep) &&
        existsSync(candidate) &&
        Bun.file(candidate).type !== ""
      ) {
        return serveFile(candidate);
      }
      if (relative.startsWith("api/")) {
        set.status = 404;
        return { message: "Rota não encontrada" };
      }
      if (existsSync(indexPath)) {
        return serveFile(indexPath);
      }
      set.status = 404;
      return { message: "Painel não compilado (rode bun run build)" };
    });
}

function serveFile(filePath: string): Response {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] ?? "application/octet-stream";
  const headers: Record<string, string> = { "Content-Type": type };
  if (ext === ".html") {
    headers["Cache-Control"] = "no-cache";
  } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  return new Response(Bun.file(filePath), { headers });
}
