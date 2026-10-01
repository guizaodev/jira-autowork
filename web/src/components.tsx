import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DayKind } from "../../src/shared/contract";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold tracking-wide text-slate-700 uppercase">
        {title}
      </h2>
      <div className="p-5">{children}</div>
    </section>
  );
}

const buttonVariants = {
  primary: "bg-sky-600 text-white hover:bg-sky-700 disabled:bg-sky-300",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  neutral: "bg-slate-200 text-slate-800 hover:bg-slate-300 disabled:opacity-50",
} as const;

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: keyof typeof buttonVariants;
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${buttonVariants[variant]}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200";

export function Spinner({ label = "Carregando…" }: { label?: string }) {
  return <p className="text-sm text-slate-500">{label}</p>;
}

export function ErrorText({ children }: { children: unknown }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {String(children)}
    </p>
  );
}

export function useAsync<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      if (generation !== generationRef.current) return;
      setData(result);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR");
}

export function formatSeconds(total: number): string {
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}

const dayKindLabels = {
  workday: "Dia útil",
  holiday: "Feriado",
  vacation: "Férias",
  weekend: "Fim de semana",
} as const;

const dayKindStyles = {
  workday: "bg-sky-100 text-sky-800",
  holiday: "bg-amber-100 text-amber-800",
  vacation: "bg-violet-100 text-violet-800",
  weekend: "bg-slate-200 text-slate-600",
} as const;

export function DayKindBadge({ kind }: { kind: DayKind }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${dayKindStyles[kind]}`}
    >
      {dayKindLabels[kind]}
    </span>
  );
}

const statusStyles = {
  success: "bg-emerald-100 text-emerald-800",
  logged: "bg-emerald-100 text-emerald-800",
  skipped: "bg-slate-200 text-slate-600",
  failed: "bg-red-100 text-red-800",
} as const;

const statusLabels = {
  success: "sucesso",
  logged: "apontado",
  skipped: "ignorado",
  failed: "falha",
} as const;

export function StatusBadge({ status }: { status: keyof typeof statusStyles }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${statusStyles[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}
