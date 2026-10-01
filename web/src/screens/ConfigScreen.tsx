import { useEffect, useState } from "react";
import { api } from "../api";
import { Button, Card, ErrorText, Field, formatDateTime, inputClass, Spinner, useAsync } from "../components";
import type { AppSettings } from "../../../src/shared/contract";

interface FormState {
  holidayIssueKey: string;
  vacationIssueKey: string;
  alertWebhookUrl: string;
  jiraCookie: string;
}

const emptyForm: FormState = {
  holidayIssueKey: "",
  vacationIssueKey: "",
  alertWebhookUrl: "",
  jiraCookie: "",
};

export function ConfigScreen() {
  const { data, loading, error, reload } = useAsync(() => api.settings());
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setForm({
        holidayIssueKey: data.holidayIssueKey,
        vacationIssueKey: data.vacationIssueKey,
        alertWebhookUrl: data.alertWebhookUrl,
        jiraCookie: "",
      });
    }
  }, [data]);

  const update = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    setSaved(false);
    try {
      await api.saveSettings({
        holidayIssueKey: form.holidayIssueKey.trim(),
        vacationIssueKey: form.vacationIssueKey.trim(),
        alertWebhookUrl: form.alertWebhookUrl.trim(),
        ...(form.jiraCookie.trim().length > 0 ? { jiraCookie: form.jiraCookie.trim() } : {}),
      });
      setForm((prev) => ({ ...prev, jiraCookie: "" }));
      setSaved(true);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testConnection();
      setTestResult(result.ok ? `OK — ${result.message}` : `Falhou — ${result.message}`);
    } catch (err) {
      setTestResult(`Erro — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  const session = useAsync(() => api.session());

  return (
    <div className="space-y-6">
      <Card title="Configurações">
        <div className="space-y-5">
          {loading ? <Spinner /> : null}
          <ErrorText>{error}</ErrorText>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Issue key de feriado">
              <input
                type="text"
                value={form.holidayIssueKey}
                placeholder="PROJ-1"
                className={`${inputClass} uppercase`}
                onChange={(event) => update({ holidayIssueKey: event.target.value })}
              />
            </Field>
            <Field label="Issue key de férias">
              <input
                type="text"
                value={form.vacationIssueKey}
                placeholder="PROJ-2"
                className={`${inputClass} uppercase`}
                onChange={(event) => update({ vacationIssueKey: event.target.value })}
              />
            </Field>
            <Field label="Webhook de alertas">
              <input
                type="url"
                value={form.alertWebhookUrl}
                placeholder="https://…"
                className={inputClass}
                onChange={(event) => update({ alertWebhookUrl: event.target.value })}
              />
            </Field>
            <Field label="Cookie do Jira (deixe vazio para manter)">
              <input
                type="password"
                value={form.jiraCookie}
                placeholder="JSESSIONID=…; atlassian.xsrf.token=…"
                className={inputClass}
                onChange={(event) => update({ jiraCookie: event.target.value })}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={saving || loading}>
              {saving ? "Salvando…" : "Salvar configurações"}
            </Button>
            <Button variant="neutral" onClick={() => void testConnection()} disabled={testing}>
              {testing ? "Testando…" : "Testar conexão"}
            </Button>
            {saved ? <span className="text-sm text-emerald-700">Configurações salvas.</span> : null}
          </div>
          <ErrorText>{formError}</ErrorText>
          {testResult ? (
            <p
              className={`rounded-lg px-3 py-2 text-sm ${
                testResult.startsWith("OK")
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {testResult}
            </p>
          ) : null}
        </div>
      </Card>
      <Card title="Sessão Jira">
        <div className="space-y-3">
          <Button variant="neutral" onClick={() => void session.reload()} disabled={session.loading}>
            {session.loading ? "Verificando…" : "Atualizar sessão"}
          </Button>
          {session.loading ? <Spinner /> : null}
          {session.data ? (
            <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-2 text-sm">
              <dt className="font-medium text-slate-500">Status</dt>
              <dd>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    session.data.status === "alive"
                      ? "bg-emerald-100 text-emerald-800"
                      : session.data.status === "dead"
                        ? "bg-red-100 text-red-800"
                        : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {session.data.status === "alive"
                    ? "Ativa"
                    : session.data.status === "dead"
                      ? "Morta"
                      : "Desconhecida"}
                </span>
              </dd>
              <dt className="font-medium text-slate-500">Usuário</dt>
              <dd>
                {session.data.displayName
                  ? `${session.data.displayName} (${session.data.username ?? "?"})`
                  : "—"}
              </dd>
              <dt className="font-medium text-slate-500">Última verificação</dt>
              <dd>{session.data.lastCheck ? formatDateTime(session.data.lastCheck) : "—"}</dd>
            </dl>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
