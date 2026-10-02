export const JIRA_BASE_URL = "https://umane.emeal.nttdata.com/jiraito";

export const WORK_SECONDS_PER_DAY = 28800;

export type JiraMyself = {
  name: string;
  key: string;
  emailAddress: string;
  displayName: string;
  active: boolean;
  timeZone: string;
};

export type JiraWorklog = {
  id: number;
  author: { name?: string; key?: string };
  started: string;
  timeSpentSeconds: number;
};

export type KeepaliveProbe = "alive" | "dead" | "network-error";

export type JiraClient = {
  getMyself(cookie: string): Promise<JiraMyself>;
  probeSession(cookie: string): Promise<KeepaliveProbe>;
  hasWorklogOnDate(
    cookie: string,
    date: string,
    username: string,
  ): Promise<boolean>;
  addWorklog(
    cookie: string,
    issueKey: string,
    started: string,
    timeSpentSeconds: number,
  ): Promise<{ worklogId: number }>;
};

export function formatStarted(date: string, timeZone = "America/Sao_Paulo"): string {
  const wall = new Date(`${date}T09:00:00Z`);
  const offset = timeZoneOffset(wall, timeZone);
  return `${date}T09:00:00.000${offset}`;
}

export function timeZoneOffset(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const name = parts.find((part) => part.type === "timeZoneName")?.value;
  if (name === "GMT" || name === undefined) return "+0000";
  const match = /GMT([+-])(\d{2}):?(\d{2})/.exec(name);
  if (!match) return "-0300";
  const [, sign, hours, minutes] = match;
  return `${sign}${hours}${minutes}`;
}

function authHeaders(cookie: string): Record<string, string> {
  return {
    Cookie: cookie,
    Accept: "application/json",
  };
}

function writeHeaders(cookie: string): Record<string, string> {
  return {
    ...authHeaders(cookie),
    "Content-Type": "application/json; charset=utf-8",
    "X-Atlassian-Token": "no-check",
  };
}

export type ProxyProvider = () => string;

export function createJiraClient(
  baseUrl = JIRA_BASE_URL,
  fetchFn: typeof fetch = fetch,
  getProxy: ProxyProvider = () => "",
): JiraClient {
  const jqlWorklogOnDate = (date: string, username: string) =>
    `worklogAuthor = "${username}" AND worklogDate = "${date.replaceAll("-", "/")}"`;

  const requestInit = (extra: RequestInit): RequestInit => {
    const proxy = getProxy().trim();
    if (!proxy) return extra;
    return { ...extra, proxy } as RequestInit;
  };

  return {
    async getMyself(cookie: string): Promise<JiraMyself> {
      const response = await fetchFn(
        `${baseUrl}/rest/api/2/myself`,
        requestInit({
          headers: authHeaders(cookie),
          redirect: "manual",
        }),
      );
      if (!response.ok) {
        throw new Error(`GET /myself falhou: HTTP ${response.status}`);
      }
      return (await response.json()) as JiraMyself;
    },
    async probeSession(cookie: string): Promise<KeepaliveProbe> {
      let response: Response;
      try {
        response = await fetchFn(
          `${baseUrl}/rest/api/2/myself`,
          requestInit({
            headers: authHeaders(cookie),
            redirect: "manual",
          }),
        );
      } catch {
        return "network-error";
      }
      if (response.status === 401 || response.status === 403 || response.status === 302) {
        return "dead";
      }
      if (response.status >= 500) {
        return "network-error";
      }
      if (!response.ok) {
        return "network-error";
      }
      try {
        const body = (await response.json()) as { active?: boolean };
        return body.active === false ? "dead" : "alive";
      } catch {
        return "network-error";
      }
    },
    async hasWorklogOnDate(
      cookie: string,
      date: string,
      username: string,
    ): Promise<boolean> {
      const jql = jqlWorklogOnDate(date, username);
      const pageSize = 50;
      let startAt = 0;
      let total = Infinity;
      while (startAt < total) {
        const url =
          `${baseUrl}/rest/api/2/search?jql=${encodeURIComponent(jql)}` +
          `&fields=worklog&maxResults=${pageSize}&startAt=${startAt}`;
        const response = await fetchFn(
          url,
          requestInit({
            headers: authHeaders(cookie),
            redirect: "manual",
          }),
        );
        if (!response.ok) {
          throw new Error(`JQL worklogDate falhou: HTTP ${response.status}`);
        }
        const body = (await response.json()) as {
          issues?: Array<{
            fields: {
              worklog?: {
                worklogs: Array<JiraWorklog>;
              };
            };
          }>;
          total?: number;
        };
        const issues = body.issues ?? [];
        for (const issue of issues) {
          const worklogs = issue.fields.worklog?.worklogs ?? [];
          const found = worklogs.some(
            (worklog) =>
              worklog.author.name === username &&
              worklog.started.slice(0, 10) === date,
          );
          if (found) return true;
        }
        if (issues.length === 0) return false;
        total = body.total ?? startAt + issues.length;
        startAt += issues.length;
      }
      return false;
    },
    async addWorklog(
      cookie: string,
      issueKey: string,
      started: string,
      timeSpentSeconds: number,
    ): Promise<{ worklogId: number }> {
      const url = `${baseUrl}/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog?adjustEstimate=leave`;
      const response = await fetchFn(
        url,
        requestInit({
          method: "POST",
          headers: writeHeaders(cookie),
          redirect: "manual",
          body: JSON.stringify({
            comment: "",
            started,
            timeSpentSeconds,
          }),
        }),
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `POST worklog ${issueKey} falhou: HTTP ${response.status} ${detail.slice(0, 300)}`,
        );
      }
      const body = (await response.json()) as { id: number };
      return { worklogId: Number(body.id) };
    },
  };
}
