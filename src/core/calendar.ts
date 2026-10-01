import type { DayKind } from "../shared/contract";
import type { HolidaySet } from "./holidays";

export type VacationRange = {
  startDate: string;
  endDate: string;
};

export type DayClassification = {
  date: string;
  dayKind: DayKind;
  holidayName: string | null;
};

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  );
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const day = weekdayOf(date);
  return day === 0 || day === 6;
}

export function isInVacation(date: string, periods: VacationRange[]): boolean {
  return periods.some(
    (period) => date >= period.startDate && date <= period.endDate,
  );
}

export function classifyDay(
  date: string,
  holidays: HolidaySet | null,
  vacations: VacationRange[],
): DayClassification {
  if (!isValidDate(date)) {
    throw new Error(`Data inválida: ${date}`);
  }
  if (isWeekend(date)) {
    return { date, dayKind: "weekend", holidayName: null };
  }
  const holiday = findHoliday(date, holidays);
  if (holiday) {
    return { date, dayKind: "holiday", holidayName: holiday };
  }
  if (isInVacation(date, vacations)) {
    return { date, dayKind: "vacation", holidayName: null };
  }
  return { date, dayKind: "workday", holidayName: null };
}

export function findHoliday(
  date: string,
  holidays: HolidaySet | null,
): string | null {
  if (!holidays) return null;
  const found = holidays.holidays.find((holiday) => holiday.date === date);
  return found ? found.name : null;
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T12:00:00Z`);
  const b = Date.parse(`${end}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function enumerateDays(start: string, end: string): string[] {
  const total = daysBetween(start, end);
  if (total < 0) return [];
  const days: string[] = [];
  for (let i = 0; i <= total; i++) {
    days.push(addDays(start, i));
  }
  return days;
}

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function localDateNow(now: Date = new Date()): string {
  return dateFormatter.format(now);
}

export function localMinutesNow(now: Date = new Date()): number {
  const parts = timeFormatter.formatToParts(now);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return Number(hour) * 60 + Number(minute);
}
