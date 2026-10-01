import { describe, expect, test } from "bun:test";
import {
  createJiraClient,
  formatStarted,
  JIRA_BASE_URL,
  timeZoneOffset,
  WORK_SECONDS_PER_DAY,
} from "../../src/core/jira";
import { jsonResponse, makeFetchMock, statusResponse } from "../helpers";

const COOKIE =
  "JSESSIONID=abc; atlassian.xsrf.token=tok; INGRESSCOOKIE=ing";

describe("jira / payload e headers exatos do worklog", () => {
  test("formatStarted gera 09:00:00.000-0300 (America/Sao_Paulo)", () => {
    expect(formatStarted("2026-09-07")).toBe(
      "2026-09-07T09:00:00.000-0300",
    );
    expect(timeZoneOffset(new Date("2026-09-07T09:00:00Z"), "America/Sao_Paulo")).toBe(
      "-0300",
    );
  });

  test("JIRA_BASE_URL inclui context path /jiraito", () => {
    expect(JIRA_BASE_URL).toContain("/jiraito");
    expect(JIRA_BASE_URL.endsWith("/jiraito")).toBe(true);
  });

  test("addWorklog: URL, query, headers e body byte-exatos", async () => {
    const mock = makeFetchMock(() => jsonResponse({ id: 33884533 }, 201));
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);

    const result = await client.addWorklog(
      COOKIE,
      "ITAUADQUIR-901",
      formatStarted("2026-09-07"),
      WORK_SECONDS_PER_DAY,
    );

    expect(result.worklogId).toBe(33884533);
    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0]!;

    expect(call.url).toBe(
      "https://jira.test/jiraito/rest/api/2/issue/ITAUADQUIR-901/worklog?adjustEstimate=leave",
    );
    const headers = call.init?.headers as Record<string, string>;
    expect(headers["X-Atlassian-Token"]).toBe("no-check");
    expect(headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(headers.Cookie).toBe(COOKIE);

    const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["comment", "started", "timeSpentSeconds"].sort(),
    );
    expect(body.comment).toBe("");
    expect(body.started).toBe("2026-09-07T09:00:00.000-0300");
    expect(body.timeSpentSeconds).toBe(28800);
  });

  test("comment nunca é omitido (presente e vazio)", async () => {
    const mock = makeFetchMock(() => jsonResponse({ id: 1 }, 201));
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);
    await client.addWorklog(COOKIE, "ITAUADQUIR-901", formatStarted("2026-09-08"), 28800);
    const body = JSON.parse(String(mock.calls[0]?.init?.body)) as Record<
      string,
      unknown
    >;
    expect("comment" in body).toBe(true);
    expect(body.comment).toBe("");
  });

  test("addWorklog propaga erro HTTP com status", async () => {
    const mock = makeFetchMock(() => new Response("boom", { status: 400 }));
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);
    await expect(
      client.addWorklog(COOKIE, "ITAUADQUIR-901", formatStarted("2026-09-07"), 28800),
    ).rejects.toThrow(/HTTP 400/);
  });
});

describe("jira / sessão e keepalive", () => {
  test("probeSession alive para 200 active:true", async () => {
    const mock = makeFetchMock(() => jsonResponse({ name: "g", active: true }));
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);
    expect(await client.probeSession(COOKIE)).toBe("alive");
    const headers = mock.calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Cookie).toBe(COOKIE);
    expect(mock.calls[0]?.url).toBe(
      "https://jira.test/jiraito/rest/api/2/myself",
    );
  });

  test("probeSession dead para 401", async () => {
    const mock = makeFetchMock(() => statusResponse(401));
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);
    expect(await client.probeSession(COOKIE)).toBe("dead");
  });

  test("probeSession dead para 302 (redirect login)", async () => {
    const mock = makeFetchMock(() => statusResponse(302));
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);
    expect(await client.probeSession(COOKIE)).toBe("dead");
    expect(mock.calls[0]?.init?.redirect).toBe("manual");
  });

  test("probeSession dead para 403", async () => {
    const mock = makeFetchMock(() => statusResponse(403));
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);
    expect(await client.probeSession(COOKIE)).toBe("dead");
  });

  test("probeSession network-error para 5xx e exceção", async () => {
    const server = makeFetchMock(() => statusResponse(503));
    const c1 = createJiraClient("https://jira.test/jiraito", server.fn);
    expect(await c1.probeSession(COOKIE)).toBe("network-error");

    const thrown = makeFetchMock(() => {
      throw new Error("ECONNREFUSED");
    });
    const c2 = createJiraClient("https://jira.test/jiraito", thrown.fn);
    expect(await c2.probeSession(COOKIE)).toBe("network-error");
  });

  test("probeSession dead se active:false", async () => {
    const mock = makeFetchMock(() => jsonResponse({ active: false }));
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);
    expect(await client.probeSession(COOKIE)).toBe("dead");
  });
});

describe("jira / JQL de idempotência", () => {
  test("hasWorklogOnDate monta JQL worklogAuthor/currentUser e worklogDate", async () => {
    const mock = makeFetchMock(() => jsonResponse({ issues: [] }));
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);

    const found = await client.hasWorklogOnDate(
      COOKIE,
      "2026-09-07",
      "gmarquma",
    );

    expect(found).toBe(false);
    const url = mock.calls[0]!.url;
    expect(url).toContain("/rest/api/2/search?jql=");
    const jql = decodeURIComponent(url.split("jql=")[1]!.split("&")[0]!);
    expect(jql).toContain('worklogAuthor = "gmarquma"');
    expect(jql).toContain('worklogDate = "2026/09/07"');
  });

  test("hasWorklogOnDate retorna true se worklog do autor na data", async () => {
    const mock = makeFetchMock(() =>
      jsonResponse({
        issues: [
          {
            fields: {
              worklog: {
                worklogs: [
                  {
                    id: 5,
                    author: { name: "gmarquma" },
                    started: "2026-09-07T12:00:00.000-0300",
                    timeSpentSeconds: 28800,
                  },
                ],
              },
            },
          },
        ],
      }),
    );
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);
    expect(await client.hasWorklogOnDate(COOKIE, "2026-09-07", "gmarquma")).toBe(
      true,
    );
  });

  test("hasWorklogOnDate ignora worklog de outro autor/data", async () => {
    const mock = makeFetchMock(() =>
      jsonResponse({
        issues: [
          {
            fields: {
              worklog: {
                worklogs: [
                  {
                    id: 5,
                    author: { name: "outro" },
                    started: "2026-09-07T12:00:00.000-0300",
                    timeSpentSeconds: 28800,
                  },
                ],
              },
            },
          },
        ],
      }),
    );
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);
    expect(await client.hasWorklogOnDate(COOKIE, "2026-09-07", "gmarquma")).toBe(
      false,
    );
  });

  test("getMyself retorna username e displayName", async () => {
    const mock = makeFetchMock(() =>
      jsonResponse({
        name: "gmarquma",
        displayName: "Guilherme Marques Machado",
        active: true,
      }),
    );
    const client = createJiraClient("https://jira.test/jiraito", mock.fn);
    const myself = await client.getMyself(COOKIE);
    expect(myself.name).toBe("gmarquma");
    expect(myself.displayName).toBe("Guilherme Marques Machado");
  });
});
