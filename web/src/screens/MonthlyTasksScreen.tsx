import { useState } from "react";
import { api } from "../api";
import { Button, Card, ErrorText, Field, inputClass, Spinner, useAsync } from "../components";
import { saoPauloCurrentMonth } from "../date";
import type { MonthlyTask } from "../../../src/shared/contract";

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export function MonthlyTasksScreen() {
  const { data, loading, error, reload } = useAsync(() => api.monthlyTasks());
  const [month, setMonth] = useState(saoPauloCurrentMonth);
  const [issueKey, setIssueKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const tasks = data ?? [];

  const save = async () => {
    if (!monthPattern.test(month) || issueKey.trim().length === 0) {
      setFormError("Informe mês (YYYY-MM) e issue key válidos.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api.saveMonthlyTask({ month, issueKey: issueKey.trim() });
      setIssueKey("");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (task: MonthlyTask) => {
    setBusy(true);
    try {
      await api.deleteMonthlyTask(task.month);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao remover");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Tasks do mês">
      <div className="space-y-5">
        <p className="text-sm text-slate-600">
          Mês sem task cadastrada não aponta nada até ser cadastrada. É possível pré-definir a task
          de meses futuros escolhendo o mês no campo acima.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label="Mês">
            <input
              type="month"
              value={month}
              className={inputClass}
              onChange={(event) => setMonth(event.target.value)}
            />
          </Field>
          <Field label="Issue key">
            <input
              type="text"
              value={issueKey}
              placeholder="PROJ-123"
              className={`${inputClass} w-44 uppercase`}
              onChange={(event) => setIssueKey(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Salvar"}
          </Button>
        </form>
        <ErrorText>{formError}</ErrorText>
        <ErrorText>{error}</ErrorText>
        {loading ? (
          <Spinner />
        ) : tasks.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhuma task cadastrada. Mês sem task não aponta nada até ser cadastrada.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
                <th className="py-2 pr-4">Mês</th>
                <th className="py-2 pr-4">Issue key</th>
                <th className="py-2 pr-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.month} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium">{task.month}</td>
                  <td className="py-2 pr-4 font-mono">{task.issueKey}</td>
                  <td className="py-2 pr-4 text-right">
                    <Button variant="danger" disabled={busy} onClick={() => void remove(task)}>
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
