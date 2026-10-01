import { describe, expect, test } from "bun:test";
import { createApplier, BACKFILL_WINDOW_DAYS } from "../../src/core/applier";
import type { Alerter } from "../../src/core/alerter";
import type { HolidayStore } from "../../src/core/holidays";
import type { Db } from "../../src/core/db";
import { WORK_SECONDS_PER_DAY } from "../../src/core/jira";
import {
  emptyHolidaySet,
  holidaySet,
  makeJiraMock,
  makeTempDb,
  type JiraMockHandle,
} from "../helpers";

const COOKIE = "JSESSIONID=abc; atlassian.xsrf.token=tok";

function makeHolidayStore(): HolidayStore {
  return {
    async loadYear(year: number) {
      if (year !== 2026) return emptyHolidaySet(year);
      return holidaySet(2026, [
        { date: "2026-01-01", name: "Ano Novo" },
        { date: "2026-04-03", name: "Sexta-Feira Santa" },
        { date: "2026-04-21", name: "Dia de Tiradentes" },
        { date: "2026-05-01", name: "Dia do Trabalho" },
        { date: "2026-09-07", name: "Independência do Brasil" },
        { date: "2026-10-12", name: "Nossa Senhora Aparecida" },
        { date: "2026-11-02", name: "Dia de Finados" },
        { date: "2026-11-15", name: "Proclamação da República" },
        { date: "2026-11-20", name: "Consciência Negra" },
        { date: "2026-12-25", name: "Natal" },
        { date: "2026-08-31", name: "Aniversário de Uberlândia" },
      ]);
    },
  };
}

function makeAlerter(): { alerter: Alerter; alerts: string[] } {
  const alerts: string[] = [];
  const alerter: Alerter = {
    async sendAlert(payload) {
      alerts.push(`${payload.severity}:${payload.text}`);
    },
    async probeAndRecord() {
      return "alive";
    },
  };
  return { alerter, alerts };
}

function setup(options?: {
  now?: Date;
  jiraOverrides?: Partial<JiraMockHandle["jira"]>;
  monthlyTasks?: Array<[string, string]>;
  vacations?: Array<[string, string]>;
  cookie?: string | null;
  sessionUsername?: string;
}): {
  db: Db;
  jira: JiraMockHandle;
  alerts: string[];
  applier: ReturnType<typeof createApplier>;
  cleanup: () => void;
} {
  const { db, cleanup } = makeTempDb();
  const jira = makeJiraMock(options?.jiraOverrides);
  const { alerter, alerts } = makeAlerter();
  const now = options?.now ?? new Date("2026-09-30T12:00:00Z");

  for (const [month, issueKey] of options?.monthlyTasks ?? []) {
    db.upsertMonthlyTask(month, issueKey);
  }
  for (const [startDate, endDate] of options?.vacations ?? []) {
    db.addVacation(startDate, endDate, "férias");
  }
  const cookie = options?.cookie === undefined ? COOKIE : options.cookie;
  if (cookie !== null) db.updateSettings({ jiraCookie: cookie });
  db.setSessionInfo({
    status: "alive",
    lastCheck: now.toISOString(),
    username: options?.sessionUsername ?? "gmarquma",
    displayName: "Guilherme",
  });

  const applier = createApplier({
    db,
    jira: jira.jira,
    holidays: makeHolidayStore(),
    alerter,
    now: () => now,
  });
  return { db, jira, alerts, applier, cleanup };
}

describe("applier / apontamento normal", () => {
  test("APP-01 posta 1 worklog com payload correto e grava ledger success", async () => {
    const ctx = setup({ monthlyTasks: [["2026-09", "ITAUADQUIR-901"]] });
    try {
      const result = await ctx.applier.runNow();
      const today = result.days.find((d) => d.date === "2026-09-30");
      expect(today?.action).toBe("logged");
      expect(today?.issueKey).toBe("ITAUADQUIR-901");
      expect(today?.worklogId).toBeGreaterThan(0);

      const todayLog = ctx.jira.worklogs.find((w) =>
        w.started.startsWith("2026-09-30"),
      );
      expect(todayLog).toBeDefined();
      expect(todayLog!.started).toBe("2026-09-30T09:00:00.000-0300");
      expect(todayLog!.timeSpentSeconds).toBe(WORK_SECONDS_PER_DAY);
      expect(todayLog!.issueKey).toBe("ITAUADQUIR-901");

      const entry = ctx.db.historyByDate("2026-09-30");
      expect(entry?.status).toBe("success");
      expect(entry?.dayKind).toBe("workday");
      expect(entry?.worklogId).toBe(today?.worklogId);
    } finally {
      ctx.cleanup();
    }
  });

  test("sem cookie → failed, sem POST", async () => {
    const ctx = setup({
      monthlyTasks: [["2026-09", "ITAUADQUIR-901"]],
      cookie: null,
    });
    try {
      const result = await ctx.applier.runNow();
      const today = result.days.find((d) => d.date === "2026-09-30");
      expect(today?.action).toBe("failed");
      expect(ctx.jira.worklogs).toHaveLength(0);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("applier / feriado e férias", () => {
  test("feriado usa holiday issue", async () => {
    const ctx = setup({ now: new Date("2026-09-07T12:00:00Z") });
    ctx.db.updateSettings({ holidayIssueKey: "ITAUADQUIR-900" });
    try {
      const result = await ctx.applier.runNow();
      const day = result.days.find((d) => d.date === "2026-09-07");
      expect(day?.dayKind).toBe("holiday");
      expect(day?.issueKey).toBe("ITAUADQUIR-900");
      const log = ctx.jira.worklogs.find((w) =>
        w.started.startsWith("2026-09-07"),
      );
      expect(log?.issueKey).toBe("ITAUADQUIR-900");
    } finally {
      ctx.cleanup();
    }
  });

  test("férias usa vacation issue; feriado sobrepondo férias vence", async () => {
    const ctx = setup({
      now: new Date("2026-09-07T12:00:00Z"),
      vacations: [["2026-08-25", "2026-09-15"]],
    });
    ctx.db.updateSettings({
      holidayIssueKey: "ITAUADQUIR-900",
      vacationIssueKey: "ITAUADQUIR-902",
    });
    try {
      await ctx.applier.runNow();
      const holidayLog = ctx.jira.worklogs.find((w) =>
        w.started.startsWith("2026-09-07"),
      );
      expect(holidayLog?.issueKey).toBe("ITAUADQUIR-900");
      const vacationLog = ctx.jira.worklogs.find((w) =>
        w.started.startsWith("2026-09-01"),
      );
      expect(vacationLog?.issueKey).toBe("ITAUADQUIR-902");
    } finally {
      ctx.cleanup();
    }
  });

  test("fim de semana nunca aponta", async () => {
    const ctx = setup({ monthlyTasks: [["2026-09", "ITAUADQUIR-901"]] });
    try {
      const result = await ctx.applier.runNow();
      const weekend = result.days.filter(
        (d) => d.date === "2026-09-19" || d.date === "2026-09-20",
      );
      expect(weekend).toHaveLength(2);
      for (const day of weekend) {
        expect(day.dayKind).toBe("weekend");
        expect(day.action).toBe("skipped");
      }
    } finally {
      ctx.cleanup();
    }
  });
});

describe("applier / idempotência", () => {
  test("APP-02 ledger local (history success) → skip, sem POST", async () => {
    const ctx = setup({ monthlyTasks: [["2026-09", "ITAUADQUIR-901"]] });
    ctx.db.upsertHistory({
      date: "2026-09-30",
      dayKind: "workday",
      issueKey: "ITAUADQUIR-901",
      worklogId: 555,
      timeSpentSeconds: 28800,
      status: "success",
      detail: "já apontado",
    });
    try {
      const result = await ctx.applier.runNow();
      const today = result.days.find((d) => d.date === "2026-09-30");
      expect(today?.action).toBe("skipped");
      expect(today?.worklogId).toBe(555);
      expect(
        ctx.jira.worklogs.some((w) => w.started.startsWith("2026-09-30")),
      ).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });

  test("APP-03 verificação remota via JQL → skip, sem POST", async () => {
    const ctx = setup({
      monthlyTasks: [["2026-09", "ITAUADQUIR-901"]],
      jiraOverrides: {
        async hasWorklogOnDate(_cookie, date) {
          return date === "2026-09-30";
        },
      },
    });
    try {
      const result = await ctx.applier.runNow();
      const today = result.days.find((d) => d.date === "2026-09-30");
      expect(today?.action).toBe("skipped");
      expect(today?.detail).toContain("já existente");
      expect(
        ctx.jira.worklogs.some((w) => w.started.startsWith("2026-09-30")),
      ).toBe(false);
      expect(ctx.db.historyByDate("2026-09-30")?.status).toBe("success");
    } finally {
      ctx.cleanup();
    }
  });

  test("P1-4 username vazio → dia failed, nunca posta às cegas", async () => {
    const ctx = setup({
      monthlyTasks: [["2026-09", "ITAUADQUIR-901"]],
      sessionUsername: "",
      jiraOverrides: {
        async getMyself() {
          throw new Error("401");
        },
        async hasWorklogOnDate() {
          return false;
        },
      },
    });
    try {
      const result = await ctx.applier.runNow();
      const today = result.days.find((d) => d.date === "2026-09-30");
      expect(today?.action).toBe("failed");
      expect(today?.detail).toContain("sessão Jira inválida");
      expect(ctx.jira.worklogs).toHaveLength(0);
      expect(ctx.jira.jqlDates).toHaveLength(0);
      expect(ctx.db.historyByDate("2026-09-30")?.status).toBe("failed");
    } finally {
      ctx.cleanup();
    }
  });

  test("P1-4 username resolvido via getMyself quando não há sessão salva", async () => {
    const ctx = setup({
      monthlyTasks: [["2026-09", "ITAUADQUIR-901"]],
      sessionUsername: "",
    });
    try {
      const result = await ctx.applier.runNow();
      const today = result.days.find((d) => d.date === "2026-09-30");
      expect(today?.action).toBe("logged");
      expect(ctx.jira.myselfCalls()).toBeGreaterThan(0);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("applier / backfill 14 dias", () => {
  test("APP-04 cobre 14 dias inclusive hoje e completa dias úteis", async () => {
    const ctx = setup({
      now: new Date("2026-09-30T12:00:00Z"),
      monthlyTasks: [["2026-09", "ITAUADQUIR-901"]],
    });
    try {
      const result = await ctx.applier.runNow();
      expect(result.days).toHaveLength(BACKFILL_WINDOW_DAYS);
      expect(result.days[0]?.date).toBe("2026-09-17");
      expect(result.days[result.days.length - 1]?.date).toBe("2026-09-30");

      const loggedDates = result.days
        .filter((d) => d.action === "logged")
        .map((d) => d.date);
      expect(loggedDates).toEqual([
        "2026-09-17",
        "2026-09-18",
        "2026-09-21",
        "2026-09-22",
        "2026-09-23",
        "2026-09-24",
        "2026-09-25",
        "2026-09-28",
        "2026-09-29",
        "2026-09-30",
      ]);
      expect(ctx.jira.worklogs).toHaveLength(10);
    } finally {
      ctx.cleanup();
    }
  });

  test("backfill respeita dias já apontados", async () => {
    const ctx = setup({
      monthlyTasks: [["2026-09", "ITAUADQUIR-901"]],
    });
    ctx.db.upsertHistory({
      date: "2026-09-21",
      dayKind: "workday",
      issueKey: "ITAUADQUIR-901",
      worklogId: 1,
      timeSpentSeconds: 28800,
      status: "success",
      detail: "x",
    });
    try {
      const result = await ctx.applier.runNow();
      const day = result.days.find((d) => d.date === "2026-09-21");
      expect(day?.action).toBe("skipped");
      expect(
        ctx.jira.worklogs.some((w) => w.started.startsWith("2026-09-21")),
      ).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("applier / fallback de mês", () => {
  test("APP-06 mês sem mapping usa o anterior mais recente + warn 1x", async () => {
    const ctx = setup({ monthlyTasks: [["2026-08", "ITAUADQUIR-800"]] });
    try {
      const result = await ctx.applier.runNow();
      const today = result.days.find((d) => d.date === "2026-09-30");
      expect(today?.action).toBe("logged");
      expect(today?.issueKey).toBe("ITAUADQUIR-800");
      const warnLogs = ctx.db
        .listLogs(50, "warn")
        .filter((l) => l.message.includes("fallback"));
      expect(warnLogs.length).toBeGreaterThan(0);
      const fallbackAlerts = ctx.alerts.filter((a) => a.includes("fallback"));
      expect(fallbackAlerts).toHaveLength(1);
    } finally {
      ctx.cleanup();
    }
  });

  test("APP-07 nenhum mapping → skipped + alerta", async () => {
    const ctx = setup();
    try {
      const result = await ctx.applier.runNow();
      const workdays = result.days.filter((d) => d.dayKind === "workday");
      expect(workdays.length).toBeGreaterThan(0);
      for (const day of workdays) {
        expect(day.action).toBe("skipped");
      }
      expect(ctx.jira.worklogs).toHaveLength(0);
      const noMappingAlerts = ctx.alerts.filter((a) =>
        a.includes("nenhuma monthly task"),
      );
      expect(noMappingAlerts).toHaveLength(1);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("applier / fronteira de meia-noite (TZ America/Sao_Paulo)", () => {
  test("23:30 BRT ainda é o dia local corrente", async () => {
    const ctx = setup({
      now: new Date("2026-10-01T02:30:00Z"),
      monthlyTasks: [["2026-10", "ITAUADQUIR-1001"]],
    });
    try {
      const result = await ctx.applier.runNow();
      const last = result.days[result.days.length - 1];
      expect(last?.date).toBe("2026-09-30");
      expect(result.days[0]?.date).toBe("2026-09-17");
    } finally {
      ctx.cleanup();
    }
  });

  test("00:30 BRT já vira o dia local seguinte", async () => {
    const ctx = setup({
      now: new Date("2026-10-01T03:30:00Z"),
      monthlyTasks: [["2026-10", "ITAUADQUIR-1001"]],
    });
    try {
      const result = await ctx.applier.runNow();
      const last = result.days[result.days.length - 1];
      expect(last?.date).toBe("2026-10-01");
      expect(result.days[0]?.date).toBe("2026-09-18");
    } finally {
      ctx.cleanup();
    }
  });

  test("23:59 BRT vs 00:01 BRT muda a data de negócio (offset -0300)", async () => {
    const before = setup({
      now: new Date("2026-10-01T02:59:00Z"),
      monthlyTasks: [["2026-10", "ITAUADQUIR-1001"]],
    });
    const after = setup({
      now: new Date("2026-10-01T03:01:00Z"),
      monthlyTasks: [["2026-10", "ITAUADQUIR-1001"]],
    });
    try {
      const beforeResult = await before.applier.runNow();
      const afterResult = await after.applier.runNow();
      const beforeDate =
        beforeResult.days[beforeResult.days.length - 1]?.date;
      const afterDate = afterResult.days[afterResult.days.length - 1]?.date;
      expect(beforeDate).toBe("2026-09-30");
      expect(afterDate).toBe("2026-10-01");
      expect(afterDate).not.toBe(beforeDate);
    } finally {
      before.cleanup();
      after.cleanup();
    }
  });

  test("worklog gerado usa started no fuso -0300", async () => {
    const ctx = setup({
      now: new Date("2026-10-01T02:30:00Z"),
      monthlyTasks: [
        ["2026-09", "ITAUADQUIR-901"],
        ["2026-10", "ITAUADQUIR-1001"],
      ],
    });
    try {
      await ctx.applier.runNow();
      const log = ctx.jira.worklogs.find((w) =>
        w.started.startsWith("2026-09-30"),
      );
      expect(log?.started).toBe("2026-09-30T09:00:00.000-0300");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("applier / falha e shape do RunNowResult", () => {
  test("APP-08 falha no POST vira failed sem quebrar o loop", async () => {
    const ctx = setup({
      now: new Date("2026-09-30T12:00:00Z"),
      monthlyTasks: [["2026-09", "ITAUADQUIR-901"]],
      jiraOverrides: {
        async addWorklog(_cookie, issueKey, started) {
          if (started.startsWith("2026-09-30")) throw new Error("HTTP 500");
          return { worklogId: 1 };
        },
      },
    });
    try {
      const result = await ctx.applier.runNow();
      const today = result.days.find((d) => d.date === "2026-09-30");
      expect(today?.action).toBe("failed");
      expect(ctx.db.historyByDate("2026-09-30")?.status).toBe("failed");
      expect(result.days.filter((d) => d.action === "logged").length).toBe(9);
    } finally {
      ctx.cleanup();
    }
  });

  test("APP-09 RunNowResult shape conforme contrato", async () => {
    const ctx = setup({ monthlyTasks: [["2026-09", "ITAUADQUIR-901"]] });
    try {
      const result = await ctx.applier.runNow();
      expect(typeof result.ranAt).toBe("string");
      expect(Number.isNaN(Date.parse(result.ranAt))).toBe(false);
      expect(Array.isArray(result.days)).toBe(true);
      for (const day of result.days) {
        expect(typeof day.date).toBe("string");
        expect(["workday", "holiday", "vacation", "weekend"]).toContain(
          day.dayKind,
        );
        expect(["logged", "skipped", "failed"]).toContain(day.action);
      }
    } finally {
      ctx.cleanup();
    }
  });
});
