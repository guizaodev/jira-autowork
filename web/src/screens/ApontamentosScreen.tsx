import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  Card,
  DayKindBadge,
  ErrorText,
  formatSeconds,
  Spinner,
  StatusBadge,
  useAsync,
} from "../components";
import { formatDateBR, saoPauloCurrentMonth } from "../date";
import type { HistoryEntry } from "../../../src/shared/contract";

const weekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function parseMonth(month: string): [number, number] {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw ?? "0");
  const m = Number(monthRaw ?? "1");
  return [year, m];
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = parseMonth(month);
  const date = new Date(year, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(month: string): string {
  const [year, m] = parseMonth(month);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
    new Date(year, m - 1, 1),
  );
}

export function ApontamentosScreen() {
  const [month, setMonth] = useState(saoPauloCurrentMonth);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(() => api.timesheet(month));
  const monthRef = useRef(month);

  useEffect(() => {
    if (monthRef.current === month) return;
    monthRef.current = month;
    void reload();
  }, [month, reload]);

  const days = data?.days ?? [];
  const byDate = new Map(days.map((day) => [day.date, day]));
  const [year, m] = parseMonth(month);
  const firstWeekday = new Date(year, m - 1, 1).getDay();
  const daysInMonth = new Date(year, m, 0).getDate();
  const selectedEntry = selected ? byDate.get(selected) ?? null : null;

  return (
    <Card title="Apontamentos">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="cursor-pointer rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-300"
              onClick={() => {
                setSelected(null);
                setMonth((prev) => shiftMonth(prev, -1));
              }}
            >
              Mês anterior
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-300"
              onClick={() => {
                setSelected(null);
                setMonth((prev) => shiftMonth(prev, 1));
              }}
            >
              Próximo mês
            </button>
          </div>
          <span className="text-sm font-semibold text-slate-700 capitalize">{formatMonth(month)}</span>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2">
            <p className="text-xs font-medium text-sky-700 uppercase">Total no mês</p>
            <p className="text-xl font-bold text-sky-800">
              {formatSeconds(data?.totalSeconds ?? 0)}
            </p>
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
        {loading ? (
          <Spinner />
        ) : (
          <div className={`grid gap-5 ${selected ? "lg:grid-cols-[1fr_20rem]" : ""}`}>
            <div>
              <div className="grid grid-cols-7 gap-1">
                {weekdays.map((label) => (
                  <div
                    key={label}
                    className="py-1 text-center text-xs font-semibold text-slate-500 uppercase"
                  >
                    {label}
                  </div>
                ))}
                {Array.from({ length: firstWeekday }).map((_, index) => (
                  <div key={`blank-${index}`} />
                ))}
                {Array.from({ length: daysInMonth }).map((_, index) => {
                  const day = index + 1;
                  const date = `${month}-${String(day).padStart(2, "0")}`;
                  const entry = byDate.get(date);
                  const isSelected = selected === date;
                  return (
                    <button
                      key={date}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelected(isSelected ? null : date)}
                      className={`flex min-h-20 cursor-pointer flex-col gap-1 rounded-lg border p-1.5 text-left transition ${
                        isSelected
                          ? "border-sky-500 bg-sky-50"
                          : entry
                            ? "border-slate-200 bg-white hover:border-sky-300"
                            : "border-slate-100 bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      <span className="text-xs font-semibold text-slate-600">{day}</span>
                      {entry ? (
                        <>
                          <DayKindBadge kind={entry.dayKind} />
                          {entry.status === "success" && entry.timeSpentSeconds > 0 ? (
                            <span className="text-xs font-medium text-slate-600">
                              {formatSeconds(entry.timeSpentSeconds)}
                            </span>
                          ) : (
                            <StatusBadge status={entry.status} />
                          )}
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Dias sem apontamento aparecem vazios. Clique em um dia para ver os detalhes.
              </p>
            </div>
            {selected ? (
              <DayDetail date={selected} entry={selectedEntry} />
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}

function DayDetail({ date, entry }: { date: string; entry: HistoryEntry | null }) {
  return (
    <aside className="h-fit space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-800">{formatDateBR(date)}</h3>
      {entry ? (
        <dl className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Tipo</dt>
            <dd>
              <DayKindBadge kind={entry.dayKind} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Status</dt>
            <dd>
              <StatusBadge status={entry.status} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Issue</dt>
            <dd className="font-mono text-slate-800">{entry.issueKey || "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Worklog</dt>
            <dd className="font-mono text-slate-800">{entry.worklogId ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Tempo</dt>
            <dd className="text-slate-800">{formatSeconds(entry.timeSpentSeconds)}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-slate-500">Detalhe</dt>
            <dd className="text-slate-800">{entry.detail || "—"}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-slate-500">Nenhum apontamento registrado neste dia.</p>
      )}
    </aside>
  );
}
