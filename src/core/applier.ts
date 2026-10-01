import type { Db } from "./db";
import type { JiraClient } from "./jira";
import type { HolidayStore } from "./holidays";
import type { Alerter } from "./alerter";
import type { DayKind, RunNowResult } from "../shared/contract";
import { classifyDay } from "./calendar";
import { WORK_SECONDS_PER_DAY, formatStarted } from "./jira";

export const BACKFILL_WINDOW_DAYS = 14;

export type Applier = {
  runNow(): Promise<RunNowResult>;
};

export function createApplier(deps: {
  db: Db;
  jira: JiraClient;
  holidays: HolidayStore;
  alerter?: Alerter;
  now?: () => Date;
}): Applier {
  const { db, jira, holidays } = deps;
  const alerter = deps.alerter;
  const now = deps.now ?? (() => new Date());
  const warned = new Set<string>();

  const warnOncePerDay = async (kind: string, text: string): Promise<void> => {
    const key = `${todayLocal()}:${kind}`;
    if (warned.has(key)) return;
    warned.add(key);
    db.addLog("warn", text);
    if (!alerter) return;
    await alerter.sendAlert({
      text: `jira-autowork: ${text}`,
      severity: "warn",
      timestamp: now().toISOString(),
    });
  };

  const todayLocal = (): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
      .format(now())
      .toString();

  const classify = async (
    date: string,
  ): Promise<ReturnType<typeof classifyDay>> => {
    const holidaySet = await holidays.loadYear(Number(date.slice(0, 4)));
    return classifyDay(date, holidaySet, db.listVacations());
  };

  const recordSkip = (date: string, dayKind: DayKind, detail: string) => {
    db.upsertHistory({
      date,
      dayKind,
      issueKey: "",
      worklogId: null,
      timeSpentSeconds: 0,
      status: "skipped",
      detail,
    });
    db.addLog("warn", `${date}: ${detail}`);
  };

  const monthlyIssueFor = (month: string): { issueKey: string | null; fallback: boolean } => {
    const tasks = db.listMonthlyTasks();
    const exact = tasks.find((task) => task.month === month);
    if (exact) return { issueKey: exact.issueKey, fallback: false };
    const previous = tasks
      .filter((task) => task.month < month)
      .sort((a, b) => b.month.localeCompare(a.month))[0];
    if (previous) return { issueKey: previous.issueKey, fallback: true };
    return { issueKey: null, fallback: false };
  };

  async function usernameFor(cookie: string): Promise<string> {
    const stored = db.getSessionInfo().username;
    if (stored) return stored;
    try {
      const myself = await jira.getMyself(cookie);
      return myself.name;
    } catch {
      return "";
    }
  }

  async function logWorkday(
    date: string,
    dayKind: DayKind,
    issueKey: string,
    detailLabel: string,
  ): Promise<RunNowResult["days"][number]> {
    const settings = db.getSettings();
    const cookie = settings.jiraCookie;
    if (!cookie) {
      db.addLog("error", `${date}: cookie Jira não configurado`);
      return {
        date,
        dayKind,
        action: "failed",
        issueKey: null,
        worklogId: null,
        detail: "cookie Jira não configurado",
      };
    }
    const existing = db.historyByDate(date);
    if (existing?.status === "success") {
      return {
        date,
        dayKind,
        action: "skipped",
        issueKey: existing.issueKey || null,
        worklogId: existing.worklogId,
        detail: `já apontado (${existing.detail})`,
      };
    }
    const username = await usernameFor(cookie);
    if (!username) {
      db.addLog("error", `${date}: /myself indisponível — abortando o dia para evitar duplicata`);
      db.upsertHistory({
        date,
        dayKind,
        issueKey,
        worklogId: null,
        timeSpentSeconds: 0,
        status: "failed",
        detail: "sessão Jira inválida (/myself indisponível)",
      });
      return {
        date,
        dayKind,
        action: "failed",
        issueKey,
        worklogId: null,
        detail: "sessão Jira inválida (/myself indisponível)",
      };
    }
    try {
      if (await jira.hasWorklogOnDate(cookie, date, username)) {
        db.upsertHistory({
          date,
          dayKind,
          issueKey: "",
          worklogId: null,
          timeSpentSeconds: 0,
          status: "success",
          detail: "worklog já existente no Jira",
        });
        return {
          date,
          dayKind,
          action: "skipped",
          issueKey: null,
          worklogId: null,
          detail: "worklog já existente no Jira",
        };
      }
      const { worklogId } = await jira.addWorklog(
        cookie,
        issueKey,
        formatStarted(date),
        WORK_SECONDS_PER_DAY,
      );
      db.upsertHistory({
        date,
        dayKind,
        issueKey,
        worklogId,
        timeSpentSeconds: WORK_SECONDS_PER_DAY,
        status: "success",
        detail: `${detailLabel} 8h em ${issueKey}`,
      });
      db.addLog("info", `${date}: apontado 8h em ${issueKey} (worklog ${worklogId})`);
      return {
        date,
        dayKind,
        action: "logged",
        issueKey,
        worklogId,
        detail: `${detailLabel} 8h em ${issueKey}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.upsertHistory({
        date,
        dayKind,
        issueKey,
        worklogId: null,
        timeSpentSeconds: 0,
        status: "failed",
        detail: message,
      });
      db.addLog("error", `${date}: falha ao apontar em ${issueKey} — ${message}`);
      return {
        date,
        dayKind,
        action: "failed",
        issueKey,
        worklogId: null,
        detail: message,
      };
    }
  }

  async function runForDate(
    date: string,
  ): Promise<RunNowResult["days"][number]> {
    const classification = await classify(date);
    const settings = db.getSettings();
    if (classification.dayKind === "weekend") {
      recordSkip(date, "weekend", "fim de semana");
      return {
        date,
        dayKind: "weekend",
        action: "skipped",
        issueKey: null,
        worklogId: null,
        detail: "fim de semana",
      };
    }
    if (classification.dayKind === "holiday") {
      const issueKey = settings.holidayIssueKey.trim();
      if (!issueKey) {
        recordSkip(
          date,
          "holiday",
          `feriado ${classification.holidayName ?? "?"} sem holiday issue configurada`,
        );
        return {
          date,
          dayKind: "holiday",
          action: "skipped",
          issueKey: null,
          worklogId: null,
          detail: "holiday issue não configurada",
        };
      }
      return logWorkday(
        date,
        "holiday",
        issueKey,
        `feriado (${classification.holidayName ?? "?"})`,
      );
    }
    if (classification.dayKind === "vacation") {
      const issueKey = settings.vacationIssueKey.trim();
      if (!issueKey) {
        recordSkip(date, "vacation", "férias sem vacation issue configurada");
        return {
          date,
          dayKind: "vacation",
          action: "skipped",
          issueKey: null,
          worklogId: null,
          detail: "vacation issue não configurada",
        };
      }
      return logWorkday(date, "vacation", issueKey, "férias");
    }
    const { issueKey, fallback } = monthlyIssueFor(date.slice(0, 7));
    if (!issueKey) {
      const detail = "nenhuma monthly task configurada";
      recordSkip(date, "workday", detail);
      await warnOncePerDay(
        "no-mapping",
        `${date}: ${detail} — dia útil não apontado`,
      );
      return {
        date,
        dayKind: "workday",
        action: "skipped",
        issueKey: null,
        worklogId: null,
        detail: "nenhuma monthly task configurada",
      };
    }
    if (fallback) {
      const month = date.slice(0, 7);
      await warnOncePerDay(
        "fallback",
        `${date}: sem mapping para ${month} — usando fallback ${issueKey}`,
      );
    }
    return logWorkday(date, "workday", issueKey, "dia útil");
  }

  async function runNow(): Promise<RunNowResult> {
    const today = todayLocal();
    const days: RunNowResult["days"] = [];
    for (let i = BACKFILL_WINDOW_DAYS - 1; i >= 0; i--) {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - i);
      const iso = date.toISOString().slice(0, 10);
      days.push(await runForDate(iso));
    }
    return { ranAt: new Date().toISOString(), days };
  }

  return { runNow };
}
