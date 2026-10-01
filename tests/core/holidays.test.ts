import { describe, expect, test } from "bun:test";
import {
  createHolidayStore,
  dedupeHolidays,
  normalizeDate,
  parseHolidayCsv,
  type Holiday,
} from "../../src/core/holidays";
import { makeFetchMock, makeTempDb, statusResponse } from "../helpers";

const CSV_COMMA =
  "07/09/2026,Independência,NACIONAL,desc,,,\n" +
  "31/08/2026,Aniversário de Uberlândia,MUNICIPAL,lei,MG,3170206\n";
const CSV_SEMICOLON =
  "20/11/2026;Consciência Negra;NACIONAL;lei;MG;3170206\n";

describe("holidays / parse", () => {
  test("normaliza dd/mm/aaaa e aaaa-mm-dd", () => {
    expect(normalizeDate("07/09/2026")).toBe("2026-09-07");
    expect(normalizeDate("2026-09-07")).toBe("2026-09-07");
    expect(normalizeDate("x/x/2026")).toBeNull();
  });

  test("separador ; e , e |", () => {
    expect(parseHolidayCsv(CSV_SEMICOLON, "nacional")[0]?.name).toBe(
      "Consciência Negra",
    );
    expect(parseHolidayCsv(CSV_COMMA, "nacional")).toHaveLength(2);
    const pipe = parseHolidayCsv(
      "07/09/2026|Independência,Nacional|NACIONAL",
      "nacional",
    );
    expect(pipe[0]?.date).toBe("2026-09-07");
  });

  test("filtro municipal por IBGE 3170206", () => {
    const all = parseHolidayCsv(CSV_COMMA, "municipal", { ibge: "3170206" });
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("Aniversário de Uberlândia");
  });

  test("filtro municipal ignora outro IBGE", () => {
    const csv =
      "31/08/2026,Feriado de outra cidade,MUNICIPAL,x,MG,3500000";
    expect(parseHolidayCsv(csv, "municipal", { ibge: "3170206" })).toHaveLength(
      0,
    );
  });

  test("filtro estadual UF=MG", () => {
    const csv =
      "22/01/2026,Dia do Católico,ESTADUAL,x,AC,\n" +
      "21/04/2026,Tiradentes,ESTADUAL,x,MG,";
    const mg = parseHolidayCsv(csv, "estadual", { uf: "MG" });
    expect(mg).toHaveLength(1);
    expect(mg[0]?.name).toBe("Tiradentes");
  });

  test("facultativo UF=MG ou nome contém uberl", () => {
    const csv =
      "16/02/2026,Carnaval,FACULTATIVO,x,SP,\n" +
      "17/02/2026,Aniversário Uberlândia,FACULTATIVO,x,,\n" +
      "18/02/2026,Feriado MG,FACULTATIVO,x,MG,";
    const filtered = parseHolidayCsv(csv, "facultativo", {
      uf: "MG",
      nameIncludes: "uberl",
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((h) => h.name)).toEqual([
      "Aniversário Uberlândia",
      "Feriado MG",
    ]);
  });

  test("dedupe prioriza escopo mais forte", () => {
    const entries: Holiday[] = [
      { date: "2026-09-07", name: "Facultativo", scope: "facultativo" },
      { date: "2026-09-07", name: "Nacional", scope: "nacional" },
      { date: "2026-09-07", name: "Municipal", scope: "municipal" },
    ];
    const result = dedupeHolidays(entries);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Nacional");
  });

  test("CSV real 2026 nacional contém 07/09 e 20/11", () => {
    const csv =
      "01/01/2026,Ano Novo,NACIONAL,,,\n" +
      "07/09/2026,Independência do Brasil,NACIONAL,,,\n" +
      "20/11/2026,Consciência Negra,NACIONAL,,,\n";
    const dates = parseHolidayCsv(csv, "nacional").map((h) => h.date);
    expect(dates).toContain("2026-09-07");
    expect(dates).toContain("2026-11-20");
  });
});

describe("holidays / store, cache e fail-open", () => {
  test("carrega da rede, persiste no cache e usa memória na 2ª chamada", async () => {
    const { db, cleanup } = makeTempDb();
    const calls: string[] = [];
    const mock = makeFetchMock((url) => {
      calls.push(url);
      if (url.includes("/nacional/")) {
        return new Response("07/09/2026,Independência,NACIONAL,,,\n");
      }
      if (url.includes("/municipal/")) {
        return new Response(
          "31/08/2026,Aniversário de Uberlândia,MUNICIPAL,lei,MG,3170206\n",
        );
      }
      return new Response("");
    });
    try {
      const store = createHolidayStore(db, mock.fn, "https://example.test");
      const set = await store.loadYear(2026);
      expect(set.source).toBe("network");
      const dates = set.holidays.map((h) => h.date);
      expect(dates).toContain("2026-09-07");
      expect(dates).toContain("2026-08-31");
      expect(calls).toHaveLength(4);

      await store.loadYear(2026);
      expect(calls).toHaveLength(4);
      expect(db.holidayCachePayload(2026)).toContain("2026-09-07");
    } finally {
      cleanup();
    }
  });

  test("falha de rede com cache → usa cache", async () => {
    const { db, cleanup } = makeTempDb();
    db.setHolidayCache(
      2026,
      JSON.stringify([
        { date: "2026-09-07", name: "Independência", scope: "nacional" },
      ]),
    );
    const mock = makeFetchMock(() => {
      throw new Error("network down");
    });
    try {
      const store = createHolidayStore(db, mock.fn, "https://example.test");
      const set = await store.loadYear(2026);
      expect(set.source).toBe("cache");
      expect(set.holidays).toHaveLength(1);
      const logs = db.listLogs(10, "warn");
      expect(logs.some((l) => l.message.includes("usando cache"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("falha de rede sem cache → fail-open workday + warn", async () => {
    const { db, cleanup } = makeTempDb();
    const mock = makeFetchMock(() => statusResponse(500));
    try {
      const store = createHolidayStore(db, mock.fn, "https://example.test");
      const set = await store.loadYear(2026);
      expect(set.holidays).toHaveLength(0);
      const logs = db.listLogs(10, "warn");
      expect(logs.some((l) => l.message.includes("fail-open"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("P1-3 falha parcial de CSV → preserva cache completo (source cache)", async () => {
    const { db, cleanup } = makeTempDb();
    const cached = [
      { date: "2026-09-07", name: "Independência", scope: "nacional" },
      { date: "2026-08-31", name: "Aniversário de Uberlândia", scope: "municipal" },
    ];
    db.setHolidayCache(2026, JSON.stringify(cached));
    const mock = makeFetchMock((url) => {
      if (url.includes("/nacional/")) {
        return new Response("07/09/2026,Independência,NACIONAL,,,\n");
      }
      return statusResponse(503);
    });
    try {
      const store = createHolidayStore(db, mock.fn, "https://example.test");
      const set = await store.loadYear(2026);
      expect(set.source).toBe("cache");
      expect(set.holidays).toHaveLength(2);
      expect(set.holidays.map((h) => h.date)).toContain("2026-08-31");
      expect(db.holidayCachePayload(2026)).toBe(JSON.stringify(cached));
      const logs = db.listLogs(10, "warn");
      expect(logs.some((l) => l.message.includes("falha parcial"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("P1-3 falha do CSV nacional → cache (nacional é obrigatório)", async () => {
    const { db, cleanup } = makeTempDb();
    db.setHolidayCache(
      2026,
      JSON.stringify([
        { date: "2026-09-07", name: "Independência", scope: "nacional" },
      ]),
    );
    const mock = makeFetchMock((url) => {
      if (url.includes("/nacional/")) return statusResponse(500);
      return new Response("31/08/2026,Aniversário,MUNICIPAL,lei,MG,3170206\n");
    });
    try {
      const store = createHolidayStore(db, mock.fn, "https://example.test");
      const set = await store.loadYear(2026);
      expect(set.source).toBe("cache");
      expect(set.holidays).toHaveLength(1);
      expect(set.holidays[0]?.date).toBe("2026-09-07");
    } finally {
      cleanup();
    }
  });

  test("P1-3 falha parcial sem cache → fail-open [] + warn", async () => {
    const { db, cleanup } = makeTempDb();
    const mock = makeFetchMock((url) => {
      if (url.includes("/nacional/")) {
        return new Response("07/09/2026,Independência,NACIONAL,,,\n");
      }
      return statusResponse(500);
    });
    try {
      const store = createHolidayStore(db, mock.fn, "https://example.test");
      const set = await store.loadYear(2026);
      expect(set.source).toBe("cache");
      expect(set.holidays).toHaveLength(0);
      expect(
        db
          .listLogs(10, "warn")
          .some((l) => l.message.includes("sem cache")),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("sucesso dos 4 CSVs persiste source network", async () => {
    const { db, cleanup } = makeTempDb();
    const mock = makeFetchMock((url) => {
      if (url.includes("/nacional/")) {
        return new Response("07/09/2026,Independência,NACIONAL,,,\n");
      }
      return new Response("");
    });
    try {
      const store = createHolidayStore(db, mock.fn, "https://example.test");
      await store.loadYear(2026);
      expect(db.holidayCachePayload(2026)).toContain("2026-09-07");
      store.invalidate?.(2026);
      const again = await store.loadYear(2026);
      expect(again.source).toBe("network");
    } finally {
      cleanup();
    }
  });
});
