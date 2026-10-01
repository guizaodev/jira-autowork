import { useState } from "react";
import { api } from "../api";
import { Button, Card, ErrorText, Field, inputClass, Spinner, useAsync } from "../components";
import { formatDateBR } from "../date";
import type { VacationPeriod } from "../../../src/shared/contract";

export function VacationsScreen() {
  const { data, loading, error, reload } = useAsync(() => api.vacations());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const periods = data ?? [];

  const add = async () => {
    if (startDate.length === 0 || endDate.length === 0) {
      setFormError("Informe data inicial e final.");
      return;
    }
    if (endDate < startDate) {
      setFormError("Data final deve ser maior ou igual à inicial.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api.createVacation({ startDate, endDate, note: note.trim() });
      setStartDate("");
      setEndDate("");
      setNote("");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao criar período");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (period: VacationPeriod) => {
    setBusy(true);
    try {
      await api.deleteVacation(period.id);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao remover");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Períodos de férias">
      <div className="space-y-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Field label="Início">
            <input
              type="date"
              value={startDate}
              className={inputClass}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field label="Fim (inclusivo)">
            <input
              type="date"
              value={endDate}
              className={inputClass}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </Field>
          <Field label="Observação">
            <input
              type="text"
              value={note}
              placeholder="opcional"
              className={`${inputClass} w-52`}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Adicionar"}
          </Button>
        </form>
        <ErrorText>{formError}</ErrorText>
        <ErrorText>{error}</ErrorText>
        {loading ? (
          <Spinner />
        ) : periods.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum período de férias cadastrado.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
                <th className="py-2 pr-4">Início</th>
                <th className="py-2 pr-4">Fim</th>
                <th className="py-2 pr-4">Observação</th>
                <th className="py-2 pr-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium">{formatDateBR(period.startDate)}</td>
                  <td className="py-2 pr-4">{formatDateBR(period.endDate)}</td>
                  <td className="py-2 pr-4 text-slate-600">{period.note || "—"}</td>
                  <td className="py-2 pr-4 text-right">
                    <Button variant="danger" disabled={busy} onClick={() => void remove(period)}>
                      Remover
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
