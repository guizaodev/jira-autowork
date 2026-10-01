# REVIEW CHECKLIST — jira-autowork (Lupa)

Checklist de revisão a aplicar quando Núcleo e Íris terminarem a implementação.
Base: `docs/BRIEF.md` + `src/shared/contract.ts` + `docs/jira-ntt-recon.md`.

## 1. Regras de negócio (correção)

- [ ] Base URL sempre `https://umane.emeal.nttdata.com/jiraito` com context path `/jiraito` em TODOS os endpoints (inclui keepalive `/rest/api/2/myself`).
- [ ] Worklog: `POST /rest/api/2/issue/{KEY}/worklog?adjustEstimate=leave` com body exatamente `{"comment":"","started":"YYYY-MM-DDT09:00:00.000-0300","timeSpentSeconds":28800}`.
- [ ] `comment` nunca omitido nem `undefined` (bug do plugin timesheet). Sempre `""`.
- [ ] 8h/dia = `timeSpentSeconds: 28800` fixo.
- [ ] Classificação do dia, nesta ordem: sáb/dom → `weekend`; feriado (nacional/MG/Uberlândia IBGE 3170206/facultativo MG|uberl) em dia de semana → `holiday`; dentro de férias (dia de semana) → `vacation`; senão `workday`.
- [ ] Fim de semana NUNCA aponta, mesmo dentro de férias/feriado.
- [ ] Task do mês: `monthly_tasks(month PK, issue_key)`; mês sem mapping → fallback para mapping mais recente ANTERIOR + warn (log + webhook 1x/dia); nenhum mapping → não aponta + alerta.
- [ ] Backfill: no boot e no job diário, últimos 14 dias INCLUSIVE hoje, completando apenas dias úteis faltantes.
- [ ] Scheduler: job diário às 09:05 America/Sao_Paulo; keepalive `/myself` a cada 20min.
- [ ] Keepalive: alive → silencioso; morto (401/302/403) → webhook 1x até voltar (confirma retorno); 5xx/erro de rede → ignora (sem alerta).
- [ ] Feriados: dataset joaopbini/feriados-brasil, 4 CSVs (nacional todo; estadual UF=MG 5ª col; municipal IBGE 3170206; facultativo UF=MG ou nome contém "uberl").
- [ ] Parse CSV tolerante: separador `;` OU `,`; formato `data dd/mm/aaaa | nome | ESCOPO | descrição | UF | IBGE`.
- [ ] Cache `holidays_cache(ano PK, payload JSON)`: refresh no boot + 1º dia do mês; falha de rede → usa cache; sem cache → alerta + dia tratado como workday (fail-open com warn).
- [ ] Horário de verão: offset `-0300` derivado via `Intl` da data local, não hardcode além do offset calculado.

## 2. Idempotência (nunca duplicar)

- [ ] Ledger SQLite: `history` com `UNIQUE(date)` — constraint real no schema.
- [ ] Verificação remota via JQL `worklogAuthor = currentUser() AND worklogDate = "YYYY/MM/DD"` ANTES de postar.
- [ ] Fluxo: checa ledger local → checa Jira remoto → posta → grava history. Sem janela de duplicação no run-now síncrono.
- [ ] Falha parcial (post OK, gravação falha): retry não duplica por causa da checagem remota.
- [ ] `worklogId` e `status` ("success"|"skipped"|"failed") gravados corretamente no history.

## 3. TZ / datas

- [ ] Data de negócio SEMPRE via `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })` → "YYYY-MM-DD".
- [ ] NUNCA `new Date().toISOString()` para data de negócio (UTC desloca o dia após meia-noite BRT).
- [ ] `started` do worklog: data local + `T09:00:00.000` + offset calculado via `Intl`.
- [ ] Mês "YYYY-MM" e datas "YYYY-MM-DD" consistentes com contract.ts.
- [ ] Job 09:05 agendado em America/Sao_Paulo (não UTC), inclusive com TZ do processo diferente.

## 4. Segurança do cookie

- [ ] Cookie Jira (`JSESSIONID`, `atlassian.xsrf.token`, `INGRESSCOOKIE`) nunca logado em `logs` nem retornado em `detail`/erros.
- [ ] `GET /api/settings` retorna cookie MASCARADO (contract: `jiraCookie` mascarado na leitura).
- [ ] `PUT /api/settings`: `jiraCookie` ausente/vazio → mantém atual (nunca apaga por acidente).
- [ ] Cookie não exposto em stack traces / mensagens de erro do fetch.
- [ ] Painel: login com `PANEL_PASSWORD` (env); cookie de sessão assinado HMAC-SHA256 com segredo derivado da senha.
- [ ] TODAS as rotas `/api/*` (exceto `/api/login`) exigem sessão válida — inclusive `/api/run-now`, `/api/test-connection`, `/api/settings`.
- [ ] Cookie de sessão: `HttpOnly`, `SameSite` adequado; comparação de senha/HMAC em tempo constante (ou ao menos não trivialmente quebrável).
- [ ] `/healthz` público e sem auth (healthcheck Docker), 200 se processo vivo.
- [ ] `PANEL_PASSWORD` ausente → login desabilitado de forma segura (não aceita senha vazia).

## 5. Headers Jira

- [ ] Escrita (POST/PUT): `X-Atlassian-Token: no-check` + `Content-Type: application/json; charset=utf-8` + cookie — os três, sempre.
- [ ] Leitura: cookie presente; sem PAT/Basic em lugar nenhum.
- [ ] Tratamento de 302 (redirect para login) como sessão morta, não como erro genérico.

## 6. Contrato REST (contract.ts)

- [ ] Tipos de `src/shared/contract.ts` usados como fonte única — nenhum tipo duplicado em `src/server/` ou `web/`.
- [ ] Rotas e shapes conforme comentários do contract: `POST /api/login` → 204 + cookie; `POST /api/logout` → 204; `GET /api/session` → SessionInfo; `GET/PUT /api/settings`; `GET/PUT/DELETE /api/monthly-tasks` (upsert + delete por `:month`); `GET/POST/DELETE /api/vacations`; `GET /api/history?limit&offset`; `GET /api/logs?limit&level`; `POST /api/run-now` → RunNowResult; `POST /api/test-connection` → `{ ok, message }`.
- [ ] `RunNowResult.days[].action` ∈ "logged"|"skipped"|"failed"; `issueKey` nullable quando não aplicável.
- [ ] Validação de input com zod nas rotas (month "YYYY-MM", datas "YYYY-MM-DD", limit/level válidos).
- [ ] DELETE `/api/monthly-tasks/:month` com month URL-encoded ("YYYY-MM" contém `-`, ok, mas validar formato).

## 7. Qualidade TypeScript / estilo

- [ ] TS strict, zero `any` (nem `as any`, nem `any` implícito em catch).
- [ ] Sem comentários no código (contract.ts já existente é exceção aceita).
- [ ] Exports nomeados; nenhum default export.
- [ ] fetch nativo do Bun; sem axios/node-fetch.
- [ ] Bun APIs idiomáticas (`bun:sqlite`, `Bun.file`, etc.).
- [ ] Elysia: padrões corretos de plugin/rotas, tipagem de context, sem `any` em handlers.
- [ ] React 19: regras de hooks, sem default export de componentes, sem `any` em props/estado.
- [ ] `bun run typecheck` e `bun test` passam.

## 8. Banco / seed

- [ ] Schema conforme BRIEF: `settings`, `monthly_tasks`, `vacation_periods`, `history` (UNIQUE date), `logs`, `holidays_cache`.
- [ ] WAL mode ativado.
- [ ] DB em `/data/jira-autowork.db` (prod) ou `./data/dev.db` (dev) conforme env.
- [ ] Seed: settings default + cookie de env `JIRA_COOKIE` se existir.
- [ ] Prepared statements (sem concatenação de SQL).

## 9. Docker / infra

- [ ] Multi-stage: stage 1 builda `web/` (vite); stage 2 copia `src` + `web/dist`.
- [ ] `ENV TZ=America/Sao_Paulo`, `VOLUME /data`, `EXPOSE 3000`.
- [ ] Healthcheck público em `/healthz` (não em `/api/session`).
- [ ] compose com env JIRA_COOKIE, PANEL_PASSWORD, ALERT_WEBHOOK_URL, PORT, DATA_DIR.

## 10. Cobertura de testes (flag para Sentinel)

- [ ] Classificação de dia (weekend/holiday/vacation/workday, ordem de precedência).
- [ ] Fallback de monthly_tasks + caso sem mapping.
- [ ] Idempotência (ledger + JQL remoto, retry pós-falha parcial).
- [ ] TZ: datas perto de meia-noite, offset `-0300` via Intl.
- [ ] Parse CSV tolerante (`;` e `,`).
- [ ] Mascaramento do cookie em /api/settings.
- [ ] Auth do painel (rotas protegidas, login/logout, cookie assinado).
- [ ] Backfill 14 dias inclusive hoje.
