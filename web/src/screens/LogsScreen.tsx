import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Button, Card, ErrorText, formatDateTime, Spinner } from "../components";
import type { LogEntry } from "../../../src/shared/contract";

const levels = ["all", "info", "warn", "error"] as const;
type Level = (typeof levels)[number];

const levelLabels: Record<Level, string> = {
  all: "Todos",
  info: "Info",
  warn: "Warn",
  error: "Error",
};

const levelStyles = {
  info: "bg-sky-100 text-sky-800",
  warn: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
} as const;

export function LogsScreen() {
  const [level, setLevel] = useState<Level>("all");
  const [autoReload, setAutoReload] = useState(false);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await api.logs(200, level === "all" ? undefined : level));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [level]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoReload) return;
    const id = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(id);
  }, [autoReload, load]);

  return (
    <Card title="Logs">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-lg border border-slate-300">
            {levels.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setLevel(value)}
                className={`cursor-pointer px-3 py-1.5 text-sm font-medium transition ${
                  level === value
                    ? "bg-sky-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {levelLabels[value]}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={autoReload}
              onChange={(event) => setAutoReload(event.target.checked)}
              className="h-4 w-4 accent-sky-600"
            />
            Atualizar a cada 10s
          </label>
          <Button variant="neutral" onClick={() => void load()} disabled={loading}>
            Atualizar
          </Button>
        </div>
        <ErrorText>{error}</ErrorText>
        {loading && entries === null ? (
          <Spinner />
        ) : (entries ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum log.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(entries ?? []).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start gap-3 py-2 text-sm">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${levelStyles[entry.level]}`}
                >
                  {entry.level}
                </span>
                <span className="min-w-32 text-slate-500">{formatDateTime(entry.createdAt)}</span>
                <span className="flex-1 break-words text-slate-700">{entry.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
