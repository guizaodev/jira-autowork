# Plano de Testes — jira-autowork

Status: **implementado** — 117 testes em `tests/**`, `bun test` verde e `tsc --noEmit` limpo.
Runner: `bun test`. Mock de rede via injeção de `fetch`/client (nunca rede real). DB temporário por teste (`makeTempDb`).
Fixtures/mocks: `tests/helpers.ts` (fetch mock com captura de calls, DB temp, holiday set, Jira mock, alerter mock).

## Cobertura implementada

- `tests/core/calendar.test.ts` — datas, weekend, feriados 2026 reais (07/09, 20/11, 31/08 Uberlândia), férias sobrepondo feriado/weekend, limites inclusivos.
- `tests/core/holidays.test.ts` — parse `,`/`;`/`|`, filtros nacional/estadual-MG/municipal-IBGE/facultativo, dedupe por precedência, cache+boot, fail-open; **P1-3**: falha parcial de CSV preserva cache completo (`source:"cache"`), falha do CSV nacional idem, falha parcial sem cache → fail-open `[]` + warn, sucesso dos 4 CSVs persiste `source:"network"` + `invalidate()`.
- `tests/core/jira.test.ts` — payload byte-exato do worklog (`comment:""`, `started` `-0300`, 28800s, `adjustEstimate=leave`, `X-Atlassian-Token: no-check`), 401/302/403 → dead, 5xx → network-error, JQL `worklogAuthor`/`worklogDate`.
- `tests/core/db.test.ts` — `historyForMonth`: mês sem dados → `[]`, filtra/ordena por mês, dados mistos (success/failed/skipped) preservam status e `timeSpentSeconds`, upsert no mesmo dia não duplica.
- `tests/core/applier.test.ts` — log normal, feriado/férias/fim de semana, idempotência local (UNIQUE date) e remota (JQL), backfill 14 dias, **sem fallback de mês** (mês exato; sem mapping → dia útil `skipped` com detail "task do mês não cadastrada" + alerta webhook 1x/dia tipo `no-mapping`, 0 POST), mês anterior dentro da janela de backfill não é apontado, falha → failed, shape do `RunNowResult`; **P1-4**: username vazio → dia `failed` ("sessão Jira inválida"), 0 POSTs e 0 JQLs, ledger `failed`; username resolvido via `getMyself` quando ausente na sessão; **meia-noite TZ**: 23:30 BRT = dia corrente, 00:30 BRT = dia seguinte, 23:59 vs 00:01 muda a data de negócio, `started` sempre `-0300`.
- `tests/core/scheduler.test.ts` — job 09:05 1x/dia, catch-up de boot não marca o dia (09:05 do mesmo dia ainda roda), refresh de feriados no boot e na virada de mês, keepalive, webhook alerta 1x + confirmação de retorno, network-error não alerta.
- `tests/core/alerter.test.ts` — POST webhook, sem webhook → warn, `probeAndRecord` (alive/dead/network-error) e SessionInfo.
- `tests/server/auth.test.ts` — issue/verify token (formato `expires.nonce.hmac`), expiração, adulteração, máscara de cookie.
- `tests/server/routes.test.ts` — 401 sem sessão, login/logout, settings (máscara + preservação), CRUD monthly-tasks/vacations + validação, history/logs, **GET `/api/timesheet/:month`** (200 com soma de `success` apenas; failed/skipped não somam; mês vazio → 0; 400 mês inválido; 401 sem sessão; isola dias do mês), test-connection, run-now; **P2-4**: run-now concorrente → 409 `{ message: "Execução já em andamento" }`, libera lock ao terminar e aceita nova chamada; **P1-1**: `cookieSecure=false` → sem `Secure`, `=true` → `Secure`, `auto` + `x-forwarded-proto: https` → `Secure`, `auto` HTTP puro → sem `Secure`.



## Estrutura prevista

```
tests/shared/contract.test.ts      — tipos/contrato (sanity, zod schemas se houver)
tests/core/calendar.test.ts        — classificação de dias
tests/core/holidays.test.ts        — dataset, parse CSV, cache, fail-open
tests/core/jira.test.ts            — payloads, headers, sessão
tests/core/applier.test.ts         — idempotência, backfill, fallback de mês
tests/core/scheduler.test.ts       — job 09:05, keepalive 20min, alerta 1x
tests/server/routes.test.ts        — API REST Elysia (auth, CRUD, run-now)
```

## Matriz de casos

### 1. Calendar (`calendar.ts`)

| ID | Caso | Entrada | Esperado |
|---|---|---|---|
| CAL-01 | Sábado | 2026-09-05 (sáb) | `weekend`, nunca aponta |
| CAL-02 | Domingo | 2026-09-06 (dom) | `weekend` |
| CAL-03 | Feriado nacional 07/09 | 2026-09-07 (seg) | `holiday` → task de feriado |
| CAL-04 | Feriado nacional 20/11 | 2026-11-20 (sex) | `holiday` |
| CAL-05 | Feriado municipal Uberlândia 31/08 | 2026-08-31 (seg, IBGE 3170206) | `holiday` |
| CAL-06 | Feriado em fim de semana | feriado nacional caindo em sáb/dom | `weekend` (weekend vence) |
| CAL-07 | Férias em dia de semana | período 2026-09-10..09-20, data 2026-09-15 | `vacation` → task de férias |
| CAL-08 | Férias sobrepondo feriado | férias 2026-09-01..09-15, data 2026-09-07 (07/09) | `holiday` (feriado vence férias — confirmar precedência com Núcleo; BRIEF §5 lista feriado antes de férias) |
| CAL-09 | Férias sobrepondo fim de semana | férias cobre sábado | `weekend` |
| CAL-10 | Limite de férias inclusivo | startDate e endDate exatos | ambos `vacation` |
| CAL-11 | Workday comum | 2026-09-30 (qua) | `workday` → task do mês |
| CAL-12 | Facultativo MG/uberl em dia útil | linha do CSV facultativo | `holiday` |
| CAL-13 | Feriado de outro município/UF | CSV municipal IBGE ≠ 3170206 | `workday` (ignora) |

### 2. Holidays (`holidays.ts`)

| ID | Caso | Esperado |
|---|---|---|
| HOL-01 | Parse CSV separador `\|` | datas/nomes corretos |
| HOL-02 | Parse tolerante `;` e `,` | mesmo resultado |
| HOL-03 | Filtro estadual UF=MG (5ª col) | só MG |
| HOL-04 | Filtro municipal IBGE 3170206 | só Uberlândia |
| HOL-05 | Facultativo UF=MG ou nome contém "uberl" | filtro correto |
| HOL-06 | Cache: refresh no boot + 1º dia do mês | 2ª chamada no mesmo mês não refaz fetch |
| HOL-07 | Falha de rede com cache | usa cache, sem alerta |
| HOL-08 | Falha de rede sem cache | alerta + dia tratado como `workday` (fail-open com warn) |
| HOL-09 | Dataset 2026 real | contém 07/09, 20/11, 31/08 (Uberlândia) |

### 3. Jira client (`jira.ts`)

| ID | Caso | Esperado |
|---|---|---|
| JIR-01 | Payload do worklog exato | `POST {base}/jiraito/rest/api/2/issue/{KEY}/worklog?adjustEstimate=leave` com body `{"comment":"","started":"YYYY-MM-DDT09:00:00.000-0300","timeSpentSeconds":28800}` — `comment` presente e `""`, byte a byte |
| JIR-02 | Headers de escrita | `X-Atlassian-Token: no-check` + `Content-Type: application/json; charset=utf-8` + cookie completo |
| JIR-03 | Context path | toda URL contém `/jiraito` |
| JIR-04 | Offset `-0300` | derivado via `Intl` da data local, não hardcoded |
| JIR-05 | Sessão morta 401 | `/myself` → 401 → status `dead` |
| JIR-06 | Sessão morta 302 | redirect para login → `dead` (não seguir redirect como sucesso) |
| JIR-07 | Sessão morta 403 | → `dead` |
| JIR-08 | 5xx / erro de rede | → ignora (sem alerta, status não vira `dead`) |
| JIR-09 | Sessão viva | 200 com `name`/`displayName` → `alive` |
| JIR-10 | JQL de idempotência | `worklogAuthor = currentUser() AND worklogDate = "YYYY/MM/DD"` antes de postar |

### 4. Applier (`applier.ts`)

| ID | Caso | Esperado |
|---|---|---|
| APP-01 | Post normal | 1 POST, ledger `history` com status `success`, worklog_id salvo |
| APP-02 | Idempotência local | data já em `history` (UNIQUE date) → `skipped`, 0 POSTs |
| APP-03 | Idempotência remota | JQL retorna worklog existente (ex: criado fora do app) → `skipped`, 0 POSTs |
| APP-04 | Backfill 14 dias | boot com 14 dias úteis faltantes → completa todos, inclusive hoje |
| APP-05 | Backfill respeita weekend/holiday/vacation | não posta nesses dias |
| APP-06 | Fallback de mês | mês sem mapping → usa mapping anterior mais recente + warn (log + webhook 1x/dia) |
| APP-07 | Sem mapping algum | não aponta + alerta |
| APP-08 | Falha no POST | status `failed` no ledger, não trava o loop |
| APP-09 | RunNowResult | shape conforme `contract.ts` (ranAt, days[] com action logged/skipped/failed) |

### 5. Scheduler / Alerter (`scheduler.ts`, `alerter.ts`)

| ID | Caso | Esperado |
|---|---|---|
| SCH-01 | Job diário 09:05 America/Sao_Paulo | dispara no horário correto (fake timers) |
| SCH-02 | Keepalive 20min | ping `/myself` a cada 20min |
| SCH-03 | Alerta webhook 1x | sessão morta → 1 POST no webhook; continua morta → sem novo alerta |
| SCH-04 | Retorno da sessão | viva de novo → confirma retorno (1 mensagem) e reseta estado |
| SCH-05 | 5xx no keepalive | sem alerta |
| SCH-06 | Warn de fallback 1x/dia | webhook de warn não repete no mesmo dia |

### 6. Server / rotas Elysia (`routes.test.ts`)

| ID | Caso | Esperado |
|---|---|---|
| SRV-01 | `/healthz` público | 200 sem sessão |
| SRV-02 | `/api/*` sem sessão | 401/403 (exceto `/api/login`) |
| SRV-03 | Login senha correta | 204 + cookie assinado (hmac) |
| SRV-04 | Login senha errada | 401 |
| SRV-05 | Logout | 204, cookie invalidado |
| SRV-06 | CRUD monthly-tasks | upsert + delete + list |
| SRV-07 | CRUD vacations | create (validação de datas), delete, list |
| SRV-08 | PUT settings sem jiraCookie | mantém cookie atual |
| SRV-09 | GET settings | cookie mascarado |
| SRV-10 | run-now | RunNowResult válido, chama applier com hoje+backfill |
| SRV-11 | test-connection | `{ok, message}` conforme ping |
| SRV-12 | history/logs | paginação limit/offset e filtro level |

### 7. Frontend (Vitest + Testing Library — fase posterior)

Render das telas (tasks do mês, férias, config, histórico, logs, rodar agora) com dados mockados do contrato; foco em estados de erro (sessão morta, sem mapping).

## Pendências para o Núcleo

- Precedência exata feriado × férias (CAL-08 assume feriado vence, pelo BRIEF §5).
- Como injetar `fetch`/clock no core (DI ou mock global) — necessário para JIR/SCH.
- Export nomeado de funções puras em `calendar.ts`/`holidays.ts` para testar sem DB.
