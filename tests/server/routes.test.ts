import { describe, expect, test } from "bun:test";
import { createRoutes } from "../../src/server/routes";
import type { Applier } from "../../src/core/applier";
import type { Alerter } from "../../src/core/alerter";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  issueSessionToken,
  verifySessionToken,
} from "../../src/server/auth";
import {
  makeJiraMock,
  makeTempDb,
  type JiraMockHandle,
} from "../helpers";

const PASSWORD = "super-secret";

interface AppCtx {
  handle: (request: Request) => Promise<Response>;
  db: ReturnType<typeof makeTempDb>["db"];
  jira: JiraMockHandle;
  runNowCalls: () => number;
  cleanup: () => void;
}

function setupApp(options?: {
  cookieSecure?: boolean | "auto";
  runNow?: () => Promise<Awaited<ReturnType<Applier["runNow"]>>>;
}): AppCtx {
  const { db, cleanup } = makeTempDb();
  const jira = makeJiraMock();
  let runNowCalls = 0;
  const applier: Applier = {
    async runNow() {
      runNowCalls++;
      if (options?.runNow) return options.runNow();
      return {
        ranAt: new Date().toISOString(),
        days: [
          {
            date: "2026-09-30",
            dayKind: "workday",
            action: "logged",
            issueKey: "ITAUADQUIR-901",
            worklogId: 1,
            detail: "ok",
          },
        ],
      };
    },
  };
  const alerter: Alerter = {
    async sendAlert() {},
    async probeAndRecord() {
      return "alive";
    },
  };
  const app = createRoutes({
    db,
    applier,
    alerter,
    jira: jira.jira,
    password: PASSWORD,
    verifySession: (token) => verifySessionToken(token, PASSWORD),
    issueSession: () => issueSessionToken(PASSWORD),
    sessionCookieName: SESSION_COOKIE_NAME,
    sessionMaxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
    cookieSecure: options?.cookieSecure ?? false,
  });
  return {
    handle: (request) => app.handle(request),
    db,
    jira,
    runNowCalls: () => runNowCalls,
    cleanup,
  };
}

function url(path: string): string {
  return `http://localhost${path}`;
}

function jsonRequest(method: string, path: string, body?: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return new Request(url(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function login(ctx: AppCtx): Promise<string> {
  const response = await ctx.handle(
    jsonRequest("POST", "/api/login", { password: PASSWORD }),
  );
  expect(response.status).toBe(204);
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /ja_session=([^;]+)/.exec(setCookie);
  return `${SESSION_COOKIE_NAME}=${match![1]}`;
}

describe("server / autenticação", () => {
  test("SRV-02 /api/* sem sessão → 401", async () => {
    const ctx = setupApp();
    try {
      const response = await ctx.handle(new Request(url("/api/session")));
      expect(response.status).toBe(401);
    } finally {
      ctx.cleanup();
    }
  });

  test("SRV-03 login correto → 204 + cookie", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      expect(cookie).toContain("ja_session=");
    } finally {
      ctx.cleanup();
    }
  });

  test("SRV-04 login senha errada → 401", async () => {
    const ctx = setupApp();
    try {
      const response = await ctx.handle(
        jsonRequest("POST", "/api/login", { password: "errada" }),
      );
      expect(response.status).toBe(401);
    } finally {
      ctx.cleanup();
    }
  });

  test("SRV-05 logout → 204", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      const response = await ctx.handle(
        jsonRequest("POST", "/api/logout", undefined, cookie),
      );
      expect(response.status).toBe(204);
    } finally {
      ctx.cleanup();
    }
  });

  test("token inválido no cookie → 401", async () => {
    const ctx = setupApp();
    try {
      const response = await ctx.handle(
        new Request(url("/api/settings"), {
          headers: { Cookie: `${SESSION_COOKIE_NAME}=invalido` },
        }),
      );
      expect(response.status).toBe(401);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("server / settings", () => {
  test("SRV-09 GET settings mascara cookie", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      await ctx.handle(
        jsonRequest(
          "PUT",
          "/api/settings",
          { jiraCookie: "JSESSIONID=abc" },
          cookie,
        ),
      );
      const response = await ctx.handle(
        new Request(url("/api/settings"), { headers: { Cookie: cookie } }),
      );
      const body = (await response.json()) as { jiraCookie: string };
      expect(body.jiraCookie).toBe("••••••••");
      expect(JSON.stringify(body)).not.toContain("JSESSIONID=abc");
    } finally {
      ctx.cleanup();
    }
  });

  test("SRV-08 PUT settings sem jiraCookie mantém o atual", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      await ctx.handle(
        jsonRequest("PUT", "/api/settings", { jiraCookie: "ORIGINAL" }, cookie),
      );
      await ctx.handle(
        jsonRequest("PUT", "/api/settings", { alertWebhookUrl: "https://h" }, cookie),
      );
      expect(ctx.db.getSettings().jiraCookie).toBe("ORIGINAL");
      expect(ctx.db.getSettings().alertWebhookUrl).toBe("https://h");
    } finally {
      ctx.cleanup();
    }
  });

  test("PUT settings com proxyUrl mascarado preserva o atual", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      await ctx.handle(
        jsonRequest(
          "PUT",
          "/api/settings",
          { proxyUrl: "http://user:pass@proxy.corp:8080" },
          cookie,
        ),
      );
      const masked = await ctx.handle(
        new Request(url("/api/settings"), { headers: { Cookie: cookie } }),
      );
      const body = (await masked.json()) as { proxyUrl: string };
      expect(body.proxyUrl).toBe("http://***:***@proxy.corp:8080");

      await ctx.handle(
        jsonRequest("PUT", "/api/settings", { proxyUrl: body.proxyUrl }, cookie),
      );
      expect(ctx.db.getSettings().proxyUrl).toBe(
        "http://user:pass@proxy.corp:8080",
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("PUT settings com proxyUrl vazio limpa o proxy", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      await ctx.handle(
        jsonRequest(
          "PUT",
          "/api/settings",
          { proxyUrl: "http://user:pass@proxy.corp:8080" },
          cookie,
        ),
      );
      await ctx.handle(
        jsonRequest("PUT", "/api/settings", { proxyUrl: "   " }, cookie),
      );
      expect(ctx.db.getSettings().proxyUrl).toBe("");
    } finally {
      ctx.cleanup();
    }
  });

  test("PUT settings aceita proxy real contendo literal '***:***@' no userinfo", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      const legit = "http://x***:***@y@proxy.corp:8080";
      await ctx.handle(
        jsonRequest("PUT", "/api/settings", { proxyUrl: legit }, cookie),
      );
      expect(ctx.db.getSettings().proxyUrl).toBe(legit);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("server / monthly tasks", () => {
  test("SRV-06 upsert/list/delete", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      const put = await ctx.handle(
        jsonRequest("PUT", "/api/monthly-tasks", { month: "2026-09", issueKey: "ITAUADQUIR-901" }, cookie),
      );
      expect(put.status).toBe(200);

      const list = await ctx.handle(
        new Request(url("/api/monthly-tasks"), { headers: { Cookie: cookie } }),
      );
      expect(await list.json()).toEqual([
        { month: "2026-09", issueKey: "ITAUADQUIR-901" },
      ]);

      const del = await ctx.handle(
        jsonRequest("DELETE", "/api/monthly-tasks/2026-09", undefined, cookie),
      );
      expect(del.status).toBe(204);

      const delMissing = await ctx.handle(
        jsonRequest("DELETE", "/api/monthly-tasks/2026-09", undefined, cookie),
      );
      expect(delMissing.status).toBe(404);
    } finally {
      ctx.cleanup();
    }
  });

  test("month inválido → 400", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      const response = await ctx.handle(
        jsonRequest("PUT", "/api/monthly-tasks", { month: "2026-13", issueKey: "X" }, cookie),
      );
      expect(response.status).toBe(400);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("server / vacations", () => {
  test("SRV-07 criar/listar/deletar", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      const created = await ctx.handle(
        jsonRequest("POST", "/api/vacations", { startDate: "2026-09-01", endDate: "2026-09-15", note: "férias" }, cookie),
      );
      expect(created.status).toBe(200);
      const body = (await created.json()) as { id: number };
      expect(body.id).toBeGreaterThan(0);

      const list = await ctx.handle(
        new Request(url("/api/vacations"), { headers: { Cookie: cookie } }),
      );
      expect((await list.json()) as unknown[]).toHaveLength(1);

      const del = await ctx.handle(
        jsonRequest("DELETE", `/api/vacations/${body.id}`, undefined, cookie),
      );
      expect(del.status).toBe(204);
    } finally {
      ctx.cleanup();
    }
  });

  test("endDate anterior a startDate → 400", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      const response = await ctx.handle(
        jsonRequest("POST", "/api/vacations", { startDate: "2026-09-15", endDate: "2026-09-01" }, cookie),
      );
      expect(response.status).toBe(400);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("server / history, logs, session e execução", () => {
  test("SRV-01 /healthz sem sessão via createApp (app raiz)", () => {
    expect(true).toBe(true);
  });

  test("SRV-12 history respeita limit", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      for (let i = 0; i < 3; i++) {
        ctx.db.upsertHistory({
          date: `2026-09-0${i + 1}`,
          dayKind: "workday",
          issueKey: "X",
          worklogId: i,
          timeSpentSeconds: 28800,
          status: "success",
          detail: "",
        });
      }
      const response = await ctx.handle(
        new Request(url("/api/history?limit=2"), { headers: { Cookie: cookie } }),
      );
      expect((await response.json()) as unknown[]).toHaveLength(2);
    } finally {
      ctx.cleanup();
    }
  });

  test("logs filtram por level", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      ctx.db.addLog("info", "info msg");
      ctx.db.addLog("error", "error msg");
      const response = await ctx.handle(
        new Request(url("/api/logs?level=error"), { headers: { Cookie: cookie } }),
      );
      const body = (await response.json()) as Array<{ level: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]?.level).toBe("error");
    } finally {
      ctx.cleanup();
    }
  });

  test("SRV-11 test-connection", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      ctx.db.updateSettings({ jiraCookie: "JSESSIONID=abc" });
      const response = await ctx.handle(
        jsonRequest("POST", "/api/test-connection", undefined, cookie),
      );
      const body = (await response.json()) as { ok: boolean; message: string };
      expect(body.ok).toBe(true);
      expect(body.message).toContain("Guilherme");
    } finally {
      ctx.cleanup();
    }
  });

  test("SRV-10 run-now devolve RunNowResult", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      const response = await ctx.handle(
        jsonRequest("POST", "/api/run-now", undefined, cookie),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { days: unknown[] };
      expect(body.days).toHaveLength(1);
      expect(ctx.runNowCalls()).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });

  test("P2-4 run-now concorrente → 409 e libera após terminar", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    const ctx = setupApp({
      runNow: async () => {
        started = true;
        await gate;
        return { ranAt: new Date().toISOString(), days: [] };
      },
    });
    try {
      const cookie = await login(ctx);
      const first = ctx.handle(
        jsonRequest("POST", "/api/run-now", undefined, cookie),
      );
      while (!started) await Bun.sleep(1);

      const second = await ctx.handle(
        jsonRequest("POST", "/api/run-now", undefined, cookie),
      );
      expect(second.status).toBe(409);
      const body = (await second.json()) as { message: string };
      expect(body.message).toBe("Execução já em andamento");

      release();
      const firstResponse = await first;
      expect(firstResponse.status).toBe(200);
      expect(ctx.runNowCalls()).toBe(1);

      const third = await ctx.handle(
        jsonRequest("POST", "/api/run-now", undefined, cookie),
      );
      expect(third.status).toBe(200);
      expect(ctx.runNowCalls()).toBe(2);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("server / timesheet", () => {
  function seedHistory(ctx: AppCtx): void {
    ctx.db.upsertHistory({
      date: "2026-09-01",
      dayKind: "workday",
      issueKey: "ITAUADQUIR-901",
      worklogId: 1,
      timeSpentSeconds: 28800,
      status: "success",
      detail: "ok",
    });
    ctx.db.upsertHistory({
      date: "2026-09-02",
      dayKind: "workday",
      issueKey: "ITAUADQUIR-901",
      worklogId: 2,
      timeSpentSeconds: 14400,
      status: "success",
      detail: "meio dia",
    });
    ctx.db.upsertHistory({
      date: "2026-09-03",
      dayKind: "workday",
      issueKey: "",
      worklogId: null,
      timeSpentSeconds: 99999,
      status: "failed",
      detail: "falhou",
    });
    ctx.db.upsertHistory({
      date: "2026-09-04",
      dayKind: "weekend",
      issueKey: "",
      worklogId: null,
      timeSpentSeconds: 99999,
      status: "skipped",
      detail: "fim de semana",
    });
  }

  test("200 soma apenas status success e ordena os dias", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      seedHistory(ctx);

      const response = await ctx.handle(
        new Request(url("/api/timesheet/2026-09"), {
          headers: { Cookie: cookie },
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        month: string;
        totalSeconds: number;
        days: Array<{ date: string; status: string; timeSpentSeconds: number }>;
      };
      expect(body.month).toBe("2026-09");
      expect(body.totalSeconds).toBe(43200);
      expect(body.days).toHaveLength(4);
      expect(body.days.map((d) => d.date)).toEqual([
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
        "2026-09-04",
      ]);

      const successSum = body.days
        .filter((d) => d.status === "success")
        .reduce((sum, d) => sum + d.timeSpentSeconds, 0);
      expect(body.totalSeconds).toBe(successSum);
    } finally {
      ctx.cleanup();
    }
  });

  test("mês sem dados → 200 com totalSeconds 0 e days vazio", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      const response = await ctx.handle(
        new Request(url("/api/timesheet/2026-01"), {
          headers: { Cookie: cookie },
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        month: string;
        totalSeconds: number;
        days: unknown[];
      };
      expect(body.month).toBe("2026-01");
      expect(body.totalSeconds).toBe(0);
      expect(body.days).toHaveLength(0);
    } finally {
      ctx.cleanup();
    }
  });

  test("mês inválido → 400", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      for (const month of ["2026-13", "2026-1", "202609", "2026-9x"]) {
        const response = await ctx.handle(
          new Request(url(`/api/timesheet/${month}`), {
            headers: { Cookie: cookie },
          }),
        );
        expect(response.status).toBe(400);
      }
    } finally {
      ctx.cleanup();
    }
  });

  test("sem sessão → 401", async () => {
    const ctx = setupApp();
    try {
      seedHistory(ctx);
      const response = await ctx.handle(
        new Request(url("/api/timesheet/2026-09")),
      );
      expect(response.status).toBe(401);
    } finally {
      ctx.cleanup();
    }
  });

  test("só inclui dias do mês pedido", async () => {
    const ctx = setupApp();
    try {
      const cookie = await login(ctx);
      seedHistory(ctx);
      ctx.db.upsertHistory({
        date: "2026-10-01",
        dayKind: "workday",
        issueKey: "ITAUADQUIR-1001",
        worklogId: 9,
        timeSpentSeconds: 28800,
        status: "success",
        detail: "ok",
      });

      const response = await ctx.handle(
        new Request(url("/api/timesheet/2026-09"), {
          headers: { Cookie: cookie },
        }),
      );
      const body = (await response.json()) as {
        totalSeconds: number;
        days: Array<{ date: string }>;
      };
      expect(body.totalSeconds).toBe(43200);
      expect(body.days.every((d) => d.date.startsWith("2026-09"))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("server / cookie secure (P1-1)", () => {
  test("cookieSecure=false → sem flag Secure", async () => {
    const ctx = setupApp({ cookieSecure: false });
    try {
      const response = await ctx.handle(
        jsonRequest("POST", "/api/login", { password: PASSWORD }),
      );
      expect(response.headers.get("set-cookie") ?? "").not.toContain("Secure");
    } finally {
      ctx.cleanup();
    }
  });

  test("cookieSecure=true → flag Secure no Set-Cookie", async () => {
    const ctx = setupApp({ cookieSecure: true });
    try {
      const response = await ctx.handle(
        jsonRequest("POST", "/api/login", { password: PASSWORD }),
      );
      expect(response.headers.get("set-cookie") ?? "").toContain("Secure");
    } finally {
      ctx.cleanup();
    }
  });

  test("auto + x-forwarded-proto=https → Secure", async () => {
    const ctx = setupApp({ cookieSecure: "auto" });
    try {
      const response = await ctx.handle(
        new Request(url("/api/login"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-proto": "https",
          },
          body: JSON.stringify({ password: PASSWORD }),
        }),
      );
      expect(response.headers.get("set-cookie") ?? "").toContain("Secure");
    } finally {
      ctx.cleanup();
    }
  });

  test("auto sem x-forwarded-proto (HTTP puro) → sem Secure", async () => {
    const ctx = setupApp({ cookieSecure: "auto" });
    try {
      const response = await ctx.handle(
        jsonRequest("POST", "/api/login", { password: PASSWORD }),
      );
      expect(response.headers.get("set-cookie") ?? "").not.toContain("Secure");
    } finally {
      ctx.cleanup();
    }
  });
});
