import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Card, DayKindBadge, ErrorText, formatDateTime, formatSeconds, Spinner, StatusBadge, useAsync } from "../components";
import { formatDateBR } from "../date";
import type { HistoryEntry } from "../../../src/shared/contract";

const pageSize = 100;

export function HistoryScreen() {
  const [page, setPage] = useState(0);
  const { data, loading, error, reload } = useAsync(() => api.history(pageSize, page * pageSize));
  const pageRef = useRef(page);

  useEffect(() => {
    if (pageRef.current === page) return;
    pageRef.current = page;
    void reload();
  }, [page, reload]);

  const entries = data ?? [];
  const hasPrev = page > 0;
  const hasNext = entries.length === pageSize;

  return (
    <Card title="Histórico de apontamentos">
      <div className="space-y-4">
        <ErrorText>{error}</ErrorText>
        {loading ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500">
            {page === 0
              ? "Nenhum apontamento registrado ainda."
              : "Fim do histórico."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
                  <th className="py-2 pr-4">Data</th>
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4">Issue</th>
                  <th className="py-2 pr-4">Tempo</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Detalhe</th>
                  <th className="py-2 pr-4">Criado em</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry: HistoryEntry) => (
                  <tr key={entry.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-4 font-medium">{formatDateBR(entry.date)}</td>
                    <td className="py-2 pr-4">
                      <DayKindBadge kind={entry.dayKind} />
                    </td>
                    <td className="py-2 pr-4 font-mono">{entry.issueKey}</td>
                    <td className="py-2 pr-4">{formatSeconds(entry.timeSpentSeconds)}</td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={entry.status} />
                    </td>
                    <td className="py-2 pr-4 max-w-56 text-slate-600">{entry.detail || "—"}</td>
                    <td className="py-2 pr-4 text-slate-500">{formatDateTime(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!hasPrev || loading}
            className="cursor-pointer rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}
          >
            Anterior
          </button>
          <span className="text-sm text-slate-500">Página {page + 1}</span>
          <button
            type="button"
            disabled={!hasNext || loading}
            className="cursor-pointer rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setPage((prev) => prev + 1)}
          >
            Próxima
          </button>
          <button
            type="button"
            onClick={() => void reload()}
            className="cursor-pointer text-sm text-slate-500 hover:text-slate-800"
          >
            Atualizar
          </button>
        </div>
      </div>
    </Card>
  );
}
