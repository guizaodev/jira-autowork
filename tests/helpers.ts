import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb, type Db } from "../src/core/db";
import type { HolidaySet } from "../src/core/holidays";
import type { JiraClient, KeepaliveProbe } from "../src/core/jira";

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export interface FetchMock {
  fn: typeof fetch;
  calls: FetchCall[];
}

export function makeFetchMock(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FetchMock {
  const calls: FetchCall[] = [];
  const fn = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function statusResponse(status: number): Response {
  return new Response(null, { status });
}

export function makeTempDb(): { db: Db; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "ja-test-"));
  const db = createDb(path.join(dir, "test.db"));
  const cleanup = (): void => {
    db.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { db, dir, cleanup };
}

export function emptyHolidaySet(year: number): HolidaySet {
  return { year, holidays: [], source: "cache" };
}

export function holidaySet(
  year: number,
  entries: Array<{ date: string; name: string }>,
): HolidaySet {
  return {
    year,
    holidays: entries.map((entry) => ({
      date: entry.date,
      name: entry.name,
      scope: "nacional" as const,
    })),
    source: "cache",
  };
}

export interface JiraMockHandle {
  jira: JiraClient;
  worklogs: Array<{
    issueKey: string;
    started: string;
    timeSpentSeconds: number;
  }>;
  jqlDates: string[];
  myselfCalls: () => number;
}

export function makeJiraMock(
  overrides: Partial<JiraClient> = {},
): JiraMockHandle {
  const worklogs: JiraMockHandle["worklogs"] = [];
  const jqlDates: string[] = [];
  let myselfCalls = 0;

  const base: JiraClient = {
    async getMyself() {
      myselfCalls++;
      return {
        name: "gmarquma",
        key: "JIRAUSER248916",
        emailAddress: "guilherme@emeal.nttdata.com",
        displayName: "Guilherme Marques Machado",
        active: true,
        timeZone: "America/Sao_Paulo",
      };
    },
    async probeSession(): Promise<KeepaliveProbe> {
      return "alive";
    },
    async hasWorklogOnDate(_cookie: string, date: string) {
      jqlDates.push(date);
      return false;
    },
    async addWorklog(
      _cookie: string,
      issueKey: string,
      started: string,
      timeSpentSeconds: number,
    ) {
      worklogs.push({ issueKey, started, timeSpentSeconds });
      return { worklogId: 1000 + worklogs.length };
    },
  };

  return {
    jira: { ...base, ...overrides },
    worklogs,
    jqlDates,
    myselfCalls: () => myselfCalls,
  };
}
