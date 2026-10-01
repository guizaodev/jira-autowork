import { describe, expect, test } from "bun:test";
import { createAlerter } from "../../src/core/alerter";
import { makeFetchMock, jsonResponse, makeTempDb } from "../helpers";
import { makeJiraMock } from "../helpers";

const COOKIE = "JSESSIONID=abc";

describe("alerter / webhook", () => {
  test("envia POST para a URL configurada", async () => {
    const { db, cleanup } = makeTempDb();
    const mock = makeFetchMock(() => jsonResponse({ ok: true }));
    try {
      db.updateSettings({ alertWebhookUrl: "https://hooks.test/alert" });
      const alerter = createAlerter({
        db,
        jira: makeJiraMock().jira,
        fetchFn: mock.fn,
      });
      await alerter.sendAlert({
        text: "sessão morta",
        severity: "error",
        timestamp: "2026-09-30T09:05:00.000Z",
      });
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0]?.url).toBe("https://hooks.test/alert");
      expect(mock.calls[0]?.init?.method).toBe("POST");
      const body = JSON.parse(String(mock.calls[0]?.init?.body)) as Record<
        string,
        unknown
      >;
      expect(body.text).toBe("sessão morta");
      expect(body.severity).toBe("error");
    } finally {
      cleanup();
    }
  });

  test("sem webhook configurado → log warn, sem fetch", async () => {
    const { db, cleanup } = makeTempDb();
    const mock = makeFetchMock(() => jsonResponse({ ok: true }));
    try {
      const alerter = createAlerter({
        db,
        jira: makeJiraMock().jira,
        fetchFn: mock.fn,
      });
      await alerter.sendAlert({
        text: "x",
        severity: "warn",
        timestamp: "2026-09-30T09:05:00.000Z",
      });
      expect(mock.calls).toHaveLength(0);
      expect(
        db.listLogs(10, "warn").some((l) => l.message.includes("webhook não configurado")),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("probeAndRecord grava SessionInfo e não limpa username em network-error", async () => {
    const { db, cleanup } = makeTempDb();
    try {
      db.updateSettings({ jiraCookie: COOKIE });
      db.setSessionInfo({
        status: "alive",
        lastCheck: null,
        username: "gmarquma",
        displayName: "Guilherme",
      });
      const alerter = createAlerter({
        db,
        jira: makeJiraMock({
          async probeSession() {
            return "network-error";
          },
        }).jira,
      });
      const probe = await alerter.probeAndRecord();
      expect(probe).toBe("network-error");
      const info = db.getSessionInfo();
      expect(info.status).toBe("unknown");
      expect(info.username).toBe("gmarquma");
    } finally {
      cleanup();
    }
  });

  test("probeAndRecord alive atualiza username/displayName", async () => {
    const { db, cleanup } = makeTempDb();
    try {
      db.updateSettings({ jiraCookie: COOKIE });
      const alerter = createAlerter({
        db,
        jira: makeJiraMock().jira,
      });
      const probe = await alerter.probeAndRecord();
      expect(probe).toBe("alive");
      const info = db.getSessionInfo();
      expect(info.status).toBe("alive");
      expect(info.username).toBe("gmarquma");
      expect(info.displayName).toBe("Guilherme Marques Machado");
    } finally {
      cleanup();
    }
  });

  test("probeAndRecord dead marca status dead", async () => {
    const { db, cleanup } = makeTempDb();
    try {
      db.updateSettings({ jiraCookie: COOKIE });
      const alerter = createAlerter({
        db,
        jira: makeJiraMock({
          async probeSession() {
            return "dead";
          },
        }).jira,
      });
      await alerter.probeAndRecord();
      expect(db.getSessionInfo().status).toBe("dead");
    } finally {
      cleanup();
    }
  });
});
