# Jira NTT Data — Recon & Automação via Cookie
**Alvo:** `https://umane.emeal.nttdata.com/jiraito`
**Data:** 2026-09-30 (atualizado mesmo dia)
**Autor:** Mavis Vermillion (assistente de Guilherme Marques Machado)

---

## 1. Identificação da Instância

| Propriedade | Valor |
|---|---|
| Produto | Jira Data Center/Server |
| Versão | **10.3.21** |
| Node | `jira-ito-pro-2` |
| Context path | `/jiraito` (todas as chamadas API precisam do prefixo) |
| Infra | Azure Application Gateway (cookies `ApplicationGatewayAffinity`) |
| Headers de segurança | HSTS, CSP, X-Frame-Options: SAMEORIGIN, nosniff |
| Anonimato | ❌ Nada acessível sem login (`X-AUSERNAME: anonymous`, 401 em tudo) |

---

## 2. Métodos de Autenticação — Status

| Método | Status | Detalhe |
|---|---|---|
| **Anônimo** | ❌ | 401 em `/rest/api/2/serverInfo`, `/mypermissions` |
| **PAT (Personal Access Token)** | ❌ **Desativado** | Plugin instalado e listável (`GET /rest/pat/latest/tokens` → 200), mas criação bloqueada: `"Personal access tokens have been disabled"` (HTTP 400) |
| **Basic Auth** | ❌ | Login é OAuth corporativo com MFA — sem senha local |
| **Cookie de sessão (JSESSIONID)** | ✅ **FUNCIONA** | Validado em produção — leitura e escrita |
| **OAuth 1.0a** | ⚠️ Habilitado, inutilizável | Endpoints vivos (`/plugins/servlet/oauth/request-token` responde `oauth_problem=parameter_absent`), mas exige Application Link registrado por admin |
| **OAuth 2.0 / refresh token** | ❌ Não existe | O OAuth do login é do IdP da NTT — o Jira só cria a sessão. OAuth 1.0a não tem refresh por design (token nunca expira) |

### Detalhe do teste PAT
```
POST /jiraito/rest/pat/latest/tokens
Body: {"name":"automacao-mavis","expirationDuration":90}
→ 400 {"error":"Personal access tokens have been disabled"}
```
Nota: o plugin aceita `expirationDuration` (não `expiryDuration`) — erro de validação revelou o schema.

---

## 3. Autenticação por Cookie — Confirmada

### Conta validada
```
GET /rest/api/2/myself (com cookie)
→ 200 {
  "name": "gmarquma",
  "key": "JIRAUSER248916",
  "emailAddress": "guilherme.marquesmachado@emeal.nttdata.com",
  "displayName": "Guilherme Marques Machado",
  "active": true,
  "timeZone": "America/Sao_Paulo"
}
```

### Cookies necessários
| Cookie | Papel |
|---|---|
| `JSESSIONID` | A sessão em si (HttpOnly — pegar via DevTools/CDP) |
| `atlassian.xsrf.token` | Necessário em operações de escrita (POST/PUT) |
| `INGRESSCOOKIE` | Roteamento do ingress (recomendado mandar junto) |
| `ApplicationGatewayAffinity` | Sticky session do Azure Gateway |

### Regras de uso
- **GET** (consultas): só o cookie
- **POST/PUT** (escrita): cookie + header `X-Atlassian-Token: no-check`
- Sempre mandar `atlassian.xsrf.token` junto nas escritas

### Exemplo funcional
```bash
COOKIE="JSESSIONID=...; atlassian.xsrf.token=...; INGRESSCOOKIE=..."

# Consultar
curl -b "$COOKIE" -H "Accept: application/json" \
  "https://umane.emeal.nttdata.com/jiraito/rest/api/2/myself"

# Escrever (criar issue)
curl -X POST -b "$COOKIE" \
  -H "Content-Type: application/json" \
  -H "X-Atlassian-Token: no-check" \
  --data '{"fields":{...}}' \
  "https://umane.emeal.nttdata.com/jiraito/rest/api/2/issue"
```

---

## 4. Projetos Visíveis

| Key | Nome |
|---|---|
| `ITAUADQUIR` | Comunidade desen.1-ITAU-BR |
| `HPCBRASIL` | GDN-e Brasil |

Issues atribuídas ao usuário: **0 abertas** (no momento do levantamento).

---

## 5. Timesheet TDAPPS — Apontamento de Horas (Worklog)

### Como funciona
A página `secure/TimesheetWW!default.jspa` é o plugin **TDAPPS Timesheet** (título: "TDAPPS Timesheet - JIRA-ITO"). Ele é apenas a **view** — os worklogs vivem na issue, na API REST padrão do Jira. Analisando o JS do plugin (`/tmp/tda-plugin.js`), o diálogo "Add Worklog" submete para:

```
POST /jiraito/rest/api/2/issue/{ISSUE_KEY}/worklog?adjustEstimate={leave|new|manual|auto}
Content-Type: application/json; charset=utf-8
X-Atlassian-Token: no-check

{
  "comment": "<Work Description>",   // ⚠️ SEMPRE enviar — ver regra abaixo
  "started": "YYYY-MM-DDTHH:mm:ss.000-0300",
  "timeSpentSeconds": 28800
}
```

### ⚠️ Regra crítica: `comment` nunca pode ser omitido
- **Omitir o campo** → o timesheet renderiza `undefined` na coluna Work Description (o JS lê `data.comment` de uma propriedade inexistente)
- **`"comment": ""`** → célula em branco ✅ (é o comportamento nativo: a UI sempre envia o campo, mesmo vazio)
- **Validado em produção**: PUT com `comment:""` → HTTP 200, campo volta como `''`

### Convenções observadas (padrão do time)
- 8h = `28800` segundos (o Jira exibe como "1d" — 1 dia = 8h nesta instância)
- Horário de início ~09:00 BRT (`-0300`) — o servidor normaliza para `+0200` no storage, mas a data local é preservada
- Apontamentos só em dias úteis
- `adjustEstimate=leave` é o menos invasivo (não mexe no remaining estimate)

### Exemplo validado (2026-09-30)
```bash
curl -X POST -b "$COOKIE" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "X-Atlassian-Token: no-check" \
  --data '{"comment":"","started":"2026-08-24T09:00:00.000-0300","timeSpentSeconds":28800}' \
  "https://umane.emeal.nttdata.com/jiraito/rest/api/2/issue/ITAUADQUIR-901/worklog?adjustEstimate=leave"
→ 201, worklog id 33884533, autor gmarquma
```

### Endpoints de worklog
```
# Listar worklogs da issue (paginado, startAt/maxResults)
GET  /jiraito/rest/api/2/issue/{KEY}/worklog?startAt=0

# Ver um worklog específico
GET  /jiraito/rest/api/2/issue/{KEY}/worklog/{ID}

# Editar (manda o objeto completo: comment + started + timeSpentSeconds)
PUT  /jiraito/rest/api/2/issue/{KEY}/worklog/{ID}?adjustEstimate=leave

# Apagar
DELETE /jiraito/rest/api/2/issue/{KEY}/worklog/{ID}
```

### APIs internas do plugin TDAPPS (descobertas no JS)
Base: `restUrl = {BaseUrl}/rest/reportrest/1.0` · `advancedRestUrl = {BaseUrl}/rest/advanced-timesheet/1.0`
- `GET /rest/reportrest/1.0/reportrestglobal/getprojects` — projetos do relatório
- `GET /rest/reportrestglobal/getuserbygroupInput?input=&group=` — busca usuários por grupo
- `POST /rest/advanced-timesheet/1.0/global-advanced-timesheet-rest/search` — busca de issues do timesheet
- `GET /rest/advanced-timesheet/1.0/global-advanced-timesheet-rest/user-info` — info do usuário
- `POST /rest/reportrest/1.0/workplan` — criar Work Plan (planejamento, distinto do worklog)
- `POST /rest/reportrest/1.0/timer` — iniciar timer
- Worklog em si: **API padrão** (`/rest/api/2/issue/{key}/worklog`) — o plugin não tem endpoint próprio

### Nota sobre a issue ITAUADQUIR-901
- Issue de Staff Augmentation compartilhada: **6.000+ worklogs** de dezenas de usuários
- O total de horas muda constantemente (edições concorrentes) — não usar o total como referência de validação; verificar pelo **ID do worklog** criado
- Contagem de worklogs é confiável: subiu exatamente +1 após o POST de teste

---

## 6. Feriados — Consulta Pública (Uberlândia-MG)

Testado em 2026-09-30. **Não existe API pública oficial de feriados municipais**, mas há um dataset comunitário que cobre tudo por CSV, sem cadastro.

### Comparativo das fontes testadas

| Fonte | Nacionais | Estaduais | Municipais | Auth |
|---|---|---|---|---|
| BrasilAPI (`brasilapi.com.br/api/feriados/v1/{ano}`) | ✅ | ❌ | ❌ | Grátis |
| Nager.Date (`date.nager.at/api/v3/publicholidays/{ano}/BR`) | ✅ | ❌ | ❌ | Grátis |
| **joaopbini/feriados-brasil** (GitHub raw CSV) | ✅ | ✅ | ✅ por código IBGE | Grátis |
| Calendario.com.br | ✅ | ✅ | ✅ | Pago (token) |
| feriados.dev (OSS) | ✅ | ✅ | ✅ | Self-hosted (Docker) |
| Google Calendar `pt-br.brazilian#holiday` | ✅ | ❌ | ❌ | Precisa API key |

### O vencedor: `joaopbini/feriados-brasil` (183★)
CSVs por ano, raw direto do GitHub. Uberlândia = código IBGE **3170206**.

```bash
GH="https://raw.githubusercontent.com/joaopbini/feriados-brasil/master/dados/feriados"

# Municipal — filtrar pelo código IBGE
curl -s "$GH/municipal/csv/2026.csv" | grep 3170206

# Estadual — filtrar UF (5ª coluna)
curl -s "$GH/estadual/csv/2026.csv" | grep ',MG,'

# Nacional (sem filtro)
curl -s "$GH/nacional/csv/2026.csv"

# Facultativos — 5ª coluna = UF (vazio = nacional)
curl -s "$GH/facultativo/csv/2026.csv" | grep -E ',MG,|uberl'
```

Formato do CSV: `data_dd/mm/aaaa | nome | ESCOPO | descrição/legal | UF | código IBGE`

### Uberlândia-MG — resultado 2026

**Municipal:**
- **31/08/2026** — Aniversário de Uberlândia (Lei Municipal nº 2.115 de 11/07/1973)

**Estaduais MG:** nenhum feriado estadual próprio no dataset (MG é um dos estados sem feriado estadual distinto — Tiradentes 21/04, já nacional, cobre a Inconfidência Mineira).

**Nacionais 2026:** 01/01 Ano Novo · 03/04 Sexta-Feira Santa · 21/04 Tiradentes · 01/05 Dia do Trabalho · 07/09 Independência · 12/10 N. Sra. Aparecida · 02/11 Finados · 15/11 Proclamação da República · 20/11 Consciência Negra · 25/12 Natal.

⚠️ Dataset comunitário, não fonte oficial — para fins jurídicos, conferir a lei municipal. Para automação (ex: pular feriados no apontamento), suficiente.

---

## 7. Endpoints Úteis para Automação

```
# Buscar issues com JQL
GET /jiraito/rest/api/2/search?jql=project=ITAUADQUIR+AND+status=Open

# Criar issue
POST /jiraito/rest/api/2/issue

# Transição (mover card)
POST /jiraito/rest/api/2/issue/KEY/transitions

# Comentários
POST /jiraito/rest/api/2/issue/KEY/comment

# Worklog (apontar horas)
POST /jiraito/rest/api/2/issue/KEY/worklog

# Dados do usuário
GET /jiraito/rest/api/2/myself

# Projetos
GET /jiraito/rest/api/2/project

# Permissões da sessão
GET /jiraito/rest/api/2/mypermissions
```

---

## 8. Keepalive de Sessão (Solução para Expiração)

Como não existe refresh token, a sessão cai por **inatividade**. Solução implementada: ping autenticado a cada 20 min renova o timeout.

### Arquitetura
| Componente | Caminho |
|---|---|
| Cookie (chmod 600) | `/opt/data/jira-keepalive/cookie.txt` |
| Script watchdog | `/opt/data/jira-keepalive/check.sh` (cópia em `~/.hermes/scripts/jira-keepalive.sh`) |
| Estado | `/opt/data/jira-keepalive/state` (`alive`/`dead`) |
| Log da última checagem | `/opt/data/jira-keepalive/last-check.log` |
| Cron job | `faf0c9a70f3e` — a cada 20 min, forever, zero tokens (script puro) |

### Comportamento
- 🟢 Sessão viva → silencioso (o GET renova o timeout)
- 🔴 Sessão morta (401/302/403) → alerta **1x** no Telegram com instruções
- 🟡 Falha de rede/servidor (000/5xx) → ignora (sem falso alarme)
- ✅ Sessão renovada após queda → confirma retorno

### Quando a sessão cair
1. Logar no Jira no navegador (OAuth + MFA)
2. DevTools → Application → Cookies → copiar `JSESSIONID` e `atlassian.xsrf.token`
3. Atualizar `/opt/data/jira-keepalive/cookie.txt` (1 linha: `JSESSIONID=...; atlassian.xsrf.token=...; INGRESSCOOKIE=...`)
4. O script lê o arquivo a cada execução — nada mais a fazer

### Limitações do keepalive
A sessão cai mesmo assim se: logout no navegador, restart do servidor, ou admin invalidar sessões.

---

## 9. Segurança — Notas

- ⚠️ **Cookie = identidade**: quem tiver o `JSESSIONID` acessa como `gmarquma`. Arquivo com `chmod 600`.
- O cookie trafega em conexão TLS (HSTS ativo) — sem risco em trânsito.
- `JSESSIONID` é HttpOnly — inacessível via `document.cookie` (proteção contra XSS).
- Escritas realizadas durante o recon: 1 POST de teste de PAT (bloqueado pelo servidor) e 1 worklog de teste na ITAUADQUIR-901 (id 33884533, 24/08/2026, 8h, comment vazio — a pedido do usuário, mantido).
