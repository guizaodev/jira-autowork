import { describe, expect, test } from "bun:test";
import { makeTempDb } from "../helpers";

describe("db / historyForMonth", () => {
  test("mês sem dados → array vazio", () => {
    const { db, cleanup } = makeTempDb();
    try {
      expect(db.historyForMonth("2026-01")).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("retorna apenas os dias do mês pedido, ordenados por data", () => {
    const { db, cleanup } = makeTempDb();
    try {
      db.upsertHistory({
        date: "2026-09-30",
        dayKind: "workday",
        issueKey: "ITAUADQUIR-901",
        worklogId: 30,
        timeSpentSeconds: 28800,
        status: "success",
        detail: "ok",
      });
      db.upsertHistory({
        date: "2026-09-01",
        dayKind: "workday",
        issueKey: "ITAUADQUIR-901",
        worklogId: 1,
        timeSpentSeconds: 28800,
        status: "success",
        detail: "ok",
      });
      db.upsertHistory({
        date: "2026-10-01",
        dayKind: "workday",
        issueKey: "ITAUADQUIR-1001",
        worklogId: 100,
        timeSpentSeconds: 28800,
        status: "success",
        detail: "outro mês",
      });

      const days = db.historyForMonth("2026-09");
      expect(days.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-30"]);
      expect(days.every((d) => d.date.startsWith("2026-09"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("mês com dados mistos devolve cada status e timeSpentSeconds", () => {
    const { db, cleanup } = makeTempDb();
    try {
      const entries = [
        {
          date: "2026-09-01",
          dayKind: "workday" as const,
          issueKey: "ITAUADQUIR-901",
          worklogId: 1,
          timeSpentSeconds: 28800,
          status: "success" as const,
          detail: "dia completo",
        },
        {
          date: "2026-09-02",
          dayKind: "workday" as const,
          issueKey: "ITAUADQUIR-901",
          worklogId: 2,
          timeSpentSeconds: 14400,
          status: "success" as const,
          detail: "meio dia",
        },
        {
          date: "2026-09-03",
          dayKind: "workday" as const,
          issueKey: "ITAUADQUIR-901",
          worklogId: null,
          timeSpentSeconds: 0,
          status: "failed" as const,
          detail: "HTTP 500",
        },
        {
          date: "2026-09-04",
          dayKind: "weekend" as const,
          issueKey: "",
          worklogId: null,
          timeSpentSeconds: 0,
          status: "skipped" as const,
          detail: "fim de semana",
        },
      ];
      for (const entry of entries) db.upsertHistory(entry);

      const days = db.historyForMonth("2026-09");
      expect(days).toHaveLength(4);
      expect(days.map((d) => d.status)).toEqual([
        "success",
        "success",
        "failed",
        "skipped",
      ]);
      expect(days.map((d) => d.timeSpentSeconds)).toEqual([
        28800, 14400, 0, 0,
      ]);

      const totalSuccess = days
        .filter((d) => d.status === "success")
        .reduce((sum, d) => sum + d.timeSpentSeconds, 0);
      expect(totalSuccess).toBe(43200);
    } finally {
      cleanup();
    }
  });

  test("LIKE ancora no traço: '2026-091-01' não entra no mês 2026-09", () => {
    const { db, cleanup } = makeTempDb();
    try {
      db.upsertHistory({
        date: "2026-09-15",
        dayKind: "workday",
        issueKey: "ITAUADQUIR-901",
        worklogId: 1,
        timeSpentSeconds: 28800,
        status: "success",
        detail: "ok",
      });
      db.upsertHistory({
        date: "2026-091-01",
        dayKind: "workday",
        issueKey: "",
        worklogId: null,
        timeSpentSeconds: 99999,
        status: "success",
        detail: "data malformada",
      });

      const days = db.historyForMonth("2026-09");
      expect(days.map((d) => d.date)).toEqual(["2026-09-15"]);
    } finally {
      cleanup();
    }
  });

  test("upsert do mesmo dia no mês atualiza em vez de duplicar", () => {
    const { db, cleanup } = makeTempDb();
    try {
      db.upsertHistory({
        date: "2026-09-01",
        dayKind: "workday",
        issueKey: "ITAUADQUIR-901",
        worklogId: 1,
        timeSpentSeconds: 28800,
        status: "success",
        detail: "ok",
      });
      db.upsertHistory({
        date: "2026-09-01",
        dayKind: "workday",
        issueKey: "ITAUADQUIR-901",
        worklogId: 2,
        timeSpentSeconds: 14400,
        status: "success",
        detail: "corrigido",
      });

      const days = db.historyForMonth("2026-09");
      expect(days).toHaveLength(1);
      expect(days[0]?.worklogId).toBe(2);
      expect(days[0]?.timeSpentSeconds).toBe(14400);
    } finally {
      cleanup();
    }
  });
});
