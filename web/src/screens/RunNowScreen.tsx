import { useState } from "react";
import { api } from "../api";
import { Button, Card, DayKindBadge, ErrorText, formatDateTime, Spinner, StatusBadge } from "../components";
import { formatDateBR } from "../date";
import type { RunNowResult } from "../../../src/shared/contract";

export function RunNowScreen() {
  const [result, setResult] = useState<RunNowResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await api.runNow());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao executar");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card title="Rodar agora">
      <div className="space-y-5">
        <p className="text-sm text-slate-600">
          Executa o job síncrono para hoje + backfill dos últimos 14 dias.
        </p>
        <Button onClick={() => void run()} disabled={running}>
          {running ? "Executando…" : "Rodar agora"}
        </Button>
        <ErrorText>{error}</ErrorText>
        {running ? <Spinner label="Executando job…" /> : null}
        {result ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Executado em {formatDateTime(result.ranAt)} · {result.days.length} dia(s)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
                    <th className="py-2 pr-4">Data</th>
                    <th className="py-2 pr-4">Tipo</th>
                    <th className="py-2 pr-4">Ação</th>
                    <th className="py-2 pr-4">Issue</th>
                    <th className="py-2 pr-4">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {result.days.map((day) => (
                    <tr key={day.date} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-4 font-medium">{formatDateBR(day.date)}</td>
                      <td className="py-2 pr-4">
                        <DayKindBadge kind={day.dayKind} />
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={day.action} />
                      </td>
                      <td className="py-2 pr-4 font-mono">{day.issueKey ?? "—"}</td>
                      <td className="py-2 pr-4 max-w-64 text-slate-600">{day.detail || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
