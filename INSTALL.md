# Instalação na VPS

Instaladores automáticos (Docker Swarm + Traefik/TLS). Detectam SO/Docker/Swarm,
perguntam a rede, o domínio e a infra, geram os segredos e sobem a stack a partir das
imagens publicadas no Docker Hub — **não** clonam o repositório.

Pré-requisitos: VPS **Linux** (Ubuntu/Debian recomendado), acesso **root** (ou `sudo`),
e um **domínio/subdomínio** com registro **A** apontando para o IP da VPS (para o TLS).

> **Sempre baixe o `.sh` e rode a partir de uma pasta própria** (não use `curl | bash`).
> O script fica salvo nessa pasta — é dele que você roda `update` e `uninstall` depois.
> O instalador também grava ali o `.env` e o `docker-compose` gerado.

## URLs dos instaladores

| O que | Como obter |
|---|---|
| **Cliente Wootrico** (público) | `curl -fsSL https://wootrico.ericorenato.com.br/install.sh \| sudo bash` |
| Servidor de licença (**só você**) | `install-license.sh` do repositório **privado** (você tem acesso) — não é público |

> O repositório do código é **privado**. Só o `install.sh` do cliente é público (servido em
> `wootrico.ericorenato.com.br`); ele não contém código, apenas puxa a imagem pública do Docker Hub.
> O `install-license.sh` é do fornecedor e **não** vai para o ar.

---

## 1. Servidor de licença (FORNECEDOR — você hospeda)

Hospede **separado** dos clientes, num subdomínio próprio (ex.: `license.suaempresa.com`).
Só precisa de um **Postgres** (reaproveita um existente ou sobe um dedicado).

**Instalar:**

```bash
mkdir -p /opt/wootrico-license && cd /opt/wootrico-license
curl -fsSL -O https://raw.githubusercontent.com/ericorenato/wootrico-v2/main/install-license.sh
sudo bash install-license.sh
```

O instalador pergunta: rede overlay, **subdomínio**, e-mail do TLS, reaproveitamento do
**Postgres**, login do **painel admin** e os **dias de validade da licença inicial**. Ao final
mostra a URL do painel (`https://SEU_SUBDOMINIO/`), a URL do **webhook de pagamento**
(`/webhook/payment`) e os segredos gerados.

**Atualizar / desinstalar** (rode da MESMA pasta `/opt/wootrico-license`):

```bash
cd /opt/wootrico-license
sudo bash install-license.sh update      # repull da imagem + redeploy (preserva o .env.license)
sudo bash install-license.sh uninstall   # remove a stack (pergunta se apaga o banco)
```

Depois de no ar, no painel admin abra **Webhooks** para criar a chave `WHK-…` usada pelo
seu provedor de pagamento (e ver o **payload** que o webhook espera), e a aba **Saúde**
para acompanhar instâncias que pararam de validar e alertas de IP.

---

## 2. Cliente Wootrico (quem usa o produto)

A URL do seu servidor de licença **já vem embutida na imagem** — o cliente não configura nada
disso. O licenciamento é **obrigatório**: no 1º acesso o cliente ativa a licença e, sem ela, o
produto não processa nem cria integrações.

**Instalar** (um comando, sem baixar arquivo — o instalador é público; o código é privado):

```bash
curl -fsSL https://wootrico.ericorenato.com.br/install.sh | sudo bash
```

Cria um subdiretório dedicado **`./wootrico`** na pasta atual (compose + `.env` isolados,
para não colidir com outras instalações Docker), e pergunta a rede, o **domínio**, o TLS e a
infra (Postgres/RabbitMQ/Redis — reaproveita ou sobe embarcados). No 1º acesso
(`https://SEU_DOMINIO`) o **setup wizard** cria o admin (nome + e-mail) e **ativa a licença**.

A instalação também registra o comando **`wootrico`** (em `/usr/local/bin`). Depois é só:

```bash
sudo wootrico update      # baixa a versão NOVA do instalador, atualiza a imagem e redeploya (preserva o .env)
sudo wootrico uninstall   # remove a stack (pergunta se apaga os volumes)
wootrico --help           # ajuda
```

Rode da mesma pasta da instalação (ele acha o `./wootrico`). O `update` é auto-atualizável:
baixa o `install.sh` mais recente e se re-executa. O one-liner também funciona como fallback:
`curl -fsSL https://wootrico.ericorenato.com.br/install.sh | sudo bash -s update`.

> O instalador só puxa a **imagem pública** do Docker Hub e gera o compose — não expõe código.
> O `curl | bash` funciona sem criar arquivo porque os prompts são lidos do `/dev/tty`.

---

## 3. Instalação via Docker Compose (Coolify / Portainer / Dockge)

Para o cliente que **não quer usar o terminal** e já tem um painel de deploy. Use o
`docker-compose.coolify.yml` — ele não builda nada, só puxa a imagem pública do Docker
Hub e sobe painel + worker + Postgres/RabbitMQ/Redis embarcados. Todos os pontos que
precisam de ajuste (senhas, hosts, domínio, rede, infra externa) estão comentados no
próprio arquivo.

O arquivo também é servido publicamente (o repositório é privado, o cliente não clona nada):

```
https://wootrico.ericorenato.com.br/wootrico-compose.yml
```

**No Coolify:**

1. Project → **+ New Resource** → **Docker Compose (Empty)**
2. Cole o conteúdo de [`docker-compose.coolify.yml`](docker-compose.coolify.yml)
   (ou copie direto da seção **Instalação** em `wootrico.ericorenato.com.br`)
3. Aba **Environment Variables** — o Coolify lista sozinho as variáveis `${...}`.
   Preencha as 5 obrigatórias:

   | Variável | Como obter |
   |---|---|
   | `POSTGRES_PASSWORD` | invente uma senha forte (uso interno) |
   | `RABBITMQ_PASSWORD` | idem |
   | `PUBLIC_BASE_URL` | `https://SEU_DOMINIO` (sem barra no final) |
   | `JWT_SECRET` | `openssl rand -base64 48` |
   | `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` (**tem** que ser 32 bytes) |

4. Aba **Domains** do serviço `app` → domínio + porta **3000**. O Coolify cuida do
   proxy e do TLS (não use o `docker-compose.traefik.yml` nesse caso).
5. **Deploy** → abra `https://SEU_DOMINIO` e conclua o setup wizard (admin + licença).

**Fora do Coolify** (Portainer, Dockge, `docker compose` puro): copie
`.env.compose.example` para `.env`, preencha, descomente o bloco `ports:` do serviço
`app` e rode `docker compose -f docker-compose.coolify.yml up -d`.

> ⚠️ **Nunca defina `LICENSE_SERVER_URL`** nesse fluxo. A URL do servidor de licença já
> vem embutida na imagem; declará-la em runtime sobrescreve o valor correto e derruba a
> licença. Pelo mesmo motivo o compose não usa `env_file`.

Diferenças em relação ao `install.sh`: não registra o comando `wootrico`, não instala
Traefik e não gera os segredos sozinho — atualizar é redeployar pelo painel (o Coolify
faz o `pull` da `:latest`). As migrações de banco continuam rodando sozinhas no boot.

---

## Imagens Docker

| Imagem | Alvo | Quem hospeda |
|---|---|---|
| `ericoautomacao/wootrico-v2:latest` | cliente (painel + worker) | seu cliente |
| `ericoautomacao/wootrico-license:latest` | servidor de licença + painel admin | você (fornecedor) |

Ambas são `linux/amd64`. Os instaladores sempre puxam a tag `:latest` mais recente, então
`update` traz a versão publicada mais nova. Migrações de banco rodam sozinhas no boot.
