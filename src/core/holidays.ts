import type { ProxyProvider } from "./jira";

export type HolidayScope = "nacional" | "estadual" | "municipal" | "facultativo";

export type Holiday = {
  date: string;
  name: string;
  scope: HolidayScope;
};

export type HolidaySet = {
  year: number;
  holidays: Holiday[];
  source: "network" | "cache";
};

export const HOLIDAY_BASE_URL =
  "https://raw.githubusercontent.com/joaopbini/feriados-brasil/master/dados/feriados";

export const UBERLANDIA_IBGE = "3170206";
export const STATE_UF = "MG";

export function parseHolidayCsv(
  csv: string,
  scope: HolidayScope,
  filter: { uf?: string; ibge?: string; nameIncludes?: string } = {},
): Holiday[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const holidays: Holiday[] = [];
  for (const line of lines) {
    const columns = splitCsvLine(line);
    const date = normalizeDate(columns[0] ?? "");
    if (!date) continue;
    const name = (columns[1] ?? "").trim();
    if (!name) continue;
    if (!matchesFilter(columns, filter)) continue;
    holidays.push({ date, name, scope });
  }
  return holidays;
}

function splitCsvLine(line: string): string[] {
  const separator = pickSeparator(line);
  const columns: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === separator && !inQuotes) {
      columns.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  columns.push(current.trim());
  return columns;
}

function pickSeparator(line: string): string {
  let best = ",";
  let bestCount = 0;
  for (const candidate of [";", ",", "|"]) {
    const count = countOccurrences(line, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function countOccurrences(text: string, char: string): number {
  let count = 0;
  for (const c of text) {
    if (c === char) count++;
  }
  return count;
}

function matchesFilter(
  columns: string[],
  filter: { uf?: string; ibge?: string; nameIncludes?: string },
): boolean {
  const uf = (columns[4] ?? "").trim().toUpperCase();
  const ibge = (columns[5] ?? "").trim();
  const name = (columns[1] ?? "").toLowerCase();
  if (filter.ibge) {
    if (ibge !== filter.ibge) return false;
  }
  if (filter.uf) {
    const nameMatch = filter.nameIncludes
      ? name.includes(filter.nameIncludes)
      : false;
    if (uf !== filter.uf && !nameMatch) return false;
  }
  return true;
}

export function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim();
  const slash = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (slash) {
    const [, dd, mm, yyyy] = slash;
    return `${yyyy}-${mm}-${dd}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

async function fetchCsv(
  url: string,
  fetchFn: typeof fetch,
  getProxy: ProxyProvider,
): Promise<string | null> {
  try {
    const proxy = getProxy().trim();
    const response = await fetchFn(
      url,
      proxy ? ({ proxy } as RequestInit) : undefined,
    );
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export type HolidayStore = {
  loadYear(year: number): Promise<HolidaySet>;
  invalidate?(year: number): void;
};

export function createHolidayStore(
  db: {
    holidayCachePayload(year: number): string | null;
    setHolidayCache(year: number, payload: string): void;
    addLog(level: "info" | "warn" | "error", message: string): void;
  },
  fetchFn: typeof fetch = fetch,
  baseUrl = HOLIDAY_BASE_URL,
  getProxy: ProxyProvider = () => "",
): HolidayStore {
  const memory = new Map<number, HolidaySet>();

  const persistCache = (set: HolidaySet): void => {
    const payload = JSON.stringify(set.holidays);
    db.setHolidayCache(set.year, payload);
  };

  const loadFromCache = (year: number): HolidaySet | null => {
    const payload = db.holidayCachePayload(year);
    if (!payload) return null;
    try {
      const holidays = JSON.parse(payload) as Holiday[];
      return { year, holidays, source: "cache" };
    } catch {
      return null;
    }
  };

  return {
    async loadYear(year: number): Promise<HolidaySet> {
      const cached = memory.get(year);
      if (cached) return cached;

      const results = await Promise.all([
        fetchCsv(`${baseUrl}/nacional/csv/${year}.csv`, fetchFn, getProxy),
        fetchCsv(`${baseUrl}/estadual/csv/${year}.csv`, fetchFn, getProxy),
        fetchCsv(`${baseUrl}/municipal/csv/${year}.csv`, fetchFn, getProxy),
        fetchCsv(`${baseUrl}/facultativo/csv/${year}.csv`, fetchFn, getProxy),
      ]);
      const [nacionalCsv, estadualCsv, municipalCsv, facultativoCsv] = results;

      // nacional é obrigatório; parcial preserva o cache em vez de sobrescrevê-lo
      const failed = results.filter((csv) => csv === null).length;
      if (nacionalCsv === null || failed > 0) {
        const fromCache = loadFromCache(year);
        if (fromCache) {
          db.addLog(
            "warn",
            `Feriados ${year}: falha parcial (${failed}/4 CSVs) — usando cache (${fromCache.holidays.length} entradas)`,
          );
          memory.set(year, fromCache);
          return fromCache;
        }
        db.addLog(
          "warn",
          `Feriados ${year}: falha parcial (${failed}/4 CSVs) e sem cache — dias tratados como workday (fail-open)`,
        );
        const empty: HolidaySet = { year, holidays: [], source: "cache" };
        memory.set(year, empty);
        return empty;
      }

      const holidays: Holiday[] = [
        ...parseHolidayCsv(nacionalCsv ?? "", "nacional"),
        ...parseHolidayCsv(estadualCsv ?? "", "estadual", { uf: STATE_UF }),
        ...parseHolidayCsv(municipalCsv ?? "", "municipal", {
          ibge: UBERLANDIA_IBGE,
        }),
        ...parseHolidayCsv(facultativoCsv ?? "", "facultativo", {
          uf: STATE_UF,
          nameIncludes: "uberl",
        }),
      ];
      const unique = dedupeHolidays(holidays);
      const set: HolidaySet = { year, holidays: unique, source: "network" };
      persistCache(set);
      memory.set(year, set);
      return set;
    },
    invalidate(year: number): void {
      memory.delete(year);
    },
  };
}

export function dedupeHolidays(holidays: Holiday[]): Holiday[] {
  const byDate = new Map<string, Holiday>();
  for (const holiday of holidays) {
    const existing = byDate.get(holiday.date);
    if (!existing) {
      byDate.set(holiday.date, holiday);
      continue;
    }
    const rank: Record<HolidayScope, number> = {
      nacional: 0,
      estadual: 1,
      municipal: 2,
      facultativo: 3,
    };
    if (rank[holiday.scope] < rank[existing.scope]) {
      byDate.set(holiday.date, holiday);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
