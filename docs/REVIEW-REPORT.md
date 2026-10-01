# REVIEW REPORT — jira-autowork (Lupa)

Revisão final do código (src/core, src/server, web/src, Dockerfile, docker-compose, README) contra `docs/BRIEF.md`, `src/shared/contract.ts` e `docs/REVIEW-CHECKLIST.md`.

Status: **104/104 testes passando** · `tsc --noEmit` limpo (root e web) · `bun run build` limpo.
Prioridades: **P0** bloqueador · **P1** corrigir antes de produção · **P2** recomendado.

## Veredito final (revalidação 2026-10-01)

**APROVADO PARA PRODUÇÃO.** Todos os P1 e P2 foram revalidados nos fontes e estão resolvidos (ver status em cada item). Sem pendências.

---

## P0 — Bloqueadores

Nenhum. Os P0s originais (servidor Elysia ausente) foram resolvidos: `src/server/index.ts`, `src/server/routes.ts`, `src/server/auth.ts` e `src/index.ts` implementados e cobertos por `tests/server/*`.

---

## P1 — Corrigir antes de produção

### P1-1. Login quebrado em produção sem TLS — ✅ RESOLVIDO
- **Onde:** `src/server/routes.ts:49-52` · `src/server/index.ts:36-42` · `docker-compose.yml:14` · `README.md:34,71,74`
- **O quê:** cookie de sessão emitido com `secure: process.env.NODE_ENV === "production"`; a imagem Docker seta `NODE_ENV=production` e o README orienta acesso plain-HTTP. Browsers recusam cookie `Secure` sobre HTTP → o login nunca persiste sessão.
- **Correção sugerida:** tornar configurável (ex.: env `PANEL_COOKIE_SECURE`, default `true` apenas quando atrás de proxy TLS) ou documentar/requisitar reverse proxy com TLS no deploy.
- **Resolução:** `PANEL_COOKIE_SECURE` (true/false/auto, default `auto` = `x-forwarded-proto === "https"`); compose default `false`; README documenta.

### P1-2. Senha default silenciosa em produção — ✅ RESOLVIDO
- **Onde:** `src/index.ts:11-17`
- **O quê:** sem `PANEL_PASSWORD` em prod, painel sobe com senha "dev" sem aviso.
- **Correção sugerida:** fail-fast (`throw`) quando `NODE_ENV=production` e `PANEL_PASSWORD` ausente; manter default "dev" apenas fora de produção.
- **Resolução:** fail-fast com `process.exit(1)` em produção sem `PANEL_PASSWORD`; "dev" só fora de prod.

### P1-3. Cache de feriados envenenado em falha parcial de rede — ✅ RESOLVIDO
- **Onde:** `src/core/holidays.ts:181-200`
- **O quê:** o fail-open só ocorria quando TODOS os 4 CSVs falhavam. Se só parte respondia, o set incompleto era persistido com `source: "network"`, sobrescrevendo um cache completo anterior.
- **Correção sugerida:** tratar falha parcial como falha (fallback para cache) ou exigir sucesso do CSV `nacional` antes de persistir.
- **Resolução:** `nacional` obrigatório E `failed === 0` para persistir; qualquer falha parcial usa cache (warn com contagem `N/4`); fail-open só sem cache. Fetches agora em paralelo (`Promise.all`).

### P1-4. Idempotência remota pulada quando username vazio — ✅ RESOLVIDO
- **Onde:** `src/core/applier.ts:117-137`
- **O quê:** `usernameFor` retornava `""` se `getMyself` falhasse; a checagem JQL era pulada e o worklog postado às cegas — risco de duplicata.
- **Correção sugerida:** abortar o dia com status `failed`.
- **Resolução:** username vazio → log `error`, `history` com status `failed` e action `failed` ("sessão Jira inválida"); nunca posta sem checagem.

### P1-5. Docker roda como root + bloat no stage de build — ✅ RESOLVIDO
- **Onde:** `Dockerfile:7-15,29,34-37,43`
- **O quê:** container como root; `COPY web web` levava `web/node_modules` do host.
- **Correção sugerida:** usuário não-root + `chown /data`; COPY seletivo.
- **Resolução:** `USER app` + `chown app:app /data`; COPY seletivo (package.json/bun.lock, depois fontes); healthcheck via `bun -e fetch` (sem depender de curl).

---

## P2 — Recomendado

### P2-1. Bypass de auth impreciso — ✅ RESOLVIDO
- **Onde:** `src/server/routes.ts:34-35`
- `path.endsWith("/healthz")` era dead code; `endsWith("/login")` casaria um futuro `/x/login`. Usar match exato (`path === "/api/login"`).
- **Resolução:** match exato `path === "/api/login"`; dead code removido.

### P2-2. Comparação de senha não constant-time — ✅ RESOLVIDO
- **Onde:** `src/server/routes.ts:46,204-208` (`timingSafeEqualStr`)
- Usar `crypto.timingSafeEqual` sobre hashes de tamanho fixo (como já feito no token em `src/server/auth.ts:32`).
- **Resolução:** `timingSafeEqualStr` com `Buffer.from` + comparação de tamanho antes do `timingSafeEqual`.

### P2-3. `/login` sem rate limit — ⚠️ ACEITO (risco registrado)
- **Onde:** `src/server/routes.ts:43-64`
- Brute force possível. Aceitável para ferramenta interna; registrar risco ou adicionar backoff simples por IP.
- **Status:** risco registrado; ferramenta interna em rede restrita. Reavaliar se o painel for exposto publicamente.

### P2-4. `/run-now` sem lock de concorrência — ✅ RESOLVIDO
- **Onde:** `src/server/routes.ts:31,169-179`
- Duas chamadas concorrentes têm janela de duplicação entre checagem JQL e post. Adicionar flag in-flight (rejeitar com 409 enquanto executa).
- **Resolução:** flag `runNowInFlight` com `try/finally`; concorrente recebe 409.

### P2-5. Token de sessão determinístico — ✅ RESOLVIDO
- **Onde:** `src/server/auth.ts:15-22,30-34`
- Token = `expires.HMAC(sha256(secret), expires)` sem nonce/aleatoriedade: um cookie capturado permite offline brute-force do `PANEL_PASSWORD` (segredo deriva só da senha). Adicionar nonce aleatório ao payload assinado.
- **Resolução:** `randomBytes(16)` como nonce incluído no payload assinado (`expires.nonce.signature`); verificação rejeita token sem nonce.

### P2-6. Rota fora do contrato — ✅ RESOLVIDO
- **Onde:** `src/server/routes.ts:191` (`POST /api/keepalive`) · `src/shared/contract.ts`
- Não está em `src/shared/contract.ts`. Documentar no contract (comentário da seção API) ou remover.
- **Resolução:** rota documentada no contract.

### P2-7. Handlers de erro global incompletos — ✅ RESOLVIDO
- **Onde:** `src/index.ts:51-60`
- `uncaughtException` loga sem sair (processo em estado inconsistente); sem handler de `unhandledRejection`. Sugerir log + `process.exit(1)` e adicionar o handler de rejeição.
- **Resolução:** `uncaughtException` loga e sai com `exit(1)`; `unhandledRejection` handler adicionado.

### P2-8. Scheduler desvios menores — ✅ RESOLVIDO
- **Onde:** `src/core/scheduler.ts:33,52,101-131`
- Boot executa o job na hora e marca o dia, suprimindo o job das 09:05 do dia do boot; feriados não têm refresh no 1º dia do mês (Map `memory` nunca invalida). BRIEF pede refresh mensal.
- **Resolução:** catch-up no boot com `runDailyJob(false)` (não marca o dia — job das 09:05 ainda roda, idempotência via ledger+JQL); `holidayRefreshMonth` + `refreshHolidays()` na virada de mês invalida o cache em memória.

### P2-9. Checagem JQL só primeira página — ✅ RESOLVIDO
- **Onde:** `src/core/jira.ts:123-159`
- Issues com muitos worklogs paginam; falso negativo possível na idempotência.
- **Resolução:** loop de paginação com `startAt` + `maxResults=50` até `total`.

### P2-10. Prepared statements re-criados — ✅ RESOLVIDO
- **Onde:** `src/core/db.ts:163-176` (helper `cached`)
- Cachear statements como já feito em `upsertSetting`.
- **Resolução:** helper `cached(sql)` com Map memoiza todos os statements.

### P2-11. Inconsistência JIRA_COOKIE — ✅ RESOLVIDO
- **Onde:** `docker-compose.yml:12` (`${JIRA_COOKIE:-}`) · `README.md:74`
- **Resolução:** compose aceita vazio; README documenta seed opcional (cookie colável pelo painel).

### P2-12. Dead export no web — ✅ RESOLVIDO
- **Onde:** `web/src/date.ts`
- **Resolução:** `saoPauloToday` removido.

### P2-13. Healthcheck do Docker — ✅ RESOLVIDO
- **Onde:** `Dockerfile:43`
- **Resolução:** healthcheck via `bun -e "await fetch(...)"` com `AbortSignal.timeout(5000)` — sem dependência de curl.

---

## Verificado e aprovado

- **Worklog:** `POST /rest/api/2/issue/{KEY}/worklog?adjustEstimate=leave`, body com `comment:""` sempre presente, `timeSpentSeconds:28800`, `started` via `formatStarted` (`src/core/jira.ts:39-56`) com offset derivado de `Intl` — `src/core/jira.ts:151-176`.
- **Headers de escrita:** `X-Atlassian-Token: no-check` + `Content-Type: application/json; charset=utf-8` + cookie — `src/core/jira.ts:58-64`.
- **TZ:** datas de negócio via `Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })` em `calendar.ts`/`applier.ts:40`/`scheduler.ts:35`; sem `toISOString()` para data de negócio.
- **Precedência de classificação:** weekend > holiday > vacation > workday — `src/core/calendar.ts:46-56`.
- **Fallback de monthly task:** mapping anterior mais recente + warn 1x/dia por tipo — `src/core/applier.ts:27-38,65-74`.
- **Idempotência:** ledger `UNIQUE(date)` (`src/core/db.ts:107`) + JQL `worklogAuthor=currentUser() AND worklogDate="YYYY/MM/DD"` (`src/core/jira.ts:77-78,110-130`).
- **Segurança do cookie Jira:** nunca logado; mascarado em `GET/PUT /api/settings` (`routes.ts:62-93`); `PUT` com cookie vazio preserva o atual (`routes.ts:78-80`).
- **Auth do painel:** todas `/api/*` protegidas (exceto login) via `onBeforeHandle` (`routes.ts:30-38`); cookie `HttpOnly`/`SameSite=lax`/`MaxAge` (s); logout com `remove()`.
- **/healthz público** (`src/server/index.ts:53`) · **SPA fallback com path traversal bloqueado** (`src/server/index.ts:55-76`).
- **Keepalive:** 20min, webhook 1x até voltar — `src/core/scheduler.ts` · `alerter.ts`.
- **Estilo:** TS strict, zero `any`, exports nomeados, sem comentários em código novo (exceções: `contract.ts` pré-existente e headers Dockerfile).
- **Painel web:** aprovado em rodada 2 (LGTM) — loop de fetch corrigido via `loaderRef`, TZ do mês default corrigida, 401 tratado.

## Cobertura de testes sugerida (Sentinel) — ✅ COBERTA (104/104)

Falha parcial de feriados (P1-3) · username vazio no applier (P1-4) · `/run-now` concorrente (P2-4) · login via HTTP com cookie secure (P1-1) · classificação/TZ/fronteira de meia-noite · mascaramento do cookie · auth das rotas — itens agora cobertos pela suite (104 testes, 8 arquivos).
