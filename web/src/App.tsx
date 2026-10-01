import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { LoginScreen } from "./screens/LoginScreen";
import { Shell } from "./Shell";
import type { SessionInfo } from "../../src/shared/contract";

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authState, setAuthState] = useState<"checking" | "loggedOut" | "loggedIn" | "unavailable">(
    "checking",
  );

  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((info) => {
        if (cancelled) return;
        setSession(info);
        setAuthState("loggedIn");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setAuthState("loggedOut");
          return;
        }
        setAuthState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (authState === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500">Carregando…</p>
      </div>
    );
  }

  if (authState === "unavailable") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-800">jira-autowork</h1>
          <p className="text-sm text-slate-600">
            Não foi possível falar com o servidor. Verifique se o backend está no ar.
          </p>
          <button
            type="button"
            className="cursor-pointer rounded-lg bg-sky-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
            onClick={() => window.location.reload()}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (authState === "loggedOut") {
    return (
      <LoginScreen
        onLoggedIn={(info) => {
          setSession(info);
          setAuthState("loggedIn");
        }}
      />
    );
  }

  return (
    <Shell
      session={session}
      onSessionChange={setSession}
      onLoggedOut={() => {
        setSession(null);
        setAuthState("loggedOut");
      }}
    />
  );
}
