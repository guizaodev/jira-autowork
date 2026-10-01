# jira-autowork

Apontamento automático de horas (8h/dia útil) no Jira Data Center da NTT.

Stack: **Bun 1.4** · Backend **Elysia** · Painel **React 19 + Vite + Tailwind v4** · DB **bun:sqlite** · Validação **zod**.

Documentação de negócio: [`docs/BRIEF.md`](docs/BRIEF.md) · Recon do Jira: [`docs/jira-ntt-recon.md`](docs/jira-ntt-recon.md)

## Requisitos

- [Bun](https://bun.sh) >= 1.4
- Docker + Docker Compose (para deploy)

## Desenvolvimento

```bash
bun install

# API + scheduler (porta 3000)
bun run dev

# Painel (vite dev server com proxy /api -> localhost:3000)
bun run dev:web
```

Scripts: `dev` (backend watch) · `dev:web` (painel) · `build` (builda `web/` com vite) · `build:server` (bundle standalone do servidor em `dist-server/`) · `build:all` (os dois) · `typecheck` · `test` (`bun test`).

Variáveis de ambiente em dev (opcional, pode exportar ou usar `.env` — nunca comitar):

| Var | Descrição |
|---|---|
| `JIRA_COOKIE` | Cookie de sessão do Jira (ver [Renovando o cookie](#renovando-o-cookie-jira)) |
| `PANEL_PASSWORD` | Senha de login do painel (default dev: `dev`; em prod é **obrigatória** — o app não sobe sem ela) |
| `PANEL_COOKIE_SECURE` | `true` para emitir cookie de sessão `Secure` (use atrás de proxy TLS; plain-HTTP deixa `false`) |
| `ALERT_WEBHOOK_URL` | Webhook para alertas (Slack/Discord/etc) |
| `PORT` | Porta do servidor (default `3000`) |
| `DATA_DIR` | Diretório do SQLite (dev: `./data`, Docker: `/data`) |
| `WEB_DIST_DIR` | Diretório do painel compilado (default: `./web/dist` relativo ao cwd) |

Em dev o banco fica em `./data/dev.db` (crie `data/` ou deixe o app criar). Configure tasks do mês, feriado/férias e o cookie pelo painel em `http://localhost:5173` (login com `PANEL_PASSWORD`).

## Deploy (Docker)

```bash
# 1. Build da imagem (multi-stage: bundle do servidor + painel, runtime slim sem node_modules)
docker build -t jira-autowork .

# 2. Rodar
docker run -d --name jira-autowork \
  -p 3000:3000 \
  -e JIRA_COOKIE="JSESSIONID=...; atlassian.xsrf.token=...; INGRESSCOOKIE=..." \
  -e PANEL_PASSWORD="uma-senha-forte" \
  -e ALERT_WEBHOOK_URL="https://hooks.slack.com/..." \
  -v jira-autowork-data:/data \
  jira-autowork

# Ou com compose (recomendado — use um .env ao lado do docker-compose.yml)
docker compose up -d --build
```

`.env` de exemplo para o compose:

```env
# Seed inicial do cookie (opcional — sem ele, configure pelo painel em Config → Cookie)
JIRA_COOKIE=JSESSIONID=...; atlassian.xsrf.token=...; INGRESSCOOKIE=...

# Obrigatório (o container não sobe sem)
PANEL_PASSWORD=uma-senha-forte

# Opcionais
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
PANEL_COOKIE_SECURE=false
```

> **JIRA_COOKIE é opcional no compose**: se ausente, o sistema sobe e você cola o cookie pelo painel (**Config → Cookie**), que grava no banco em `/data`. Se presente, é usado como seed inicial. Renove pelo painel quando expirar. `PANEL_COOKIE_SECURE=true` só se o acesso for via HTTPS/reverse proxy com TLS (default `false` para acesso direto por HTTP na :3000).

### O que a imagem faz

Imagem de produção **mínima e sem `node_modules`**: o servidor roda como um bundle standalone.

- Stage 1 (`oven/bun:1`): instala deps do `web/` (lock próprio, cache de layer) e builda o painel com vite
- Stage 2 (`oven/bun:1`): copia `package.json` + `bun.lock` primeiro (cache de `bun install --frozen-lockfile`), depois `src/`, e gera o bundle `dist-server/index.js` com `bun build --target=bun --minify` — elysia + zod ficam embutidos (~460 KB); `bun:sqlite` é nativo do runtime Bun e não é afetado pelo bundle
- Stage 3 (`oven/bun:1-slim`): runtime final copia **apenas** `dist-server/index.js` + `web/dist`, `TZ=America/Sao_Paulo`, `VOLUME /data`, `EXPOSE 3000`, healthcheck em `/healthz` (via `bun -e fetch`, sem curl), roda como usuário **não-root** (`app`, uid 10001), `CMD bun dist-server/index.js`

Build local equivalente: `bun run build:all` (=`build` do vite + `build:server` do bundle). O caminho do painel é resolvido via env `WEB_DIST_DIR` (na imagem: `/app/web/dist`) e o SQLite via `DATA_DIR` (`/data`), então o bundle funciona a partir de qualquer cwd.

- Scheduler roda às **09:05** (America/Sao_Paulo) + keepalive a cada 20min + backfill de 14 dias

> **Permissão do `/data`:** com bind mount (`./data:/data`), o diretório do host precisa ser gravável pelo uid do container: `sudo chown -R 10001:10001 ./data` (ou rode o container com `user: "1000:1000"` no compose para casar com seu usuário do host). Volumes nomeados herdam o dono correto automaticamente.

### Operação

```bash
docker compose logs -f          # logs
docker compose restart          # restart
docker compose pull || true     # (imagem é local, build com --build)
curl -f http://localhost:3000/healthz   # healthcheck
```

Painel: `http://<host>:3000` (login com `PANEL_PASSWORD`). Botão **Rodar agora** executa hoje + backfill e mostra o resultado por dia.

## Renovando o cookie Jira

A sessão do Jira expira (horas/dias). O sistema detecta via keepalive (`/rest/api/2/myself` a cada 20min) e alerta **1x** no webhook até voltar. Quando o painel mostrar sessão **morta** (ou chegar alerta):

1. Faça login normal no Jira: `https://umane.emeal.nttdata.com/jiraito`
2. Abra o **DevTools (F12) → Application → Cookies → `https://umane.emeal.nttdata.com`** (ou copie o header `Cookie:` de uma requisição qualquer na aba Network)
3. Copie os valores de:
   - `JSESSIONID` (HttpOnly — só via DevTools/Network)
   - `atlassian.xsrf.token`
   - `INGRESSCOOKIE`
4. Monte a string no formato:
   ```
   JSESSIONID=valor; atlassian.xsrf.token=valor; INGRESSCOOKIE=valor
   ```
   (com `ApplicationGatewayAffinity=valor` no fim, se existir — recomendado)
5. Cole no painel: **Config → Cookie → Salvar → Testar conexão**. Deve retornar seu usuário (`gmarquma`).

Alternativa rápida (troque no redeploy): atualize a env `JIRA_COOKIE` no `.env` e `docker compose up -d`.

> Importante: quem renova a sessão com uso contínuo é o keepalive do próprio sistema; renovar o cookie manualmente só é preciso quando a sessão cai de vez (logout, expiração, troca de senha/redes).

## Estrutura

```
src/core/      db, jira, holidays, calendar, applier, scheduler, alerter
src/server/    index (Elysia), routes
src/shared/    contract.ts (tipos compartilhados)
web/           painel React (Vite + Tailwind v4)
tests/         bun test
data/          SQLite (dev; /data no Docker)
```
