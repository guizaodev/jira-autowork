import type { Applier } from "./applier";
import type { Alerter } from "./alerter";
import type { Db } from "./db";
import type { HolidayStore } from "./holidays";

export const DAILY_JOB_HOUR = 9;
export const DAILY_JOB_MINUTE = 5;
export const KEEPALIVE_INTERVAL_MINUTES = 20;

export type Scheduler = {
  start(): void;
  stop(): void;
};

export function createScheduler(deps: {
  db: Db;
  applier: Applier;
  alerter: Alerter;
  holidays: HolidayStore;
  now?: () => Date;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): Scheduler {
  const { db, applier, alerter, holidays } = deps;
  const now = deps.now ?? (() => new Date());
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;

  let dailyTimer: ReturnType<typeof setIntervalFn> | null = null;
  let keepaliveTimer: ReturnType<typeof setIntervalFn> | null = null;
  let lastDailyRunDate: string | null = null;
  let deadAlertSent = false;
  let holidayRefreshMonth: string | null = null;

  const localDate = (): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
      .format(now())
      .toString();

  const localMinutes = (): number => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now());
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  };

  async function runDailyJob(markDay = true): Promise<void> {
    const today = localDate();
    if (markDay && lastDailyRunDate === today) return;
    if (markDay) lastDailyRunDate = today;
    db.addLog("info", `job diário iniciado para ${today}`);
    try {
      const result = await applier.runNow();
      const logged = result.days.filter((day) => day.action === "logged").length;
      db.addLog(
        "info",
        `job diário concluído: ${logged} apontado(s), ${result.days.length} dia(s) avaliado(s)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.addLog("error", `job diário falhou: ${message}`);
      await alerter.sendAlert({
        text: `jira-autowork: job diário falhou — ${message}`,
        severity: "error",
        timestamp: now().toISOString(),
      });
    }
  }

  async function runKeepalive(): Promise<void> {
    const probe = await alerter.probeAndRecord();
    if (probe === "dead" && !deadAlertSent) {
      deadAlertSent = true;
      await alerter.sendAlert({
        text: "jira-autowork: sessão Jira expirada — atualize o cookie no painel.",
        severity: "error",
        timestamp: now().toISOString(),
      });
    } else if (probe === "alive" && deadAlertSent) {
      deadAlertSent = false;
      db.addLog("info", "keepalive: sessão Jira voltou a responder");
      await alerter.sendAlert({
        text: "jira-autowork: sessão Jira restabelecida.",
        severity: "info",
        timestamp: now().toISOString(),
      });
    }
  }

  async function refreshHolidays(): Promise<void> {
    const year = Number(localDate().slice(0, 4));
    holidays.invalidate?.(year);
    await holidays.loadYear(year);
  }

  function tick(): void {
    const today = localDate();
    const minutes = localMinutes();
    if (
      minutes >= DAILY_JOB_HOUR * 60 + DAILY_JOB_MINUTE &&
      lastDailyRunDate !== today
    ) {
      void runDailyJob();
    }
    // virada de mês: recarrega feriados do novo ano (invalida o Map em memória)
    if (holidayRefreshMonth !== today.slice(0, 7)) {
      holidayRefreshMonth = today.slice(0, 7);
      void refreshHolidays();
    }
  }

  return {
    start(): void {
      holidayRefreshMonth = localDate().slice(0, 7);
      void refreshHolidays();
      void runKeepalive();
      // catch-up no boot sempre executa, mas NÃO marca o dia — o job das 09:05
      // ainda roda no mesmo dia (ledger + checagem JQL garantem idempotência)
      void runDailyJob(false);
      dailyTimer = setIntervalFn(() => tick(), 60_000);
      keepaliveTimer = setIntervalFn(
        () => void runKeepalive(),
        KEEPALIVE_INTERVAL_MINUTES * 60_000,
      );
      db.addLog("info", "scheduler iniciado (job 09:05 BRT + keepalive 20min)");
    },
    stop(): void {
      if (dailyTimer !== null) clearIntervalFn(dailyTimer);
      if (keepaliveTimer !== null) clearIntervalFn(keepaliveTimer);
      dailyTimer = null;
      keepaliveTimer = null;
    },
  };
}
