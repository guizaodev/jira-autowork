import { describe, expect, test } from "bun:test";
import {
  addDays,
  classifyDay,
  daysBetween,
  enumerateDays,
  isInVacation,
  isWeekend,
  isValidDate,
  isValidMonth,
  localDateNow,
  monthOf,
  weekdayOf,
} from "../../src/core/calendar";
import { parseHolidayCsv, type Holiday } from "../../src/core/holidays";
import { holidaySet } from "../helpers";

const NACIONAL_2026 = `01/01/2026,Ano Novo,NACIONAL,,,
03/04/2026,Sexta-Feira Santa,NACIONAL,,,
21/04/2026,Dia de Tiradentes,NACIONAL,,,
01/05/2026,Dia do Trabalho,NACIONAL,,,
07/09/2026,Independência do Brasil,NACIONAL,,,
12/10/2026,Nossa Senhora Aparecida,NACIONAL,,,
02/11/2026,Dia de Finados,NACIONAL,,,
15/11/2026,Proclamação da República,NACIONAL,,,
20/11/2026,Consciência Negra,NACIONAL,,,
25/12/2026,Natal,NACIONAL,,,`;

const MUNICIPAL_UBERLANDIA_2026 = `03/04/2026,Sexta-Feira da Paixão,MUNICIPAL,Lei 2115,MG,3170206
04/06/2026,Corpus Christi,MUNICIPAL,Lei 2115,MG,3170206
15/08/2026,Nossa Senhora da Abadia,MUNICIPAL,Lei 2115,MG,3170206
31/08/2026,Aniversário de Uberlândia,MUNICIPAL,Lei 2115,MG,3170206`;

function realHolidays2026(): Holiday[] {
  return [
    ...parseHolidayCsv(NACIONAL_2026, "nacional"),
    ...parseHolidayCsv(MUNICIPAL_UBERLANDIA_2026, "municipal", {
      ibge: "3170206",
    }),
  ];
}

describe("calendar / datas", () => {
  test("isValidDate aceita ISO e rejeita lixo", () => {
    expect(isValidDate("2026-09-07")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("07/09/2026")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
  });

  test("isValidMonth valida YYYY-MM", () => {
    expect(isValidMonth("2026-09")).toBe(true);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-9")).toBe(false);
  });

  test("weekend sáb/dom", () => {
    expect(isWeekend("2026-09-05")).toBe(true);
    expect(isWeekend("2026-09-06")).toBe(true);
    expect(isWeekend("2026-09-07")).toBe(false);
  });

  test("addDays / daysBetween / enumerateDays / monthOf", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(daysBetween("2026-09-01", "2026-09-14")).toBe(13);
    expect(enumerateDays("2026-09-05", "2026-09-08")).toEqual([
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
    ]);
    expect(enumerateDays("2026-09-05", "2026-09-01")).toEqual([]);
    expect(monthOf("2026-09-30")).toBe("2026-09");
  });

  test("localDateNow usa TZ America/Sao_Paulo", () => {
    expect(localDateNow(new Date("2026-09-07T02:00:00Z"))).toBe("2026-09-06");
    expect(localDateNow(new Date("2026-09-07T12:00:00Z"))).toBe("2026-09-07");
    expect(weekdayOf("2026-09-07")).toBe(1);
  });
});

describe("calendar / classificação com feriados 2026 reais", () => {
  const holidays = holidaySet(2026, realHolidays2026());

  test("CAL-07/2026-09-07 Independência → holiday", () => {
    const result = classifyDay("2026-09-07", holidays, []);
    expect(result.dayKind).toBe("holiday");
    expect(result.holidayName).toBe("Independência do Brasil");
  });

  test("CAL-20/2026-11-20 Consciência Negra → holiday", () => {
    const result = classifyDay("2026-11-20", holidays, []);
    expect(result.dayKind).toBe("holiday");
    expect(result.holidayName).toBe("Consciência Negra");
  });

  test("CAL-31/2026-08-31 Aniversário de Uberlândia (municipal) → holiday", () => {
    const result = classifyDay("2026-08-31", holidays, []);
    expect(result.dayKind).toBe("holiday");
    expect(result.holidayName).toBe("Aniversário de Uberlândia");
  });

  test("workday comum", () => {
    expect(classifyDay("2026-09-30", holidays, []).dayKind).toBe("workday");
  });

  test("weekend vence feriado", () => {
    const saturdayHoliday = holidaySet(2026, [
      { date: "2026-09-05", name: "Feriado fake no sábado" },
    ]);
    expect(classifyDay("2026-09-05", saturdayHoliday, []).dayKind).toBe(
      "weekend",
    );
  });

  test("sem feriados carregados → workday", () => {
    expect(classifyDay("2026-09-07", null, []).dayKind).toBe("workday");
  });

  test("data inválida lança", () => {
    expect(() => classifyDay("2026-9-7", holidays, [])).toThrow();
  });
});

describe("calendar / férias", () => {
  const holidays = holidaySet(2026, realHolidays2026());

  test("dia de semana dentro das férias → vacation", () => {
    const vacations = [{ startDate: "2026-09-10", endDate: "2026-09-20" }];
    expect(classifyDay("2026-09-15", holidays, vacations).dayKind).toBe(
      "vacation",
    );
  });

  test("feriado sobrepondo férias → holiday vence", () => {
    const vacations = [{ startDate: "2026-09-01", endDate: "2026-09-15" }];
    const result = classifyDay("2026-09-07", holidays, vacations);
    expect(result.dayKind).toBe("holiday");
  });

  test("fim de semana sobrepondo férias → weekend vence", () => {
    const vacations = [{ startDate: "2026-09-01", endDate: "2026-09-30" }];
    expect(classifyDay("2026-09-05", holidays, vacations).dayKind).toBe(
      "weekend",
    );
  });

  test("limites inclusivos start/end", () => {
    const vacations = [{ startDate: "2026-09-10", endDate: "2026-09-20" }];
    expect(isInVacation("2026-09-10", vacations)).toBe(true);
    expect(isInVacation("2026-09-20", vacations)).toBe(true);
    expect(isInVacation("2026-09-21", vacations)).toBe(false);
    expect(isInVacation("2026-09-09", vacations)).toBe(false);
  });
});
