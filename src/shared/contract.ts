// Contrato compartilhado entre backend (Elysia) e painel (React).
// Fonte única de verdade de tipos e formato de payloads.

export type DayKind = "workday" | "holiday" | "vacation" | "weekend";

export type SessionStatus = "alive" | "dead" | "unknown";

export interface MonthlyTask {
  month: string; // "YYYY-MM"
  issueKey: string; // ex: "ITAUADQUIR-901"
}

export interface VacationPeriod {
  id: number;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD" (inclusivo)
  note: string;
}

export interface AppSettings {
  holidayIssueKey: string;
  vacationIssueKey: string;
  alertWebhookUrl: string;
  jiraCookie: string; // mascarado nas respostas de leitura
}

export interface SessionInfo {
  status: SessionStatus;
  lastCheck: string | null; // ISO
  username: string | null;
  displayName: string | null;
}

export interface HistoryEntry {
  id: number;
  date: string; // "YYYY-MM-DD" apontada
  dayKind: DayKind;
  issueKey: string;
  worklogId: number | null;
  timeSpentSeconds: number;
  status: "success" | "skipped" | "failed";
  detail: string;
  createdAt: string; // ISO
}

export interface LogEntry {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string; // ISO
}

export interface RunNowResult {
  ranAt: string; // ISO
  days: Array<{
    date: string;
    dayKind: DayKind;
    action: "logged" | "skipped" | "failed";
    issueKey: string | null;
    worklogId: number | null;
    detail: string;
  }>;
}

// ---- API REST (prefixo /api, auth por cookie de sessão) ----

// POST /api/login { password } -> 204 + cookie de sessão
// POST /api/logout -> 204

// GET  /api/session -> SessionInfo
// GET  /api/settings -> AppSettings (cookie mascarado)
// PUT  /api/settings { holidayIssueKey, vacationIssueKey, alertWebhookUrl, jiraCookie? }
//     jiraCookie opcional: se ausente/vazio, mantém o atual

// GET  /api/monthly-tasks -> MonthlyTask[]
// PUT  /api/monthly-tasks { month, issueKey } (upsert)
// DELETE /api/monthly-tasks/:month

// GET  /api/vacations -> VacationPeriod[]
// POST /api/vacations { startDate, endDate, note }
// DELETE /api/vacations/:id

// GET  /api/history?limit=100&offset=0 -> HistoryEntry[]
// GET  /api/logs?limit=100&level=info|warn|error -> LogEntry[]

// POST /api/run-now -> RunNowResult (executa job síncrono: hoje + backfill 14d)
//                       409 { message } se já houver execução em andamento

// POST /api/test-connection -> { ok: boolean, message: string } (ping /myself)

// POST /api/keepalive -> { probe: "alive" | "dead" | "network-error" }
//                        (força checagem imediata da sessão Jira + grava status)
