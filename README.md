<h1 align="center">Wootrico v2</h1>

<p align="center">
  <b>Middleware self-hosted que conecta o Chatwoot a APIs não-oficiais de WhatsApp</b><br>
  (Evolution&nbsp;Go · UAZAPI · Z-API) — configurado por um painel, não por env-vars.
</p>

<p align="center">
  <code>Node.js + TypeScript</code> ·
  <code>Fastify</code> ·
  <code>React + Vite</code> ·
  <code>Postgres</code> ·
  <code>RabbitMQ</code> ·
  <code>Redis</code> ·
  <code>Docker Swarm</code>
</p>

<p align="center">
  📦 <b>Instalar na VPS (servidor de licença + cliente):</b> veja <a href="./INSTALL.md">INSTALL.md</a>
</p>

---

## ✨ O que é

Conecta o **[Chatwoot](https://github.com/chatwoot/chatwoot)** a APIs não-oficiais de
WhatsApp e centraliza o atendimento. Cada cliente instala na **própria VPS**, ativa
uma **licença** e gerencia tudo por um **painel** com tema escuro.

- **Várias empresas / inboxes** numa só instância, misturando provedores.
- **3 provedores**: Evolution&nbsp;Go, UAZAPI, Z-API (extensível).
- **Mensagens em ordem e sem duplicar** — lock por conversa (Redis) + dedup durável.
- **Licença controlada pelo fornecedor** — ativação online + token assinado (Ed25519) + heartbeat; vínculo por instância (sem compartilhamento).
- **Privacy-by-design** — **nenhum conteúdo de mensagem** fica em repouso no banco.

## 🚀 Instalação (VPS · Docker Swarm)

> **Pré-requisito — DNS:** aponte o domínio que você vai usar (ex:
> `wootrico.suaempresa.com`) para o **IP público da VPS** com um registro **A**
> no painel DNS do seu provedor (Cloudflare, Registro.br, etc.) **antes** de
> instalar. O roteamento é por `Host`, e o **TLS (Let's Encrypt)** só é emitido
> depois que o DNS propaga e as portas **80/443** estão acessíveis. O Wootrico
> **não cria DNS** — e a **URL do webhook é derivada desse domínio**
> (`https://SEU_DOMINIO/webhook/<token>/...`). Se você já tem um **Traefik** na
> VPS, o instalador detecta e **não sobe outro**.

O instalador **não clona o repositório**: ele **gera o `docker-compose.yml`** e
sobe a stack usando a **imagem do Docker Hub**. Basta baixar o `install.sh` e
rodá-lo (na VPS Linux — Ubuntu/Debian/RHEL):

```bash
# baixar só o instalador (repo privado → use um Personal Access Token)
curl -fsSL -H "Authorization: token SEU_PAT" \
  https://raw.githubusercontent.com/ericorenato/wootrico-v2/main/install.sh -o install.sh

# instalar (Swarm) — pergunta a rede overlay, o domínio e o banco/fila/cache; gera as chaves
sudo bash install.sh
```

Durante a instalação ele:

- **Rede:** lista as redes overlay do Swarm e usa a 1ª como padrão (você escolhe);
  só **cria** uma rede dedicada (`wootrico-net`) se **não existir nenhuma**. Nunca
  edita redes nem o Traefik.
- **Traefik:** se já houver um, **não sobe outro nem o altera**; se não houver,
  oferece instalar o próprio (TLS Let's Encrypt).
- **Postgres / RabbitMQ / Redis:** detecta os existentes. Se estiverem **na mesma
  rede** do Wootrico, você pode **reusar** (host/porta/senha); se estiverem em
  **outra rede** (inalcançável), sugere subir uma **instância nova** na rede do
  Wootrico, **com porta alterada**. Em instância nova, **senha em branco = gerada**.
- Gera o `docker-compose.yml` com a imagem do Hub e **sobe a stack automaticamente**.
> — ou o próprio `install.sh` instala o que faltar.
>
> Alternativa via `curl` (repo privado precisa de um Personal Access Token):
> ```bash
> curl -fsSL -H "Authorization: token SEU_PAT" \
>   https://raw.githubusercontent.com/ericorenato/wootrico-v2/main/install.sh | sudo bash
> ```

O instalador **detecta o SO**, instala o que faltar (Docker/Swarm), pergunta a
**rede overlay**, o **domínio** (com teste de DNS) e o **banco/fila/cache**
(reusar existente ou subir novos), **gera ou preserva** as chaves, sobe a stack
e mostra um **resumo**. É **idempotente** (re-rodar não sobrescreve o `.env`).
O **licenciamento não é configurado no instalador** — é provisionado pela
aplicação (ferramenta nossa, a ser implementada).

Depois acesse `https://SEU_DOMINIO` → o **setup wizard** cria o admin e guia a
1ª integração (com teste de conexão e as URLs de webhook).

### Manutenção
```bash
sudo bash install.sh update      # git pull + rebuild + redeploy (preserva .env e dados)
sudo bash install.sh uninstall   # remove a stack (pergunta se apaga os volumes)
```

## 🖥️ Rodar localmente (Docker Desktop)

> **Importante:** o instalador padrão (`curl … | sudo bash`) é para **produção
> com Docker Swarm + Traefik/TLS** (precisa de domínio público) e **não** serve
> para uso local. Para local, use **`install.sh local`** ou o compose abaixo.

**Opção A — um comando (`install.sh local`):** Compose puro, sem Swarm. Pergunta
a porta, gera os segredos e o `.env`, e sobe tudo:

```bash
# baixar o projeto numa pasta e instalar (local)
git clone https://github.com/ericorenato/wootrico-v2.git
cd wootrico-v2
bash install.sh local
# painel em http://localhost:8789 (ou a porta que você escolher)
```

**Opção B — compose manual:** puxando a imagem pública do Hub. A porta do painel
é **configurável** (padrão `8789`, pouco comum, para não conflitar com outras apps).

```bash
cp .env.example .env
# ajuste no .env: PANEL_PORT (ex: 8789),
# e gere JWT_SECRET / APP_ENCRYPTION_KEY:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # JWT_SECRET
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"     # APP_ENCRYPTION_KEY
docker compose -f docker-compose.local.yml up -d   # puxa ericoautomacao/wootrico-v2:latest
# painel em http://localhost:8789   ·   RabbitMQ UI em http://localhost:15673
```

Trocar a porta sem editar arquivo: `PANEL_PORT=9123 docker compose -f docker-compose.local.yml up -d`.

### Rodar em OUTRA máquina

Em qualquer máquina com Docker Desktop, repita a **Opção A** (`bash install.sh
local`). A imagem é pública, então não precisa de código nem build.

- Na própria máquina: `http://localhost:8789`
- De outros dispositivos na rede: `http://IP-DA-MAQUINA:8789` (libere a porta no firewall).

Comandos úteis (local):
```bash
docker compose -f docker-compose.local.yml logs -f app   # logs
docker compose -f docker-compose.local.yml down          # parar
docker compose -f docker-compose.local.yml pull && \
  docker compose -f docker-compose.local.yml up -d        # atualizar para a última imagem
```

## 🧩 Arquitetura

```
WhatsApp API ─▶ /webhook/:token/provider ┐
Chatwoot     ─▶ /webhook/:token/chatwoot ─┤ panel-api (ingress)
                                          ▼
                                      RabbitMQ  (quorum + DLX + retry)
                                          ▼
                                       worker  ──▶ Chatwoot / Provider
                                          │  (lock por conversa + cache + throttle no Redis)
                                          ▼
                                      Postgres  (config + IDs/metadados — SEM conteúdo)
```

- **RabbitMQ** transporta as mensagens (payload só trafega aqui — efêmero).
- **Redis**: lock por conversa (ordem, elimina "delay"), cache de lookups do Chatwoot e throttle de mídia.
- **Postgres**: configuração + estado operacional mínimo (IDs, tickets pseudonimizados, metadados). Telefones em dedup são **HMAC**; `recipient` de mapping é **criptografado**.
- Topologia do RabbitMQ e migrações do banco: **criadas automaticamente** no boot.

## 🔐 Servidor de licença (fornecedor)

Hospedado **separadamente** dos clientes, em uma **imagem própria** (`runtime-license`)
que **nunca** é embarcada na imagem do cliente (`runtime-app`):

Validação **100% online**: o cliente pergunta periodicamente ao servidor "minha chave
está ativa?" — não há par de chaves nem chave pública a embarcar.

**Instalação na VPS (recomendado):** use o instalador dedicado, que detecta SO/Docker/Swarm,
pergunta a rede overlay e o **subdomínio**, **reaproveita um Postgres existente** (ou sobe um
embarcado), gera os segredos e sobe atrás do Traefik (TLS automático):

```bash
sudo bash install-license.sh            # instalar
sudo bash install-license.sh update     # repull da imagem + redeploy (preserva o .env)
sudo bash install-license.sh uninstall  # remover a stack
```

**Manual (Compose):**

```bash
# duas imagens a partir do mesmo Dockerfile:
docker build --target runtime-app     -t ericoautomacao/wootrico-v2:latest .       # CLIENTE
docker build --target runtime-license -t ericoautomacao/wootrico-license:latest .  # FORNECEDOR
docker push ericoautomacao/wootrico-v2:latest
docker push ericoautomacao/wootrico-license:latest

cp apps/license-server/.env.example apps/license-server/.env   # ADMIN_TOKEN + login do painel
#   defina LICENSE_ADMIN_EMAIL / LICENSE_ADMIN_PASSWORD (login do painel)
docker compose -f docker-compose.license-server.yml up -d
```

**Tipos de licença:**

- **Inicial (`trial`):** dura 14 dias (`LICENSE_TRIAL_DAYS`). O cliente **ativa com um clique**
  no wizard de 1º acesso (sem mencionar prazo/preço — captura apenas o cadastro). Só ao
  **expirar** o cliente vê que precisa renovar (self-service) ou adquirir uma licença definitiva.
- **Definitiva (`paid`):** vitalícia, sem expiração — ainda validada periodicamente e revogável.

**Compra / upgrade:** quando o cliente clica em comprar, o app registra uma **intenção de
compra** com seu `instanceId` no servidor. Ao receber o pagamento, o sistema externo chama
o **webhook** `POST /webhook/payment` (autenticado por uma **chave de webhook** `WHK-…`
criada no painel) com o e-mail; o servidor cunha uma **chave paga** para a última intenção
pendente daquele e-mail e a entrega à instância, que se atualiza sozinha. O admin também
pode fazer **upgrade** manual (`/admin/keys/:id/upgrade`).

**Antifraude:** o servidor **alerta** (persistente, no painel admin) quando a mesma chave é
usada a partir de **IPs diferentes** — possível compartilhamento / uso em várias máquinas.

**Manual:** crie uma chave pelo painel admin (`http://<host>:4000/`) ou via API:

```bash
curl -XPOST https://license.seudominio/admin/keys \
  -H "authorization: Bearer SEU_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"plan":"paid","email":"cliente@x.com","name":"Cliente X"}'
```

O **painel admin** (mesmo design do painel do cliente) lista chaves (plano, expiração,
alertas de IP), ativa/desativa/faz upgrade, gerencia chaves de webhook e mostra os
**eventos de acesso/uso** (apenas metadados — IP, instância, versão; sem dados de
conversa, em conformidade com a LGPD).

## 🛠️ Desenvolvimento

Pré-requisitos: Node 20+, pnpm 10+, Docker.

```bash
pnpm install
cp .env.example .env   # gere APP_ENCRYPTION_KEY e JWT_SECRET
pnpm dev:db            # Postgres + RabbitMQ + Redis (docker-compose.dev.yml)
pnpm db:generate && pnpm --filter @wootrico/db migrate:dev
pnpm dev               # api + web + worker
# painel (dev): http://127.0.0.1:5173   ·   API: http://127.0.0.1:3000
```

> Windows: use `127.0.0.1` (o Fastify escuta em IPv4).

Testes ponta-a-ponta (mock de Chatwoot + provedores):
```bash
node --env-file-if-exists=.env scripts/m2-e2e.mjs   # uazapi: round trip + dedup
node --env-file-if-exists=.env scripts/m3-e2e.mjs   # zapi + evolution + roteamento
node --env-file-if-exists=.env scripts/m4-e2e.mjs   # licença: ativar/revogar/binding
```

## 📁 Monorepo

```
apps/      panel-api · panel-web · worker · license-server · license-admin-web
packages/  config · db · types · providers · chatwoot-client · queue · cache · license-client
```

## 📄 Licença de uso

Software proprietário. Uso mediante chave de licença válida fornecida por Erico Renato.
