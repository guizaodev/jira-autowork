import path from "node:path";
import { createDb, defaultDbPath } from "./core/db";
import { createJiraClient } from "./core/jira";
import { createHolidayStore } from "./core/holidays";
import { createAlerter } from "./core/alerter";
import { createApplier } from "./core/applier";
import { createScheduler } from "./core/scheduler";
import { createApp } from "./server";

const PORT = Number(process.env.PORT ?? 3000);
const PASSWORD = process.env.PANEL_PASSWORD ?? "";

if (!PASSWORD && process.env.NODE_ENV === "production") {
  console.error("PANEL_PASSWORD é obrigatória em produção (NODE_ENV=production)");
  process.exit(1);
}
const EFFECTIVE_PASSWORD = PASSWORD || "dev";

const db = createDb(defaultDbPath());
const jira = createJiraClient();
const holidays = createHolidayStore(db);
const alerter = createAlerter({ db, jira });
const applier = createApplier({ db, jira, holidays, alerter });
const scheduler = createScheduler({ db, applier, alerter, holidays });

const app = createApp({
  db,
  applier,
  alerter,
  jira,
  password: EFFECTIVE_PASSWORD,
  webDistDir: path.join(process.cwd(), "web", "dist"),
});

scheduler.start();

app.listen(PORT);

db.addLog("info", `servidor iniciado na porta ${PORT}`);

const shutdown = (): void => {
  scheduler.stop();
  db.addLog("info", "servidor encerrado");
  db.sqlite.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("uncaughtException", (error) => {
  db.addLog("error", `uncaughtException: ${error.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  db.addLog(
    "error",
    `unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`,
  );
  process.exit(1);
});

console.log(`jira-autowork rodando em http://localhost:${PORT}`);
