import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { MonthlyTasksScreen } from "./screens/MonthlyTasksScreen";
import { ConfigScreen } from "./screens/ConfigScreen";
import { VacationsScreen } from "./screens/VacationsScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { LogsScreen } from "./screens/LogsScreen";
import { RunNowScreen } from "./screens/RunNowScreen";
import type { SessionInfo } from "../../src/shared/contract";

const screens = {
  tasks: { label: "Tasks do mês", render: MonthlyTasksScreen },
  config: { label: "Config", render: ConfigScreen },
  vacations: { label: "Férias", render: VacationsScreen },
  history: { label: "Histórico", render: HistoryScreen },
  logs: { label: "Logs", render: LogsScreen },
  run: { label: "Rodar agora", render: RunNowScreen },
} as const;

type ScreenKey = keyof typeof screens;

export function Shell({
  session,
  onSessionChange,
  onLoggedOut,
}: {
  session: SessionInfo | null;
  onSessionChange: (info: SessionInfo) => void;
  onLoggedOut: () => void;
}) {
  const [screen, setScreen] = useState<ScreenKey>("tasks");

  useEffect(() => {
    const id = window.setInterval(() => {
      api
        .session()
        .then(onSessionChange)
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 401) onLoggedOut();
        });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [onSessionChange, onLoggedOut]);

  const Current = screens[screen].render;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-base font-bold text-slate-800">jira-autowork</span>
          <nav className="flex flex-wrap gap-1">
            {Object.entries(screens).map(([key, def]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScreen(key as ScreenKey)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  screen === key
                    ? "bg-sky-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {def.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <SessionBadge session={session} />
            <button
              type="button"
              className="cursor-pointer text-slate-500 hover:text-slate-800"
              onClick={() => {
                void api.logout().finally(onLoggedOut);
              }}
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6">
        <Current />
      </main>
    </div>
  );
}

function SessionBadge({ session }: { session: SessionInfo | null }) {
  if (!session) return null;
  const label =
    session.status === "alive"
      ? `Sessão Jira ativa${session.displayName ? ` · ${session.displayName}` : ""}`
      : session.status === "dead"
        ? "Sessão Jira morta"
        : "Sessão Jira desconhecida";
  const style =
    session.status === "alive"
      ? "bg-emerald-100 text-emerald-800"
      : session.status === "dead"
        ? "bg-red-100 text-red-800"
        : "bg-slate-200 text-slate-600";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${style}`}>{label}</span>
  );
}
