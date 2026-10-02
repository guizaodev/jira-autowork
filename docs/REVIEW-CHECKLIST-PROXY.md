# REVIEW CHECKLIST — Feature Proxy HTTP Corporativo

Escopo: `settings.proxyUrl` · `getProxy` dinâmico injetado em todos os fetches externos (`jira.ts`, `holidays.ts`, `alerter.ts`) · mascaramento de credenciais no `GET /api/settings` · PUT mascarado preserva valor atual · string vazia limpa proxy.
Revisor: Retina. Severidades: **P0** bloqueia merge · **P1** deve corrigir antes do commit · **P2** nice-to-have.

---

## 1. Cobertura do proxy — TODAS as chamadas externas

- [ ] `src/core/jira.ts`: `getMyself`, `probeSession`, `hasWorklogOnDate`, `addWorklog` — todos passam por `requestInit`/proxy. Nenhum `fetchFn(url, {...})` direto sem proxy.
- [ ] `src/core/holidays.ts`: `fetchCsv` aplica proxy nos 4 CSVs (nacional/estadual/municipal/facultativo).
- [ ] `src/core/alerter.ts`: `sendAlert` (POST webhook) aplica proxy.
- [ ] `src/index.ts` (bootstrap): `createJiraClient`, `createHolidayStore`, `createAlerter` recebem `getProxy` ligado a `db.getSettings().proxyUrl` — nenhum default `() => ""` vazando em produção.
- [ ] Varredura: nenhum `fetch(`/`fetchFn(` externo (Jira, GitHub raw, webhook) sem proxy no diff. Fetches internos (painel → `/api`, healthcheck) NÃO usam proxy.
- [ ] `ProxyProvider` definido uma vez (jira.ts) e importado como type-only nos demais — sem duplicação.

## 2. Proxy dinâmico — sem cache stale

- [ ] `getProxy` é função lida **a cada request** (`db.getSettings().proxyUrl`), não valor capturado no boot ou memoizado.
- [ ] Alterar proxy no painel e salvar → próxima chamada externa usa o novo valor sem restart (sem `const proxy = settings.proxyUrl` no escopo de criação).
- [ ] `getProxy().trim()` tratado em todos os pontos de uso (jira e holidays consistentes).
- [ ] String vazia → `RequestInit` sem `proxy` (sem `{ proxy: "" }` que possa quebrar fetch).

## 3. Mascaramento de credenciais

- [ ] `GET /api/settings` retorna `proxyUrl` mascarado: `user:pass` ocultos, `scheme://host:port` visível (ex.: `http://user:pass@proxy.corp:8080` → `http://••••••@proxy.corp:8080`).
- [ ] Sem credenciais no proxy → valor retornado inalterado (host:port visível).
- [ ] Helper de mascaramento (ex.: `maskProxyUrl`) export nomeado, testável, sem `any`.
- [ ] Mascaramento aplicado em TODAS as respostas que expõem settings (GET e retorno do PUT).
- [ ] Credenciais NUNCA logadas: nenhum `addLog`/`console.*` com `proxyUrl` cru; mensagens de erro de fetch não incluem a URL do proxy com credenciais.

## 4. PUT /api/settings mascarado — não corrompe o valor

- [ ] PUT com `proxyUrl` mascarado (valor vindo do GET, ex.: `http://••••••@proxy:8080`) → **preserva** o valor atual (não grava o mascarado).
- [ ] PUT com `proxyUrl` novo e não-mascarado → grava o novo.
- [ ] PUT com `proxyUrl: ""` (string vazia explícita) → **limpa** o proxy (grava vazio).
- [ ] PUT sem campo `proxyUrl` (undefined) → não altera o atual.
- [ ] Distinguir mascarado de vazio: sentinela/marcador do mascaramento não colide com valor legítimo.
- [ ] Body schema do PUT atualizado (`t.Optional(t.String())` para `proxyUrl`).

## 5. Contract e DB

- [ ] `AppSettings.proxyUrl` no contract (única fonte) com doc-comment; web não redeclara.
- [ ] `SettingsPatch.proxyUrl` + `getSettings`/`updateSettings`/seed `proxy_url` no db.ts.
- [ ] Doc-comment do bloco REST (`PUT /api/settings`) atualizado mencionando `proxyUrl` e semântica mascarado/vazio.

## 6. Painel (web)

- [ ] ConfigScreen: campo "Proxy HTTP" com placeholder `http://user:pass@host:port`, valor mascarado exibido, edição limpa o campo (padrão do jiraCookie).
- [ ] PUT envia `proxyUrl` apenas quando o usuário digitou algo novo; vazio não enviado (preserva) OU enviado explicitamente para limpar — semântica clara e testada.
- [ ] Sem `any`, hooks rules ok, export nomeado, sem comentários.

## 7. Testes (Crivo)

- [ ] jira: com proxy configurado, todo fetch recebe `proxy` no init (mock fetchFn espiona init).
- [ ] jira: proxy vazio → init sem `proxy`.
- [ ] jira: mudança do setting entre chamadas → segunda chamada usa novo proxy (dinâmico).
- [ ] holidays: fetchCsv com proxy; alerter: webhook com proxy.
- [ ] routes: GET /api/settings mascara `user:pass`, mantém `host:port`.
- [ ] routes: PUT mascarado preserva; PUT vazio limpa; PUT novo grava; PUT sem campo preserva.
- [ ] routes: nenhuma resposta/log vaza credenciais.
- [ ] `bun test` e `bun run typecheck` passam.

## 8. Transversal

- [ ] `git diff` só toca arquivos do escopo da feature.
- [ ] TS strict, zero `any`, exports nomeados, sem default exports, sem comentários no código.
- [ ] `as RequestInit` (cast p/ `proxy`, não padrão DOM) isolado e justificado — preferir tipo próprio se possível.
- [ ] Sem regressão: suites existentes verdes.

---

## Findings (revisão final — preenchida após chamado de Dinamo/Mosaico/Crivo)

| # | Severidade | Arquivo | Descrição |
|---|-----------|---------|-----------|
| 1 | P1 | src/server/routes.ts | PUT recebia proxyUrl mascarado via string mágica `***:***@` duplicada entre auth.ts e routes.ts; proxy real com `***:***@` literal no userinfo era descartado silenciosamente. **RESOLVIDO**: constante exportada `PROXY_MASK` + `isMaskedProxy` estrutural (userinfo inteiro até o último `@`); testes auth.test.ts e routes.test.ts (PUT mascarado preserva, vazio limpa, literal embutido aceito). |
| 2 | P1 | src/server/auth.ts | `maskProxy("user:pass@proxy.corp:8080")` (sem scheme, formato curl) retornava o valor CRU com senha visível — `new URL` parseia com userinfo vazio e o early-return pulava o mascaramento. **RESOLVIDO**: caminho URL só quando há `://`; sem scheme/parse falho cai em `maskStructural` (lastIndexOf `@`), nunca retorna cru com `@` presente. Bateria empírica de 11 casos sem vazamento. |
| 3 | P2 | web/src/screens/ConfigScreen.tsx | Help text "vazio = conexão direta" dentro do `<label>` do Field. **RESOLVIDO**: movido para fora (wrapper div flex-col gap-1). |
| 4 | P2 | web/src/screens/ConfigScreen.tsx | Input do proxy `type=text` expõe credenciais na tela/DOM. **ACEITO** como decisão de spec (backend mascara na leitura; valor hidratado já vem mascarado). |
| 5 | P2 | src/server/auth.ts | `maskProxy` retornava `proxyUrl` sem trim quando URL válida sem credenciais. **RESOLVIDO**: retorna `trimmed`. |

Nenhum P0. Todos os P1 resolvidos e revalidados.

Verificações do revisor (última rodada): `tsc --noEmit` limpo · `bun test` **125 pass / 0 fail** (406 expects, 9 arquivos) · `bun run build` (web) OK · bateria empírica de mascaramento (sem-scheme, `@` literal, IPv6, path, socks5, espaços, idempotência, isMaskedProxy coerente) sem vazamentos.
