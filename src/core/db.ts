import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  AppSettings,
  DayKind,
  HistoryEntry,
  LogEntry,
  MonthlyTask,
  SessionInfo,
  VacationPeriod,
} from "../shared/contract";

interface SettingsRow {
  k: string;
  v: string;
}

interface MonthlyTaskRow {
  month: string;
  issue_key: string;
}

interface VacationRow {
  id: number;
  start_date: string;
  end_date: string;
  note: string;
}

interface HistoryRow {
  id: number;
  date: string;
  day_kind: string;
  issue_key: string;
  worklog_id: number | null;
  time_spent_seconds: number;
  status: string;
  detail: string;
  created_at: string;
}

interface LogRow {
  id: number;
  level: string;
  message: string;
  created_at: string;
}

export interface HistoryUpsert {
  date: string;
  dayKind: DayKind;
  issueKey: string;
  worklogId: number | null;
  timeSpentSeconds: number;
  status: HistoryEntry["status"];
  detail: string;
}

export type SettingsPatch = {
  holidayIssueKey?: string;
  vacationIssueKey?: string;
  alertWebhookUrl?: string;
  proxyUrl?: string;
  jiraCookie?: string;
};

export interface Db {
  readonly sqlite: Database;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  getSettings(): AppSettings;
  updateSettings(patch: SettingsPatch): void;
  getSessionInfo(): SessionInfo;
  setSessionInfo(info: SessionInfo): void;
  listMonthlyTasks(): MonthlyTask[];
  upsertMonthlyTask(month: string, issueKey: string): void;
  deleteMonthlyTask(month: string): boolean;
  listVacations(): VacationPeriod[];
  addVacation(startDate: string, endDate: string, note: string): number;
  deleteVacation(id: number): boolean;
  historyByDate(date: string): HistoryEntry | null;
  historyForMonth(month: string): HistoryEntry[];
  upsertHistory(entry: HistoryUpsert): void;
  listHistory(limit: number, offset: number): HistoryEntry[];
  addLog(level: LogEntry["level"], message: string): void;
  listLogs(limit: number, level: LogEntry["level"] | null): LogEntry[];
  holidayCachePayload(year: number): string | null;
  setHolidayCache(year: number, payload: string): void;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings(
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS monthly_tasks(
  month TEXT PRIMARY KEY,
  issue_key TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vacation_periods(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  day_kind TEXT NOT NULL,
  issue_key TEXT NOT NULL DEFAULT '',
  worklog_id INTEGER,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS holidays_cache(
  year INTEGER PRIMARY KEY,
  payload TEXT NOT NULL
);
`;

const LOG_RETENTION = 2000;

export function defaultDbPath(): string {
  if (process.env.DATA_DIR) {
    return path.join(process.env.DATA_DIR, "jira-autowork.db");
  }
  return path.join(process.cwd(), "data", "dev.db");
}

export function createDb(dbPath: string): Db {
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec(SCHEMA_SQL);
  seed(sqlite);

  const toHistoryEntry = (row: HistoryRow): HistoryEntry => ({
    id: row.id,
    date: row.date,
    dayKind: row.day_kind as DayKind,
    issueKey: row.issue_key,
    worklogId: row.worklog_id,
    timeSpentSeconds: row.time_spent_seconds,
    status: row.status as HistoryEntry["status"],
    detail: row.detail,
    createdAt: row.created_at,
  });

  const toLogEntry = (row: LogRow): LogEntry => ({
    id: row.id,
    level: row.level as LogEntry["level"],
    message: row.message,
    createdAt: row.created_at,
  });

  const upsertSetting = sqlite.query(
    "INSERT INTO settings(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
  );

  const statementCache = new Map<string, ReturnType<typeof sqlite.query>>();
  const cached = <T extends unknown[]>(
    sql: string,
  ): ReturnType<typeof sqlite.query> => {
    let stmt = statementCache.get(sql);
    if (!stmt) {
      stmt = sqlite.query(sql);
      statementCache.set(sql, stmt);
    }
    return stmt as ReturnType<typeof sqlite.query>;
  };

  return {
    sqlite,
    getSetting(key: string): string | null {
      const row = cached("SELECT k, v FROM settings WHERE k = ?").get(key) as
        | SettingsRow
        | null;
      return row ? row.v : null;
    },
    setSetting(key: string, value: string): void {
      upsertSetting.run(key, value);
    },
    getSettings(): AppSettings {
      const rows = cached("SELECT k, v FROM settings").all() as SettingsRow[];
      const map = new Map(rows.map((row) => [row.k, row.v]));
      return {
        holidayIssueKey: map.get("holiday_issue_key") ?? "",
        vacationIssueKey: map.get("vacation_issue_key") ?? "",
        alertWebhookUrl: map.get("alert_webhook_url") ?? "",
        proxyUrl: map.get("proxy_url") ?? "",
        jiraCookie: map.get("jira_cookie") ?? "",
      };
    },
    updateSettings(patch: SettingsPatch): void {
      const keys: Array<[string, string | undefined]> = [
        ["holiday_issue_key", patch.holidayIssueKey],
        ["vacation_issue_key", patch.vacationIssueKey],
        ["alert_webhook_url", patch.alertWebhookUrl],
        ["proxy_url", patch.proxyUrl],
        ["jira_cookie", patch.jiraCookie],
      ];
      for (const [key, value] of keys) {
        if (value === undefined) continue;
        upsertSetting.run(key, value);
      }
    },
    getSessionInfo(): SessionInfo {
      const row = cached("SELECT k, v FROM settings WHERE k = ?").get(
        "session_info",
      ) as SettingsRow | null;
      if (!row) {
        return {
          status: "unknown",
          lastCheck: null,
          username: null,
          displayName: null,
        };
      }
      try {
        const parsed = JSON.parse(row.v) as Partial<SessionInfo>;
        return {
          status: parsed.status ?? "unknown",
          lastCheck: parsed.lastCheck ?? null,
          username: parsed.username ?? null,
          displayName: parsed.displayName ?? null,
        };
      } catch {
        return {
          status: "unknown",
          lastCheck: null,
          username: null,
          displayName: null,
        };
      }
    },
    setSessionInfo(info: SessionInfo): void {
      upsertSetting.run("session_info", JSON.stringify(info));
    },
    listMonthlyTasks(): MonthlyTask[] {
      return (cached("SELECT month, issue_key FROM monthly_tasks ORDER BY month DESC").all() as MonthlyTaskRow[]).map(
        (row) => ({ month: row.month, issueKey: row.issue_key }),
      );
    },
    upsertMonthlyTask(month: string, issueKey: string): void {
      cached(
        "INSERT INTO monthly_tasks(month, issue_key) VALUES(?, ?) ON CONFLICT(month) DO UPDATE SET issue_key = excluded.issue_key",
      ).run(month, issueKey);
    },
    deleteMonthlyTask(month: string): boolean {
      return (
        cached("DELETE FROM monthly_tasks WHERE month = ?").run(month).changes >
        0
      );
    },
    listVacations(): VacationPeriod[] {
      return (
        cached(
          "SELECT id, start_date, end_date, note FROM vacation_periods ORDER BY start_date",
        ).all() as VacationRow[]
      ).map((row) => ({
        id: row.id,
        startDate: row.start_date,
        endDate: row.end_date,
        note: row.note,
      }));
    },
    addVacation(startDate: string, endDate: string, note: string): number {
      const result = cached(
        "INSERT INTO vacation_periods(start_date, end_date, note) VALUES(?, ?, ?)",
      ).run(startDate, endDate, note);
      return Number(result.lastInsertRowid);
    },
    deleteVacation(id: number): boolean {
      return (
        cached("DELETE FROM vacation_periods WHERE id = ?").run(id).changes > 0
      );
    },
    historyByDate(date: string): HistoryEntry | null {
      const row = cached(
        "SELECT id, date, day_kind, issue_key, worklog_id, time_spent_seconds, status, detail, created_at FROM history WHERE date = ?",
      ).get(date) as HistoryRow | null;
      return row ? toHistoryEntry(row) : null;
    },
    upsertHistory(entry: HistoryUpsert): void {
      cached(
        `INSERT INTO history(date, day_kind, issue_key, worklog_id, time_spent_seconds, status, detail, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
           day_kind = excluded.day_kind,
           issue_key = excluded.issue_key,
           worklog_id = excluded.worklog_id,
           time_spent_seconds = excluded.time_spent_seconds,
           status = excluded.status,
           detail = excluded.detail`,
      ).run(
          entry.date,
          entry.dayKind,
          entry.issueKey,
          entry.worklogId,
          entry.timeSpentSeconds,
          entry.status,
          entry.detail,
          nowIso(),
        );
    },
    historyForMonth(month: string): HistoryEntry[] {
      return (
        cached(
          "SELECT id, date, day_kind, issue_key, worklog_id, time_spent_seconds, status, detail, created_at FROM history WHERE date LIKE ? ORDER BY date",
        ).all(`${month}-%`) as HistoryRow[]
      ).map(toHistoryEntry);
    },
    listHistory(limit: number, offset: number): HistoryEntry[] {
      return (
        cached(
          "SELECT id, date, day_kind, issue_key, worklog_id, time_spent_seconds, status, detail, created_at FROM history ORDER BY date DESC, id DESC LIMIT ? OFFSET ?",
        ).all(limit, offset) as HistoryRow[]
      ).map(toHistoryEntry);
    },
    addLog(level: LogEntry["level"], message: string): void {
      cached("INSERT INTO logs(level, message, created_at) VALUES(?, ?, ?)").run(
        level,
        message,
        nowIso(),
      );
      cached(
        `DELETE FROM logs WHERE id NOT IN (
           SELECT id FROM logs ORDER BY id DESC LIMIT ?
         )`,
      ).run(LOG_RETENTION);
    },
    listLogs(limit: number, level: LogEntry["level"] | null): LogEntry[] {
      if (level) {
        return (
          cached(
            "SELECT id, level, message, created_at FROM logs WHERE level = ? ORDER BY id DESC LIMIT ?",
          ).all(level, limit) as LogRow[]
        ).map(toLogEntry);
      }
      return (
        cached(
          "SELECT id, level, message, created_at FROM logs ORDER BY id DESC LIMIT ?",
        ).all(limit) as LogRow[]
      ).map(toLogEntry);
    },
    holidayCachePayload(year: number): string | null {
      const row = cached("SELECT payload FROM holidays_cache WHERE year = ?").get(
        year,
      ) as { payload: string } | null;
      return row ? row.payload : null;
    },
    setHolidayCache(year: number, payload: string): void {
      cached(
        "INSERT INTO holidays_cache(year, payload) VALUES(?, ?) ON CONFLICT(year) DO UPDATE SET payload = excluded.payload",
      ).run(year, payload);
    },
  };
}

function seed(sqlite: Database): void {
  const insertIfMissing = sqlite.query(
    "INSERT INTO settings(k, v) SELECT ?, ? WHERE NOT EXISTS(SELECT 1 FROM settings WHERE k = ?)",
  );
  const seedSetting = (key: string, value: string): void => {
    insertIfMissing.run(key, value, key);
  };
  seedSetting("holiday_issue_key", "");
  seedSetting("vacation_issue_key", "");
  seedSetting("alert_webhook_url", "");
  seedSetting("proxy_url", "");
  const envCookie = process.env.JIRA_COOKIE ?? "";
  seedSetting("jira_cookie", envCookie);
}

export function nowIso(): string {
  return new Date().toISOString();
}
