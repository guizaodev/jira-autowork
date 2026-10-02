# BRIEF — jira-autowork (leia antes de escrever código)

Sistema de apontamento automático de horas no Jira Data Center da NTT (8h/dia útil).
Stack: **Bun 1.4 + TypeScript strict** · Backend **Elysia** · Painel **React 19 + Vite + Tailwind v4** · DB **bun:sqlite** · Validação **zod**.

## Fonte de verdade
- `docs/jira-ntt-recon.md` — recon completo da instância Jira (auth, endpoints, pegadinhas). **LEIA.**
- `src/shared/contract.ts` — tipos e contrato REST compartilhado backend/painel. **OBEDEÇA.**

## Regras de negócio (inabaláveis)
1. Jira base URL: `https://umane.emeal.nttdata.com/jiraito` (context path `/jiraito` SEMPRE)
2. Auth por cookie (`JSESSIONID=...; atlassian.xsrf.token=...; INGRESSCOOKIE=...`). Sem PAT, sem Basic.
3. Escrita (POST/PUT): headers `X-Atlassian-Token: no-check` + `Content-Type: application/json; charset=utf-8` + cookie
4. Worklog: `POST /rest/api/2/issue/{KEY}/worklog?adjustEstimate=leave`
   - body: `{"comment":"","started":"YYYY-MM-DDT09:00:00.000-0300","timeSpentSeconds":28800}`
   - `comment` NUNCA omitido (bug do plugin timesheet renderiza `undefined`). Sempre `""` salvo futuro campo.
5. Classificação do dia:
   - sáb/dom → `weekend` (nunca aponta)
   - feriado nacional/estadual(MG)/municipal(Uberlândia, IBGE 3170206)/facultativo(MG|uberl) em dia de semana → `holiday` → task de feriado
   - dentro de período de férias (dia de semana) → `vacation` → task de férias
   - caso contrário → `workday` → task do mês
6. Task do mês: tabela `monthly_tasks(month PK, issue_key)`. Mês sem mapping → usa mapping mais recente ANTERIOR (fallback) e emite warn (log + webhook 1x/dia). Nenhum mapping → não aponta + alerta.
7. Idempotência: ledger no SQLite (`history` com UNIQUE(date)) + verificação remota via JQL
   `worklogAuthor = currentUser() AND worklogDate = "YYYY/MM/DD"` antes de postar. Nunca duplicar.
8. Backfill: no boot e no job diário, varrer últimos 14 dias (inclusive hoje), completar dias úteis faltantes.
9. Scheduler interno: job diário às **09:05** America/Sao_Paulo + keepalive `/rest/api/2/myself` a cada 20min.
   - alive → silencioso; morto (401/302/403) → alerta webhook **1x** até voltar (aí confirma retorno); 5xx/erro rede → ignora.
10. Feriados: dataset `https://raw.githubusercontent.com/joaopbini/feriados-brasil/master/dados/feriados`
    - `nacional/csv/{ano}.csv` (todo) · `estadual/csv/{ano}.csv` (UF=MG, 5ª col) · `municipal/csv/{ano}.csv` (IBGE 3170206) · `facultativo/csv/{ano}.csv` (UF=MG ou nome contém "uberl")
    - CSV: `data dd/mm/aaaa | nome | ESCOPO | descrição | UF | IBGE` — **parse tolerante** (separador `;` ou `,`)
    - Cache em tabela `holidays_cache(ano PK, payload JSON)`, refresh no boot + 1º dia do mês. Falha de rede → usa cache; sem cache → alerta + dia tratado como workday (fail-open com warn).
11. Horário de verão: Brasil não tem mais DST, mas use `Intl` p/ formatar `-0300` a partir da data local — não hardcode além do offset calculado.
12. Proxy HTTP corporativo: setting `proxy_url` (`http://[user]:[pass]@[host]:[port]`, vazio = sem proxy) injetado em todo fetch de saída (Jira, CSVs de feriados, webhook de alerta) via `init.proxy` do Bun. Lido dinamicamente a cada request — mudança no painel vale sem restart. `GET /api/settings` devolve `proxyUrl` mascarado (`http://***:***@host:port`) quando há credenciais; `PUT` com valor mascarado preserva o atual e string vazia limpa.

## Banco (bun:sqlite, arquivo `/data/jira-autowork.db` ou `./data/dev.db` em dev)
Tabelas: `settings(k TEXT PK, v TEXT)` · `monthly_tasks(month TEXT PK, issue_key TEXT)` ·
`vacation_periods(id INTEGER PK AUTOINCREMENT, start_date, end_date, note)` ·
`history(id PK, date TEXT UNIQUE, day_kind, issue_key, worklog_id INTEGER, time_spent_seconds, status, detail, created_at)` ·
`logs(id PK, level, message, created_at)` · `holidays_cache(year INTEGER PK, payload TEXT)`.
WAL mode. Seed: settings default (holiday/vacation issue vazias, webhook vazio, proxy vazio, cookie de env `JIRA_COOKIE` se existir).

## Layout
```
src/core/     db.ts jira.ts holidays.ts calendar.ts applier.ts scheduler.ts alerter.ts
src/server/   index.ts (Elysia bootstrap, auth, serve estáticos de web/dist) routes.ts
src/shared/   contract.ts (JÁ EXISTE — não duplicar tipos)
web/          app React (vite.config.ts com proxy /api -> localhost:3000 em dev)
tests/        *.test.ts (bun test)
```

## Painel web (React + Tailwind v4)
Telas: Tasks do mês (CRUD) · Task feriado/férias (em Config) · Férias CRUD · Config (cookie, webhook, proxy HTTP corporativo, status sessão, testar conexão) · Histórico · Logs · Rodar agora (mostra RunNowResult por dia).
Auth: login simples com `PANEL_PASSWORD` (env) → cookie de sessão assinado (hmac sha256, segredo derivado da senha). Todas rotas `/api/*` (exceto /api/login) exigem sessão.

## Qualidade
- TS strict, zero `any`, exports nomeados, sem default exports
- Sem comentários no código
- `bun run typecheck` e `bun test` devem passar
- fetch nativo do Bun (sem axios/node-fetch)
- TZ do processo: sempre America/Sao_Paulo via `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })` p/ obter data local "YYYY-MM-DD" — nunca `new Date().toISOString()` direto para data de negócio

## Docker
- Multi-stage: stage 1 `oven/bun:1` builda `web/` (vite) ; stage 2 `oven/bun:1` copia src + web/dist, `ENV TZ=America/Sao_Paulo`, `VOLUME /data`, `EXPOSE 3000`, healthcheck em `/api/session` (sem auth? não — healthcheck público em `/healthz` -> 200 se processo vivo)
- docker-compose.yml exemplo: env JIRA_COOKIE, PANEL_PASSWORD, ALERT_WEBHOOK_URL, PORT=3000, DATA_DIR=/data
