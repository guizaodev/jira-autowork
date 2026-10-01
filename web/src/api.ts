import type {
  AppSettings,
  HistoryEntry,
  LogEntry,
  MonthlyTask,
  MonthTimesheet,
  RunNowResult,
  SessionInfo,
  VacationPeriod,
} from "../../src/shared/contract";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown };
    const detail = body.message ?? body.error;
    if (typeof detail === "string" && detail.length > 0) return detail;
  } catch {
    return `HTTP ${res.status}`;
  }
  return `HTTP ${res.status}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return (await res.json()) as T;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

export const api = {
  login: (password: string) =>
    request<void>("/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<void>("/logout", { method: "POST" }),

  session: () => request<SessionInfo>("/session"),
  settings: () => request<AppSettings>("/settings"),
  saveSettings: (body: Partial<Omit<AppSettings, "jiraCookie">> & { jiraCookie?: string }) =>
    request<AppSettings>("/settings", { method: "PUT", body: JSON.stringify(body) }),
  testConnection: () =>
    request<TestConnectionResult>("/test-connection", { method: "POST" }),

  monthlyTasks: () => request<MonthlyTask[]>("/monthly-tasks"),
  saveMonthlyTask: (body: MonthlyTask) =>
    request<MonthlyTask>("/monthly-tasks", { method: "PUT", body: JSON.stringify(body) }),
  deleteMonthlyTask: (month: string) =>
    request<void>(`/monthly-tasks/${encodeURIComponent(month)}`, { method: "DELETE" }),

  vacations: () => request<VacationPeriod[]>("/vacations"),
  createVacation: (body: { startDate: string; endDate: string; note: string }) =>
    request<VacationPeriod>("/vacations", { method: "POST", body: JSON.stringify(body) }),
  deleteVacation: (id: number) =>
    request<void>(`/vacations/${id}`, { method: "DELETE" }),

  history: (limit = 100, offset = 0) =>
    request<HistoryEntry[]>(`/history?limit=${limit}&offset=${offset}`),
  timesheet: (month: string) =>
    request<MonthTimesheet>(`/timesheet/${encodeURIComponent(month)}`),
  logs: (limit = 100, level?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (level && level !== "all") params.set("level", level);
    return request<LogEntry[]>(`/logs?${params.toString()}`);
  },

  runNow: () => request<RunNowResult>("/run-now", { method: "POST" }),
};
