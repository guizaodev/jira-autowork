import { timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";
import { z } from "zod";
import type { AppSettings, SessionInfo } from "../shared/contract";
import type { Db } from "../core/db";
import type { Applier } from "../core/applier";
import type { Alerter } from "../core/alerter";
import type { JiraClient } from "../core/jira";
import { maskCookie } from "./auth";

export interface ServerDeps {
  db: Db;
  applier: Applier;
  alerter: Alerter;
  jira: JiraClient;
  password: string;
  verifySession: (token: string | null | undefined) => boolean;
  issueSession: () => string;
  sessionCookieName: string;
  sessionMaxAgeSeconds: number;
  cookieSecure: boolean | "auto";
}

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const issueKeySchema = z.string().trim().min(1);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function createRoutes(deps: ServerDeps) {
  const { db, applier, alerter, jira, password, verifySession } = deps;

  let runNowInFlight = false;

  const app = new Elysia({ prefix: "/api" })
    .onBeforeHandle(({ cookie, set, path }) => {
      if (path === "/api/login") return;
      const token = cookie[deps.sessionCookieName]?.value as string | undefined;
      if (!verifySession(token)) {
        set.status = 401;
        return { message: "Não autenticado" };
      }
      return undefined;
    })
    .post(
      "/login",
      ({ body, cookie, status, request }) => {
        if (!timingSafeEqualStr(body.password, password)) {
          return status(401, { message: "Senha inválida" });
        }
        const secure =
          deps.cookieSecure === "auto"
            ? request.headers.get("x-forwarded-proto") === "https"
            : deps.cookieSecure;
        cookie[deps.sessionCookieName]?.set({
          value: deps.issueSession(),
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: deps.sessionMaxAgeSeconds,
          secure,
        });
        return new Response(null, { status: 204 });
      },
      { body: t.Object({ password: t.String() }) },
    )
    .post("/logout", ({ cookie }) => {
      cookie[deps.sessionCookieName]?.remove();
      return new Response(null, { status: 204 });
    })
    .get("/session", (): SessionInfo => db.getSessionInfo())
    .get("/settings", (): AppSettings => {
      const settings = db.getSettings();
      return { ...settings, jiraCookie: maskCookie(settings.jiraCookie) };
    })
    .put(
      "/settings",
      ({ body }): AppSettings => {
        const patch: {
          holidayIssueKey?: string;
          vacationIssueKey?: string;
          alertWebhookUrl?: string;
          jiraCookie?: string;
        } = {};
        if (body.holidayIssueKey !== undefined) patch.holidayIssueKey = body.holidayIssueKey;
        if (body.vacationIssueKey !== undefined) patch.vacationIssueKey = body.vacationIssueKey;
        if (body.alertWebhookUrl !== undefined) patch.alertWebhookUrl = body.alertWebhookUrl;
        if (body.jiraCookie !== undefined && body.jiraCookie.trim().length > 0) {
          patch.jiraCookie = body.jiraCookie.trim();
        }
        db.updateSettings(patch);
        const settings = db.getSettings();
        return { ...settings, jiraCookie: maskCookie(settings.jiraCookie) };
      },
      {
        body: t.Object({
          holidayIssueKey: t.Optional(t.String()),
          vacationIssueKey: t.Optional(t.String()),
          alertWebhookUrl: t.Optional(t.String()),
          jiraCookie: t.Optional(t.String()),
        }),
      },
    )
    .get("/monthly-tasks", () => db.listMonthlyTasks())
    .put(
      "/monthly-tasks",
      ({ body, status }) => {
        const parsed = z.object({ month: monthSchema, issueKey: issueKeySchema }).safeParse(body);
        if (!parsed.success) return status(400, { message: "month/issueKey inválidos" });
        db.upsertMonthlyTask(parsed.data.month, parsed.data.issueKey);
        return parsed.data;
      },
      { body: t.Object({ month: t.String(), issueKey: t.String() }) },
    )
    .delete("/monthly-tasks/:month", ({ params, status }) => {
      if (!db.deleteMonthlyTask(params.month)) {
        return status(404, { message: "Mapping não encontrado" });
      }
      return new Response(null, { status: 204 });
    })
    .get("/vacations", () => db.listVacations())
    .post(
      "/vacations",
      ({ body, status }) => {
        const parsed = z
          .object({ startDate: dateSchema, endDate: dateSchema, note: z.string().default("") })
          .safeParse(body);
        if (!parsed.success) return status(400, { message: "Período inválido" });
        if (parsed.data.endDate < parsed.data.startDate) {
          return status(400, { message: "endDate anterior a startDate" });
        }
        const id = db.addVacation(parsed.data.startDate, parsed.data.endDate, parsed.data.note);
        return { id, ...parsed.data };
      },
      {
        body: t.Object({
          startDate: t.String(),
          endDate: t.String(),
          note: t.Optional(t.String()),
        }),
      },
    )
    .delete("/vacations/:id", ({ params, status }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || !db.deleteVacation(id)) {
        return status(404, { message: "Período não encontrado" });
      }
      return new Response(null, { status: 204 });
    })
    .get(
      "/history",
      ({ query }) => {
        const limit = clamp(Number(query.limit ?? 100), 1, 500);
        const offset = Math.max(0, Number(query.offset ?? 0));
        return db.listHistory(limit, offset);
      },
      { query: t.Object({ limit: t.Optional(t.String()), offset: t.Optional(t.String()) }) },
    )
    .get(
      "/logs",
      ({ query }) => {
        const limit = clamp(Number(query.limit ?? 100), 1, 500);
        const level =
          query.level === "info" || query.level === "warn" || query.level === "error"
            ? query.level
            : null;
        return db.listLogs(limit, level);
      },
      { query: t.Object({ limit: t.Optional(t.String()), level: t.Optional(t.String()) }) },
    )
    .post("/run-now", async ({ status }) => {
      if (runNowInFlight) {
        return status(409, { message: "Execução já em andamento" });
      }
      runNowInFlight = true;
      try {
        return await applier.runNow();
      } finally {
        runNowInFlight = false;
      }
    })
    .post("/test-connection", async () => {
      const cookie = db.getSettings().jiraCookie;
      if (!cookie) return { ok: false, message: "Cookie Jira não configurado" };
      try {
        const myself = await jira.getMyself(cookie);
        return { ok: true, message: `Conectado como ${myself.displayName}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message };
      }
    })
    .post("/keepalive", async () => {
      const probe = await alerter.probeAndRecord();
      return { probe };
    });

  return app;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    return timingSafeEqual(
      Buffer.concat([bufferA, Buffer.alloc(64 - (bufferA.length % 64 || 64))]),
      Buffer.concat([bufferB, Buffer.alloc(64 - (bufferB.length % 64 || 64))]),
    ) && a === b;
  }
  return timingSafeEqual(bufferA, bufferB);
}
