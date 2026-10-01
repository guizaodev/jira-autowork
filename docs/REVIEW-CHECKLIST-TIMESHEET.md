# REVIEW CHECKLIST — Feature Timesheet (Apontamentos)

Escopo: remoção do fallback de monthly task · `historyForMonth` · `GET /api/timesheet/:month` · tipo `MonthTimesheet` · tela Apontamentos (web) · novos testes.
Revisor: Arguto. Severidades: **P0** bloqueia merge · **P1** deve corrigir antes do commit · **P2** nice-to-have.

---

## 1. Backend — applier sem fallback (src/core/applier.ts)

- [ ] `monthlyIssueFor` busca APENAS mapping exato do mês (`task.month === month`); nenhum `sort`/`filter` de mês anterior sobrando.
- [ ] Mês sem mapping → `recordSkip(date, "workday", ...)` + `warnOncePerDay("no-mapping", ...)` — NÃO aponta, NÃO usa task de outro mês.
- [ ] Mensagem de detail coerente (`"task do mês não cadastrada"`) e igual entre history, log e alerta.
- [ ] Alerta `no-mapping` emitido **1x por dia** (chave `todayLocal():kind`), mesmo com múltiplos dias úteis sem mapping no backfill (ex.: virada de mês com 10+ dias de setembro sem mapping → 1 alerta, não N).
- [ ] `warnOncePerDay` usa `todayLocal()` (Intl en-CA, America/Sao_Paulo) — nunca `toISOString()` para data de negócio.
- [ ] Nenhum código morto do fallback remanescente (variáveis `fallback`, strings "fallback", branches órfãos).
- [ ] Dias de férias/feriado/weekend NÃO são afetados pela mudança (continuam apontando com suas issues próprias mesmo sem monthly task do mês).

## 2. Backend — db.historyForMonth (src/core/db.ts)

- [ ] Assinatura `historyForMonth(month: string): HistoryEntry[]` adicionada à interface `Db` E à implementação.
- [ ] Query parametrizada (`LIKE ?` com `${month}-%`) — sem concatenação de string SQL (injection).
- [ ] `month` validado ANTES de chegar ao SQL (rota valida com `monthSchema`; chamadas internas também passam mês confiável).
- [ ] `LIKE 'YYYY-MM-%'` não vaza meses parecidos (padrão `YYYY-MM` com hífen garante isso; confirmar que não há `YYYY-M`).
- [ ] Ordenação determinística (`ORDER BY date`).
- [ ] Reuso de `cached()` e `toHistoryEntry` — sem duplicar mapeamento de linhas.

## 3. Backend — rota GET /api/timesheet/:month (src/server/routes.ts)

- [ ] Validação do `:month` com `monthSchema` (`^\d{4}-(0[1-9]|1[0-2])$`) → 400 com mensagem clara em caso inválido.
- [ ] **Soma apenas `status === "success"`** — `skipped` e `failed` contribuem 0 (verificar que `timeSpentSeconds` de skipped/failed é 0 no ledger, senão o filtro é a única defesa).
- [ ] `totalSeconds` é número inteiro de segundos (sem float drift — reduce de inteiros ok).
- [ ] Response conforme `MonthTimesheet` do contract (`{ month, totalSeconds, days }`) — sem campos extras não tipados.
- [ ] Rota protegida pelo `onBeforeHandle` de sessão (não adicionada antes do guard / sem bypass).
- [ ] Mês sem dados → 200 com `days: []`, `totalSeconds: 0` (não 404, não 500).
- [ ] Sem comentários no código; exports nomeados; TS strict (zero `any`).

## 4. Contract (src/shared/contract.ts)

- [ ] `MonthTimesheet` definido UMA vez aqui (fonte única) — web NÃO redeclara o tipo.
- [ ] Doc-comment da rota no bloco REST atualizado (`GET /api/timesheet/:month -> MonthTimesheet`).
- [ ] Campos e comentários consistentes com `HistoryEntry` existente.

## 5. Frontend — tela Apontamentos (web/src — Vitral)

- [ ] Nova screen (ex.: `TimesheetScreen.tsx`) segue padrão das existentes (`HistoryScreen.tsx` como referência): export nomeado, sem default export.
- [ ] Chamada via `web/src/api.ts` (função tipada com `MonthTimesheet` importado de `src/shared/contract` — verificar alias/import path usado pelas outras telas).
- [ ] Seletor de mês `YYYY-MM` com default no mês atual **calculado em America/Sao_Paulo** (reuso de helper de `web/src/date.ts` se existir; nunca `new Date().toISOString().slice(0,7)`).
- [ ] Exibição: total de horas (`totalSeconds / 3600`, formato `Xh` ou `HH:MM`), lista de dias com date/dayKind/issueKey/status/detail.
- [ ] Tratamento de 400 (mês inválido) e erro de rede — sem crash, sem `any`, sem `console.log` de erro silencioso.
- [ ] Loading state e estado vazio ("sem apontamentos no mês") explícitos.
- [ ] Regras de hooks do React respeitadas (efeitos com deps corretas; cleanup se houver AbortController).
- [ ] Navegação/rota registrada no `App.tsx`/`Shell.tsx` seguindo o padrão das outras telas.
- [ ] Sem comentários; Tailwind v4 classes consistentes com o resto; zero `any`/`as any`.

## 6. Testes (tests/ — Cadencia)

- [ ] Applier: mês sem mapping → skipped + 0 worklogs + **1** alerta (não N) + detail correto.
- [ ] Applier: mês com mapping usa task exata; zero logs/alertas de "fallback".
- [ ] Applier: backfill na virada de mês (set/2026 sem mapping, out/2026 com) — dias de set skipped, dias de out logged; alerta 1x.
- [ ] Applier: alerta 1x/dia respeitado entre execuções distintas do mesmo dia (se aplicável ao design do `warned` Set — notar limitação: Set é por instância de applier; job diário recria? verificar).
- [ ] Routes: `GET /api/timesheet/:month` válido → 200 com soma correta (mistura success/skipped/failed — soma só success).
- [ ] Routes: mês inválido (`2026-13`, `2026-1`, `26-09`, `2026/09`) → 400.
- [ ] Routes: mês válido sem dados → 200 `{ days: [], totalSeconds: 0 }`.
- [ ] Routes: rota exige sessão (401 sem cookie).
- [ ] DB: `historyForMonth` retorna só o mês pedido, ordenado por data.
- [ ] Testes usam helpers existentes (`makeTempDb`, mocks) — sem duplicação de setup.
- [ ] `bun test` e `bun run typecheck` passam.

## 7. Transversal (qualidade geral)

- [ ] `git diff` não contém arquivos fora do escopo da feature.
- [ ] Sem comentários em TODO o diff (código e testes).
- [ ] Exclusivamente exports nomeados; zero default exports no diff.
- [ ] TS strict: zero `any`, zero `as` desnecessário.
- [ ] Strings de usuário em pt-BR consistentes com o resto do painel.
- [ ] Nenhuma regressão: `bun test` completo verde (inclui suites de scheduler, alerter, auth).

---

## Findings (revisão final — ciclo completo)

| # | Severidade | Arquivo | Descrição |
|---|-----------|---------|-----------|
| 1 | P2 | web/src/components.tsx | useAsync sem guarda de staleness — cliques rápidos de mês podiam deixar resposta antiga sobrescrever a nova. **RESOLVIDO**: generation guard (`generationRef`) aplicado e verificado. |
| 2 | P2 | web/src/screens/ApontamentosScreen.tsx | Células do calendário sem `aria-pressed` para dia selecionado. **RESOLVIDO**: `aria-pressed={isSelected}` aplicado. |
| 3 | P2 | tests/server/routes.test.ts | Seed de skipped/failed com `timeSpentSeconds: 0` tornava o assert "soma só success" não discriminante. **RESOLVIDO**: seed com 99999 + expect 43200. |
| 4 | P2 | tests/core/applier.test.ts | Alerta "1x/dia" não exercitado com 2 execuções. **RESOLVIDO**: novo teste 2x `runNow()` mesmo dia → 1 alerta no-mapping + 0 worklogs. |
| 5 | P2 (nit) | tests/core/db.test.ts | LIKE não testado contra data malformada com sufixo parecido. **RESOLVIDO**: teste `2026-091-01` não vaza em `2026-09`. |

Nenhum P0/P1 no ciclo completo.

Verificações do revisor (executadas localmente, última rodada): `tsc --noEmit` limpo · `bun test` **117 pass / 0 fail** (385 expects, 9 arquivos) · `bun run build` OK.

Notas de design (informativo, sem ação):
- Applier é singleton (`src/index.ts:25`) compartilhado por scheduler e rotas → o `warned` Set vive enquanto o processo vive: alerta 1x/dia é respeitado entre job 09:05, botão "Rodar agora" e reload da página. Reinício do processo reseta o Set (limitação aceitável, alinhada ao design original).
- Entries de history com status `success` mas `timeSpentSeconds: 0` ("worklog já existente no Jira", applier.ts:134-141) contribuem 0 no total — coerente com "soma apenas success".

_Status: ciclo completo concluído — Vitral (tela) e Cadencia (testes) aprovados e fechados; todos os P2 resolvidos e verificados._
