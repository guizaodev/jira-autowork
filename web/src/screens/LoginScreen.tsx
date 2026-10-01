import { useState } from "react";
import { api } from "../api";
import { Button, ErrorText, Field, inputClass } from "../components";
import type { SessionInfo } from "../../../src/shared/contract";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (info: SessionInfo) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      const info = await api.session();
      onLoggedIn(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-center text-xl font-bold text-slate-800">jira-autowork</h1>
        <p className="text-center text-sm text-slate-500">Painel de apontamento automático</p>
        <Field label="Senha do painel">
          <input
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            className={inputClass}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy || password.length === 0}>
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
