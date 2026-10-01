import type { Db } from "./db";
import type { JiraClient, KeepaliveProbe } from "./jira";
import type { SessionStatus } from "../shared/contract";

export type AlertPayload = {
  text: string;
  severity: "info" | "warn" | "error";
  timestamp: string;
};

export type Alerter = {
  sendAlert(payload: AlertPayload): Promise<void>;
  probeAndRecord(): Promise<KeepaliveProbe>;
};

export function createAlerter(deps: {
  db: Db;
  jira: JiraClient;
  fetchFn?: typeof fetch;
  now?: () => Date;
}): Alerter {
  const { db, jira } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => new Date());

  async function sendAlert(payload: AlertPayload): Promise<void> {
    const settings = db.getSettings();
    const url = settings.alertWebhookUrl?.trim();
    if (!url) {
      db.addLog("warn", `alerta não enviado (webhook não configurado): ${payload.text}`);
      return;
    }
    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: payload.text,
          severity: payload.severity,
          timestamp: payload.timestamp,
        }),
      });
      if (!response.ok) {
        db.addLog(
          "error",
          `webhook de alerta falhou: HTTP ${response.status} — ${payload.text}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.addLog("error", `webhook de alerta falhou: ${message} — ${payload.text}`);
    }
  }

  async function probeAndRecord(): Promise<KeepaliveProbe> {
    const settings = db.getSettings();
    const cookie = settings.jiraCookie;
    if (!cookie) {
      db.setSessionInfo({
        status: "unknown",
        lastCheck: now().toISOString(),
        username: null,
        displayName: null,
      });
      return "network-error";
    }
    const probe = await jira.probeSession(cookie);
    const status: SessionStatus =
      probe === "alive" ? "alive" : probe === "dead" ? "dead" : "unknown";
    const previous = db.getSessionInfo();
    let username = previous.username;
    let displayName = previous.displayName;
    if (probe === "alive") {
      try {
        const myself = await jira.getMyself(cookie);
        username = myself.name;
        displayName = myself.displayName;
      } catch {
        username = null;
        displayName = null;
      }
    }
    db.setSessionInfo({
      status,
      lastCheck: now().toISOString(),
      username,
      displayName,
    });
    if (probe === "dead") {
      db.addLog("error", "keepalive: sessão Jira expirada");
    } else if (probe === "network-error") {
      db.addLog("warn", "keepalive: falha de rede ao validar sessão");
    }
    return probe;
  }

  return { sendAlert, probeAndRecord };
}
