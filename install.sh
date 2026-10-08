#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Wootrico v2 — instalador para VPS (Docker Swarm).
#   curl -fsSL https://wootrico.ericorenato.com.br/install.sh | sudo bash
#
# A instalação também registra o comando `wootrico` (em /usr/local/bin), então
# depois é só:
#   wootrico update       # baixa a versão nova, atualiza a imagem e redeploya (preserva .env)
#   wootrico uninstall    # remove a stack (e opcionalmente os volumes)
#   wootrico --help       # ajuda
#
# NÃO clona o repositório nem expõe código: a stack sobe via Compose GERADO pelo
# instalador usando a imagem PÚBLICA do Docker Hub. Detecta o SO/Docker/Swarm,
# pergunta a rede overlay e as chaves, gera/preserva segredos, sobe a stack e
# mostra um resumo. Cria um subdiretório dedicado (./wootrico) na pasta atual,
# para não colidir com outras instalações Docker. Idempotente: re-executar NÃO
# sobrescreve valores já existentes no .env.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

STACK_NAME="wootrico"
IMAGE="${WOOTRICO_IMAGE:-ericoautomacao/wootrico-v2:latest}"
ENV_FILE=".env"
# CLI: o instalador se copia para cá, virando o comando `wootrico`.
CLI_PATH="${WOOTRICO_CLI_PATH:-/usr/local/bin/wootrico}"
INSTALL_URL="${WOOTRICO_INSTALL_URL:-https://wootrico.ericorenato.com.br/install.sh}"
# Caminho absoluto DESTE script (vazio quando rodado por `curl | bash`, via stdin).
SELF_SRC=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SELF_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/$(basename "${BASH_SOURCE[0]}")"
fi

if [ -t 1 ]; then C_B="\033[1m"; C_G="\033[32m"; C_Y="\033[33m"; C_R="\033[31m"; C_C="\033[36m"; C_0="\033[0m"; else C_B=""; C_G=""; C_Y=""; C_R=""; C_C=""; C_0=""; fi
info()  { echo -e "${C_C}›${C_0} $*"; }
ok()    { echo -e "${C_G}✓${C_0} $*"; }
warn()  { echo -e "${C_Y}!${C_0} $*"; }
err()   { echo -e "${C_R}✗${C_0} $*" >&2; }
title() { echo -e "\n${C_B}== $* ==${C_0}"; }

SUMMARY=(); note() { SUMMARY+=("$1"); }
SUDO=""

ask() {
  local prompt="$1" def="${2:-}" ans
  if [ -n "$def" ]; then read -rp "$(echo -e "${C_C}?${C_0} ${prompt} [${def}]: ")" ans </dev/tty || true; echo "${ans:-$def}"
  else read -rp "$(echo -e "${C_C}?${C_0} ${prompt}: ")" ans </dev/tty || true; echo "$ans"; fi
}
confirm() {
  local ans; read -rp "$(echo -e "${C_C}?${C_0} $1 [Y/n]: ")" ans </dev/tty || true
  case "${ans:-Y}" in [Nn]*) return 1 ;; *) return 0 ;; esac
}
need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else err "Rode como root ou instale sudo."; exit 1; fi
  fi
}

usage() {
  cat <<EOF
Wootrico — integração WhatsApp + Chatwoot (self-hosted)

Uso:
  wootrico install      Instalar / reconfigurar a stack (padrão)
  wootrico update       Baixar a versão nova, atualizar a imagem e redeployar (preserva o .env)
  wootrico uninstall    Remover a stack (pergunta sobre os volumes)
  wootrico --help       Esta ajuda

Instalação inicial (one-liner):
  curl -fsSL ${INSTALL_URL} | sudo bash
EOF
}

# Baixa o install.sh mais novo da URL pública para o comando `wootrico`. 0 = ok.
self_update() {
  local tmp; tmp="$(mktemp)"
  if command -v curl >/dev/null 2>&1 \
    && curl -fsSL "$INSTALL_URL" -o "$tmp" 2>/dev/null \
    && [ -s "$tmp" ] && head -n1 "$tmp" | grep -q '^#!'; then
    $SUDO install -m 0755 "$tmp" "$CLI_PATH" 2>/dev/null && { rm -f "$tmp"; return 0; }
  fi
  rm -f "$tmp"; return 1
}

# Instala/atualiza o comando `wootrico` em CLI_PATH: copia este arquivo quando há
# um (bash install.sh), senão baixa da URL pública (curl | bash). Best-effort.
install_cli() {
  if [ -n "$SELF_SRC" ] && [ -r "$SELF_SRC" ] && [ "$SELF_SRC" != "$CLI_PATH" ]; then
    $SUDO install -m 0755 "$SELF_SRC" "$CLI_PATH" 2>/dev/null \
      && { ok "Comando 'wootrico' instalado em $CLI_PATH"; return 0; }
  fi
  if self_update; then
    ok "Comando 'wootrico' instalado em $CLI_PATH"
  else
    warn "Não consegui instalar o comando 'wootrico' (siga usando o one-liner do curl)."
  fi
}
# Leitura global de um valor do .env (helpers get_env/set_env locais ficam em configure_env).
genv() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
# Percent-encode para usar credenciais (com @ : / etc.) dentro de URLs.
urlenc() {
  local s="$1" out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) printf -v c '%%%02X' "'$c"; out+="$c" ;;
    esac
  done
  printf '%s' "$out"
}
# IP primário do host (sugestão para conectar a serviços já existentes).
host_gw() { hostname -I 2>/dev/null | awk '{print $1}'; }
# Porta TCP escutando em 127.0.0.1 (via /dev/tcp do bash).
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1 && { exec 3>&- 3<&-; return 0; }; return 1; }
# Containers em execução cuja imagem casa com o regex $1 → nomes.
containers_for() { $SUDO docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -iE "$1" | awk '{print $1}'; }
# Detecta um serviço por imagem de container OU porta em uso. $1=regex img $2=porta
svc_detected() { [ -n "$(containers_for "$1")" ] && return 0; port_open "$2"; }
# Lê uma senha sem ecoar; valor vai p/ stdout, prompt/linha p/ stderr.
ask_pass() { local p="$1" a; read -rsp "$(echo -e "${C_C}?${C_0} ${p}: ")" a </dev/tty || true; printf '\n' >&2; printf '%s' "$a"; }

# Nome DNS curto de um serviço existente na rede $NET_NAME (sem expor portas).
# Convenção comum (Swarm/stack): o nome CURTO do serviço (ex.: 'postgres') é
# registrado como alias de rede e resolve para qualquer container da mesma
# overlay — então preferimos ele em vez do nome completo 'stack_servico'.
svc_alias_on_net() { # $1 img-regex
  local c nets raw
  for c in $(containers_for "$1"); do
    nets="$($SUDO docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$c" 2>/dev/null)"
    case " $nets " in *" ${NET_NAME} "*) ;; *) continue ;; esac
    raw="$($SUDO docker inspect -f '{{ index .Config.Labels "com.docker.swarm.service.name" }}' "$c" 2>/dev/null)"
    [ -z "$raw" ] && raw="${c%%.*}"      # fallback: nome do container (sem .N.id)
    printf '%s' "${raw#*_}"              # remove o prefixo da stack → nome curto
    return 0
  done
  return 1
}

# ───────────────────────────── INSTALL ─────────────────────────────
# Keep the compose/.env in a dedicated subfolder (./wootrico) so it never collides
# with other Docker projects sharing the same path. Re-entrant: stays put if the
# current dir is already a Wootrico install, else uses ./wootrico (creating it on
# install). update/uninstall find it here or in the parent.
enter_install_dir() {
  local mode="$1" # install | manage
  if [ -f "$ENV_FILE" ] && grep -q '^WOOTRICO_' "$ENV_FILE" 2>/dev/null; then
    return 0 # already inside an install dir
  fi
  if [ -f "$STACK_NAME/$ENV_FILE" ]; then
    cd "$STACK_NAME"; info "Instalação encontrada em $(pwd)"; return 0
  fi
  if [ "$mode" = "install" ]; then
    mkdir -p "$STACK_NAME"; cd "$STACK_NAME"; info "Diretório da instalação: $(pwd)"
  else
    err ".env não encontrado — rode a instalação primeiro (aqui ou em ./$STACK_NAME)."; exit 1
  fi
}

cmd_install() {
  title "Sistema operacional"
  [ "$(uname -s)" = "Linux" ] || { err "Este instalador é para Linux (VPS)."; exit 1; }
  need_root
  enter_install_dir install
  local OS_ID="desconhecido" PKG=""
  [ -f /etc/os-release ] && . /etc/os-release && OS_ID="${ID:-desconhecido}"
  case "$OS_ID" in
    ubuntu|debian|raspbian|linuxmint|pop) PKG="apt" ;;
    centos|rhel|rocky|almalinux|fedora|amzn) command -v dnf >/dev/null 2>&1 && PKG="dnf" || PKG="yum" ;;
    *) warn "Distro '$OS_ID' não reconhecida; tentarei seguir." ;;
  esac
  ok "Detectado: ${PRETTY_NAME:-$OS_ID} (gerenciador: ${PKG:-n/d})"; note "SO: ${PRETTY_NAME:-$OS_ID}"

  local pkg_update_done=0
  pkg_update() { [ "$pkg_update_done" = 1 ] && return 0
    case "$PKG" in apt) info "apt-get update…"; $SUDO apt-get update -y >/dev/null ;; dnf) $SUDO dnf -y check-update >/dev/null 2>&1 || true ;; yum) $SUDO yum -y check-update >/dev/null 2>&1 || true ;; esac
    pkg_update_done=1; }
  pkg_install() {
    local bin="$1" pkg="${2:-$1}"
    command -v "$bin" >/dev/null 2>&1 && { ok "$bin já instalado"; return 0; }
    confirm "Instalar '$pkg' (ausente)?" || { warn "Pulado: $pkg"; return 0; }
    pkg_update
    case "$PKG" in apt) $SUDO apt-get install -y "$pkg" >/dev/null ;; dnf) $SUDO dnf install -y "$pkg" >/dev/null ;; yum) $SUDO yum install -y "$pkg" >/dev/null ;; *) err "Sem gerenciador para instalar $pkg"; return 1 ;; esac
    ok "$pkg instalado"; note "Instalado: $pkg"
  }

  title "Dependências base"
  pkg_install curl; pkg_install git; pkg_install openssl

  title "Docker"
  if command -v docker >/dev/null 2>&1; then ok "Docker já instalado ($(docker --version | awk '{print $3}' | tr -d ,))"
  elif confirm "Docker não encontrado. Instalar via get.docker.com?"; then
    curl -fsSL https://get.docker.com | $SUDO sh; $SUDO systemctl enable --now docker 2>/dev/null || true
    ok "Docker instalado"; note "Instalado: Docker Engine"
  else err "Docker é obrigatório."; exit 1; fi

  title "Docker Swarm"
  if [ "$($SUDO docker info -f '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo inactive)" = "active" ]; then ok "Swarm já ativo"
  elif confirm "Inicializar o Docker Swarm neste nó?"; then
    local ip; ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    $SUDO docker swarm init --advertise-addr "${ip:-127.0.0.1}" >/dev/null 2>&1 || $SUDO docker swarm init >/dev/null 2>&1 || { err "Falha no swarm init (tente --advertise-addr <IP>)"; exit 1; }
    ok "Swarm inicializado"; note "Swarm: inicializado (${ip:-local})"
  else err "Swarm é obrigatório."; exit 1; fi

  # Sem clone do repositório: a stack sobe via Compose gerado aqui, usando a
  # imagem publicada no Docker Hub.
  decide_network
  decide_traefik
  decide_infra
  configure_env
  pull_image      # resolve o digest ANTES de gerar o compose (fixa por digest)
  write_compose
  deploy_stack
  install_cli     # instala o comando `wootrico` (update/uninstall/--help)
  print_summary
}

# ───────────────────────────── .env ─────────────────────────────
configure_env() {
  title "Configuração (.env)"
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
  set_env() { local k="$1" v="$2" tmp; if grep -qE "^$k=" "$ENV_FILE"; then tmp="$(mktemp)"; grep -vE "^$k=" "$ENV_FILE" > "$tmp"; mv "$tmp" "$ENV_FILE"; fi; printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"; }
  keep_or() { local cur; cur="$(get_env "$1")"; [ -n "$cur" ] && echo "$cur" || echo "$2"; }
  gen() { openssl rand -base64 "$1" | tr -d '\n='; }
  genhex() { openssl rand -hex "$1"; }

  # Segredos: SEMPRE automáticos (sem perguntas). Preserva valores já existentes.
  JWT_SECRET="$(get_env JWT_SECRET)"; [ -z "$JWT_SECRET" ] && { JWT_SECRET="$(gen 48)"; note "JWT_SECRET: gerado automaticamente"; }
  APP_ENCRYPTION_KEY="$(get_env APP_ENCRYPTION_KEY)"; [ -z "$APP_ENCRYPTION_KEY" ] && { APP_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"; note "APP_ENCRYPTION_KEY: gerado automaticamente"; }

  echo
  info "Informe o DOMÍNIO onde o Wootrico vai responder — é o endereço do PAINEL de"
  info "configuração e dos WEBHOOKS (a URL do webhook é derivada dele)."
  info "Use um domínio/subdomínio que você controla. Ex.: wootrico.suaempresa.com.br"
  while :; do
    DOMAIN="$(ask "Domínio do Wootrico (painel + webhooks)" "$(get_env DOMAIN)")"
    [ -n "$DOMAIN" ] && break
    warn "Informe um domínio."
  done
  info "Aponte um registro A de '${DOMAIN}' para o IP deste servidor para o TLS (Let's Encrypt) emitir o certificado."

  # E-mail do Let's Encrypt só quando o Wootrico instala o Traefik (default: admin@domínio).
  if [ "${USE_TRAEFIK:-1}" = 1 ]; then
    ACME_EMAIL="$(ask "E-mail para o certificado TLS (Let's Encrypt)" "$(keep_or ACME_EMAIL "admin@${DOMAIN}")")"
  else
    ACME_EMAIL="$(get_env ACME_EMAIL)"
  fi

  set_env DOMAIN "$DOMAIN"; set_env ACME_EMAIL "$ACME_EMAIL"
  set_env WOOTRICO_TRAEFIK "${USE_TRAEFIK:-1}"
  set_env WOOTRICO_TRAEFIK_ENTRYPOINT "${TRAEFIK_ENTRYPOINT:-websecure}"
  set_env WOOTRICO_TRAEFIK_RESOLVER "${TRAEFIK_RESOLVER:-le}"
  set_env WOOTRICO_NETWORK "${NET_NAME:-${STACK_NAME}-net}"

  # Banco/fila/cache — modos/host/porta/credenciais decididos em decide_infra.
  # Credenciais são percent-encoded ao montar as URLs (senhas com @ : / etc.).
  set_env POSTGRES_USER "$PG_USER"; set_env POSTGRES_PASSWORD "$PG_PASS"; set_env POSTGRES_DB "$PG_DB"
  set_env DATABASE_URL "postgresql://$(urlenc "$PG_USER"):$(urlenc "$PG_PASS")@${PG_HOST}:${PG_PORT}/${PG_DB}?schema=public"
  set_env RABBITMQ_USER "$RB_USER"; set_env RABBITMQ_PASSWORD "$RB_PASS"
  set_env RABBITMQ_VHOST "$RB_VHOST"
  # vhost vai no caminho da URL (default '/' → %2F).
  set_env RABBITMQ_URL "amqp://$(urlenc "$RB_USER"):$(urlenc "$RB_PASS")@${RB_HOST}:${RB_PORT}/$(urlenc "$RB_VHOST")"
  if [ -n "${RD_PASS:-}" ]; then
    set_env REDIS_PASSWORD "$RD_PASS"; set_env REDIS_URL "redis://:$(urlenc "$RD_PASS")@${RD_HOST}:${RD_PORT}"
  else
    set_env REDIS_PASSWORD ""; set_env REDIS_URL "redis://${RD_HOST}:${RD_PORT}"
  fi
  # modos/host/portas persistidos p/ o 'update' regenerar e p/ o resumo.
  set_env WOOTRICO_PG_MODE "$PG_MODE"; set_env WOOTRICO_PG_HOST "$PG_HOST"; set_env WOOTRICO_PG_PORT "$PG_PORT"
  set_env WOOTRICO_RB_MODE "$RB_MODE"; set_env WOOTRICO_RB_HOST "$RB_HOST"; set_env WOOTRICO_RB_PORT "$RB_PORT"
  set_env WOOTRICO_RD_MODE "$RD_MODE"; set_env WOOTRICO_RD_HOST "$RD_HOST"; set_env WOOTRICO_RD_PORT "$RD_PORT"
  set_env PUBLIC_BASE_URL "$(keep_or PUBLIC_BASE_URL "https://${DOMAIN}")"
  # Licenciamento é SEMPRE obrigatório (sem opt-out): a URL do servidor de licença
  # vem embutida na imagem e a chave é ativada no 1º acesso. Nada a configurar aqui.
  set_env JWT_SECRET "$JWT_SECRET"; set_env APP_ENCRYPTION_KEY "$APP_ENCRYPTION_KEY"
  set_env NODE_ENV "$(keep_or NODE_ENV production)"; set_env PORT "$(keep_or PORT 3000)"
  set_env HOST "$(keep_or HOST 0.0.0.0)"; set_env LOG_LEVEL "$(keep_or LOG_LEVEL info)"
  chmod 600 "$ENV_FILE"; ok ".env atualizado (preservando valores existentes)"
}

# Descobre o IP público deste servidor (para a instrução de DNS).
public_ip() {
  local ip
  ip="$(curl -s --max-time 4 https://api.ipify.org 2>/dev/null)"
  [ -z "$ip" ] && ip="$(curl -s --max-time 4 https://ifconfig.me 2>/dev/null)"
  [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "$ip"
}

# Detecta um Traefik já em execução (Swarm ou container) para não duplicar o
# proxy/portas 80/443. Se não detectar, pergunta se deve instalar. A escolha é
# persistida no .env (WOOTRICO_TRAEFIK) para o 'update' reutilizá-la.
# Lê a configuração do Traefik existente (args de CLI do serviço/container) e
# descobre AUTOMATICAMENTE o entrypoint ligado à :443 e o nome do certresolver
# (ACME). Sem perguntar nada ao usuário. Cai em defaults se não conseguir ler.
detect_traefik_config() {
  local args="" svc cid
  svc="$($SUDO docker service ls --format '{{.Name}} {{.Image}}' 2>/dev/null | grep -i traefik | awk '{print $1}' | head -1)"
  if [ -n "$svc" ]; then
    args="$($SUDO docker service inspect "$svc" --format '{{range .Spec.TaskTemplate.ContainerSpec.Args}}{{println .}}{{end}}{{range .Spec.TaskTemplate.ContainerSpec.Command}}{{println .}}{{end}}' 2>/dev/null)"
  fi
  if [ -z "$args" ]; then
    cid="$($SUDO docker ps --format '{{.ID}} {{.Image}}' 2>/dev/null | grep -i traefik | awk '{print $1}' | head -1)"
    [ -n "$cid" ] && args="$($SUDO docker inspect "$cid" --format '{{range .Args}}{{println .}}{{end}}{{range .Config.Cmd}}{{println .}}{{end}}' 2>/dev/null)"
  fi
  local ep rs
  ep="$(printf '%s\n' "$args" | grep -oE 'entrypoints\.[A-Za-z0-9_-]+\.address=:443' | sed -E 's/.*entrypoints\.([A-Za-z0-9_-]+)\.address.*/\1/' | head -1)"
  rs="$(printf '%s\n' "$args" | grep -oE 'certificatesresolvers\.[A-Za-z0-9_-]+\.acme' | sed -E 's/.*certificatesresolvers\.([A-Za-z0-9_-]+)\.acme.*/\1/' | head -1)"
  TRAEFIK_ENTRYPOINT="${ep:-${TRAEFIK_ENTRYPOINT:-websecure}}"
  TRAEFIK_RESOLVER="${rs:-${TRAEFIK_RESOLVER:-letsencryptresolver}}"
  [ -n "$ep" ] && [ -n "$rs" ] && return 0 || return 1
}

decide_traefik() {
  title "Traefik (proxy reverso + TLS)"
  local found=""
  found="$($SUDO docker service ls --format '{{.Image}}' 2>/dev/null; $SUDO docker ps --format '{{.Image}}' 2>/dev/null)"
  if printf '%s\n' "$found" | grep -qi 'traefik'; then
    USE_TRAEFIK=0
    ok "Traefik já detectado — NÃO vou subir outro nem alterar a configuração dele."
    # Descobre automaticamente entrypoint HTTPS + certresolver da config do Traefik.
    if detect_traefik_config; then
      ok "Config do Traefik detectada: entrypoint='${TRAEFIK_ENTRYPOINT}', certresolver='${TRAEFIK_RESOLVER}'."
    else
      warn "Não consegui ler toda a config do Traefik; usando: entrypoint='${TRAEFIK_ENTRYPOINT}', certresolver='${TRAEFIK_RESOLVER}'."
      info "Se o TLS não emitir, ajuste WOOTRICO_TRAEFIK_ENTRYPOINT/RESOLVER no .env e rode 'install.sh update'."
    fi
    warn "Seu Traefik precisa usar o provider Swarm e observar a rede '${NET_NAME:-<rede selecionada>}' (o app expõe as labels na porta 3000). O instalador não modifica o Traefik."
    note "Traefik: existente (intocado); entrypoint=${TRAEFIK_ENTRYPOINT} resolver=${TRAEFIK_RESOLVER}"
  elif confirm "Traefik não detectado. Instalar o Traefik (com TLS Let's Encrypt)?"; then
    USE_TRAEFIK=1
    TRAEFIK_ENTRYPOINT="websecure"; TRAEFIK_RESOLVER="le"
    note "Traefik: será instalado pelo Wootrico"
  else
    USE_TRAEFIK=0
    warn "Sem Traefik: configure seu próprio proxy publicando o serviço 'app' (porta 3000) no domínio informado."
    note "Traefik: não instalado (proxy externo do usuário)"
  fi
}

# Seleção da rede overlay. NÃO cria rede se já existir alguma: lista todas,
# usa a 1ª como padrão e deixa o usuário escolher. Só cria uma rede dedicada
# ('wootrico-net') quando NÃO existe nenhuma. Nunca altera o Traefik nem redes.
decide_network() {
  title "Rede Docker (overlay/Swarm)"
  local overlays=()
  while IFS= read -r n; do [ -n "$n" ] && overlays+=("$n"); done < <(
    $SUDO docker network ls --filter driver=overlay --format '{{.Name}}' 2>/dev/null | grep -vE '^(ingress|docker_gwbridge)$' || true
  )
  if [ "${#overlays[@]}" -gt 0 ]; then
    local first="${overlays[0]}"
    info "Redes overlay encontradas (a 1ª é o padrão; o instalador NÃO cria/edita redes):"
    local i=1 n; for n in "${overlays[@]}"; do printf '   %d) %s\n' "$i" "$n"; i=$((i+1)); done
    local sel; sel="$(ask "Selecione a rede (número ou nome)" "$first")"
    if printf '%s' "$sel" | grep -qE '^[0-9]+$'; then NET_NAME="${overlays[$((sel-1))]:-$first}"; else NET_NAME="$sel"; fi
    [ -z "$NET_NAME" ] && NET_NAME="$first"
    $SUDO docker network inspect "$NET_NAME" >/dev/null 2>&1 || { warn "Rede '${NET_NAME}' não existe; usando '${first}'."; NET_NAME="$first"; }
    ok "Usando a rede existente '${NET_NAME}'."
    note "Rede: ${NET_NAME} (existente)"
  else
    NET_NAME="${STACK_NAME}-net"
    info "Nenhuma rede overlay encontrada neste Swarm."
    info "Vou criar uma rede overlay dedicada ao Wootrico: '${NET_NAME}'."
    info "(Não altero o Traefik nem crio outras redes — apenas esta, por não existir nenhuma.)"
    $SUDO docker network create --driver overlay --attachable "$NET_NAME" >/dev/null \
      && ok "Rede '${NET_NAME}' criada." || { err "Falha ao criar a rede."; exit 1; }
    note "Rede: ${NET_NAME} (criada — não havia nenhuma)"
  fi
}

# Banco/Fila/Cache — versão MÍNIMA. O instalador decide só o ESSENCIAL para subir:
# para cada serviço, se já existe no ambiente, pergunta se quer reaproveitar;
# senão, sobe um embarcado (segredos automáticos). Sem testes/loops aqui — o
# ASSISTENTE do 1º acesso valida e refina host/usuário/senha/vhost de cada
# serviço, com teste de conexão automático.
# Exceção: o Postgres é necessário JÁ no 1º start (o painel guarda os dados nele),
# então, ao reaproveitar um Postgres externo, pedimos o acesso aqui mesmo.
decide_infra() {
  title "Banco · Fila · Cache (Postgres · RabbitMQ · Redis)"
  info "O instalador decide só o necessário para subir. Ajustes finos (host, usuário,"
  info "senha, vhost) ficam no assistente do 1º acesso, com teste de conexão automático."
  local gw; gw="$(host_gw)"

  # Para um serviço: define __MODE (new|existing) e __DEFHOST (host sugerido).
  _infra_one() { # $1 label  $2 img-regex  $3 porta-padrão
    local label="$1" img="$2" defport="$3"
    __MODE=new; __DEFHOST=""
    if svc_detected "$img" "$defport"; then
      local alias; alias="$(svc_alias_on_net "$img")"; [ -z "$alias" ] && alias="${gw:-127.0.0.1}"
      echo
      warn "${label} já existe neste ambiente (host sugerido: ${alias})."
      if confirm "Reaproveitar o ${label} existente? ('n' = subir um novo do Wootrico)"; then
        __MODE=existing; __DEFHOST="$alias"
      fi
    else
      info "${label} não encontrado — vou subir um embarcado."
    fi
  }

  # ---- Postgres (boot-crítico: precisa de acesso já no 1º start) ----
  PG_USER="$(genv POSTGRES_USER)"; PG_USER="${PG_USER:-wootrico}"
  PG_DB="$(genv POSTGRES_DB)";     PG_DB="${PG_DB:-wootrico}"
  PG_PASS="$(genv POSTGRES_PASSWORD)"
  _infra_one Postgres 'postgres|postgis' 5432; PG_MODE="$__MODE"
  if [ "$PG_MODE" = existing ]; then
    info "O painel guarda os dados no Postgres — informe o acesso ao banco existente."
    PG_HOST="$(ask "Host do Postgres (nome do serviço na rede / IP)" "${__DEFHOST:-${gw:-127.0.0.1}}")"
    PG_PORT="$(ask "Porta do Postgres" "5432")"
    PG_USER="$(ask "Usuário do Postgres" "$PG_USER")"
    local pp; pp="$(ask_pass "Senha do Postgres")"; [ -n "$pp" ] && PG_PASS="$pp"
    PG_DB="$(ask "Banco do Wootrico (crie-o antes, se não existir)" "$PG_DB")"
  else
    PG_HOST="postgres"
    PG_PORT="$(svc_detected 'postgres|postgis' 5432 && echo 5433 || echo 5432)"
    [ -z "$PG_PASS" ] && { PG_PASS="$(openssl rand -hex 16)"; note "Postgres: senha gerada automaticamente"; }
  fi
  ok "Postgres: ${PG_MODE} → ${PG_HOST}:${PG_PORT}"; note "Postgres: ${PG_MODE} (${PG_HOST}:${PG_PORT})"

  # ---- RabbitMQ (refinado no assistente) ----
  RB_USER="$(genv RABBITMQ_USER)"; RB_USER="${RB_USER:-wootrico}"
  RB_PASS="$(genv RABBITMQ_PASSWORD)"
  RB_VHOST="$(genv RABBITMQ_VHOST)"; RB_VHOST="${RB_VHOST:-/}"
  _infra_one RabbitMQ 'rabbitmq' 5672; RB_MODE="$__MODE"
  if [ "$RB_MODE" = existing ]; then
    RB_HOST="${__DEFHOST:-${gw:-127.0.0.1}}"; RB_PORT=5672
    info "Usuário/senha/vhost do RabbitMQ você confirma no assistente do 1º acesso."
  else
    RB_HOST="rabbitmq"
    RB_PORT="$(svc_detected 'rabbitmq' 5672 && echo 5673 || echo 5672)"
    [ -z "$RB_PASS" ] && { RB_PASS="$(openssl rand -hex 16)"; note "RabbitMQ: senha gerada automaticamente"; }
  fi
  ok "RabbitMQ: ${RB_MODE} → ${RB_HOST}:${RB_PORT} (vhost ${RB_VHOST})"; note "RabbitMQ: ${RB_MODE} (${RB_HOST}:${RB_PORT} vhost ${RB_VHOST})"

  # ---- Redis (refinado no assistente) ----
  RD_PASS="$(genv REDIS_PASSWORD)"
  _infra_one Redis 'redis' 6379; RD_MODE="$__MODE"
  if [ "$RD_MODE" = existing ]; then
    RD_HOST="${__DEFHOST:-${gw:-127.0.0.1}}"; RD_PORT=6379
    info "Senha do Redis (se houver) você confirma no assistente do 1º acesso."
  else
    RD_HOST="redis"
    RD_PORT="$(svc_detected 'redis' 6379 && echo 6380 || echo 6379)"
    # Redis embarcado sem senha por padrão (rede interna do Swarm).
  fi
  ok "Redis: ${RD_MODE} → ${RD_HOST}:${RD_PORT}"; note "Redis: ${RD_MODE} (${RD_HOST}:${RD_PORT})"
}

# Gera o docker-compose.yml da stack (app+infra, e Traefik se aplicável) usando
# a imagem do Docker Hub e a rede escolhida (externa). Sem clonar o repositório.
write_compose() {
  # Modos/portas: dos globais (install) ou do .env (update).
  local pg_mode="${PG_MODE:-$(genv WOOTRICO_PG_MODE)}"; pg_mode="${pg_mode:-new}"
  local rb_mode="${RB_MODE:-$(genv WOOTRICO_RB_MODE)}"; rb_mode="${rb_mode:-new}"
  local rd_mode="${RD_MODE:-$(genv WOOTRICO_RD_MODE)}"; rd_mode="${rd_mode:-new}"
  local pg_port="${PG_PORT:-$(genv WOOTRICO_PG_PORT)}"; pg_port="${pg_port:-5432}"
  local rb_port="${RB_PORT:-$(genv WOOTRICO_RB_PORT)}"; rb_port="${rb_port:-5672}"
  local rd_port="${RD_PORT:-$(genv WOOTRICO_RD_PORT)}"; rd_port="${rd_port:-6379}"
  local rd_pass="${RD_PASS:-$(genv REDIS_PASSWORD)}"
  local tf="${USE_TRAEFIK:-${WOOTRICO_TRAEFIK:-1}}"
  local net="${NET_NAME:-$(genv WOOTRICO_NETWORK)}"; net="${net:-${STACK_NAME}-net}"
  # Nomes do entrypoint HTTPS e do certresolver (ACME) — devem casar com o Traefik.
  local ep="${TRAEFIK_ENTRYPOINT:-$(genv WOOTRICO_TRAEFIK_ENTRYPOINT)}"; ep="${ep:-websecure}"
  local rs="${TRAEFIK_RESOLVER:-$(genv WOOTRICO_TRAEFIK_RESOLVER)}"; rs="${rs:-le}"
  title "Gerando compose (rede: ${net}; traefik: ${tf}; pg/rb/rd: ${pg_mode}/${rb_mode}/${rd_mode})"
  local f="docker-compose.yml"
  local vols=()

  printf '%s\n' "# GERADO pelo install.sh — não edite à mão (rode o instalador novamente)." > "$f"
  printf '%s\n' "services:" >> "$f"

  # ---- Postgres (só quando novo) ----
  if [ "$pg_mode" = new ]; then
    vols+=("pgdata")
    cat >> "$f" <<'YAML'
  postgres:
    image: postgres:16-alpine
    command: ["postgres", "-p", "__PGPORT__"]
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-wootrico}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-wootrico}
      POSTGRES_DB: ${POSTGRES_DB:-wootrico}
    volumes: [pgdata:/var/lib/postgresql/data]
    networks: [wtnet]
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -p __PGPORT__ -U ${POSTGRES_USER:-wootrico} -d ${POSTGRES_DB:-wootrico}']
      interval: 5s
      timeout: 5s
      retries: 12
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      placement: { constraints: [node.role == manager] }

YAML
  fi

  # ---- RabbitMQ (só quando novo) ----
  if [ "$rb_mode" = new ]; then
    vols+=("rabbitmq_data")
    cat >> "$f" <<'YAML'
  rabbitmq:
    image: rabbitmq:3-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-wootrico}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD:-wootrico}
      RABBITMQ_DEFAULT_VHOST: ${RABBITMQ_VHOST:-/}
      RABBITMQ_NODE_PORT: "__RBPORT__"
    volumes: [rabbitmq_data:/var/lib/rabbitmq]
    networks: [wtnet]
    healthcheck:
      test: ['CMD', 'rabbitmq-diagnostics', '-q', 'ping']
      interval: 10s
      timeout: 10s
      retries: 12
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      placement: { constraints: [node.role == manager] }
      # Hard ceiling for the broker. Without it RabbitMQ sizes its memory alarm
      # from the HOST's total RAM (40% of it), so on a VPS shared with Chatwoot
      # it can grow until the whole machine chokes — and a blocked broker is
      # exactly what stalls the webhook pipeline. With a cgroup limit set, the
      # alarm is computed from THIS value instead (default watermark 0.4, i.e.
      # ~410M for 1G), which trips long before the kernel would OOM-kill.
      # NOTE: do NOT add RABBITMQ_VM_MEMORY_HIGH_WATERMARK as an env var — it is
      # deprecated since RabbitMQ 3.9 and the image REFUSES TO BOOT with it set.
      # Tuning the ratio would require mounting a rabbitmq.conf; the container
      # limit alone is enough here.
      resources:
        limits:
          memory: ${RABBITMQ_MEMORY_LIMIT:-1G}

YAML
  fi

  # ---- Redis (só quando novo) — porta/senha computadas em bash ----
  if [ "$rd_mode" = new ]; then
    vols+=("redis_data")
    local rcmd rhc
    if [ -n "$rd_pass" ]; then
      rcmd="[\"redis-server\", \"--port\", \"${rd_port}\", \"--requirepass\", \"${rd_pass}\", \"--save\", \"60\", \"1\", \"--appendonly\", \"no\"]"
      rhc="[\"CMD\", \"redis-cli\", \"-p\", \"${rd_port}\", \"-a\", \"${rd_pass}\", \"ping\"]"
    else
      rcmd="[\"redis-server\", \"--port\", \"${rd_port}\", \"--save\", \"60\", \"1\", \"--appendonly\", \"no\"]"
      rhc="[\"CMD\", \"redis-cli\", \"-p\", \"${rd_port}\", \"ping\"]"
    fi
    cat >> "$f" <<EOF
  redis:
    image: redis:7-alpine
    command: ${rcmd}
    volumes: [redis_data:/data]
    networks: [wtnet]
    healthcheck:
      test: ${rhc}
      interval: 5s
      timeout: 5s
      retries: 12
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      placement: { constraints: [node.role == manager] }

EOF
  fi

  # ---- app + worker (sempre) ----
  cat >> "$f" <<'YAML'
  app:
    image: __IMAGE__
    env_file: .env
    command: >-
      sh -c "pnpm --filter @wootrico/db exec prisma migrate deploy &&
             node apps/panel-api/dist/server.cjs"
    networks: [wtnet]
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      labels:
        - traefik.enable=true
        - traefik.http.routers.wootrico.rule=Host(`${DOMAIN}`)
        - traefik.http.routers.wootrico.entrypoints=__ENTRYPOINT__
        - traefik.http.routers.wootrico.tls=true
        - traefik.http.routers.wootrico.tls.certresolver=__RESOLVER__
        - traefik.http.routers.wootrico.service=wootrico
        - traefik.http.services.wootrico.loadbalancer.server.port=3000
        - traefik.http.services.wootrico.loadbalancer.passHostHeader=true

  worker:
    image: __IMAGE__
    env_file: .env
    command: >-
      sh -c "pnpm --filter @wootrico/db exec prisma migrate deploy &&
             node apps/worker/dist/main.cjs"
    networks: [wtnet]
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
YAML

  # ---- Traefik próprio (só quando o Wootrico o instala) ----
  if [ "$tf" = 1 ]; then
    vols+=("traefik_letsencrypt")
    cat >> "$f" <<'YAML'

  traefik:
    image: traefik:v3
    command:
      - --providers.swarm=true
      - --providers.swarm.exposedByDefault=false
      - --providers.swarm.network=__NET__
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --certificatesresolvers.le.acme.email=${ACME_EMAIL}
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.le.acme.httpchallenge=true
      - --certificatesresolvers.le.acme.httpchallenge.entrypoint=web
    ports:
      - { target: 80, published: 80, mode: host }
      - { target: 443, published: 443, mode: host }
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_letsencrypt:/letsencrypt
    networks: [wtnet]
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      placement: { constraints: [node.role == manager] }
YAML
  fi

  # ---- networks (rede externa selecionada) + volumes (só os usados) ----
  cat >> "$f" <<'YAML'

networks:
  wtnet:
    external: true
    name: __NET__
YAML
  if [ "${#vols[@]}" -gt 0 ]; then
    printf '\nvolumes:\n' >> "$f"
    local v; for v in "${vols[@]}"; do printf '  %s:\n' "$v" >> "$f"; done
  fi

  # Substitui placeholders estruturais (imagem do Hub, rede e portas).
  sed -i "s|__IMAGE__|${IMAGE}|g; s|__NET__|${net}|g; s|__PGPORT__|${pg_port}|g; s|__RBPORT__|${rb_port}|g; s|__ENTRYPOINT__|${ep}|g; s|__RESOLVER__|${rs}|g" "$f"
  chmod 600 "$f"
  ok "Compose gerado em ${PWD}/${f} (imagem ${IMAGE}; rede ${net}; serviços novos: ${vols[*]:-nenhum})"
}

pull_image() {
  title "Imagem"
  # Sempre usa a tag :latest. O deploy é feito com --resolve-image always, então
  # o Swarm baixa a versão mais recente publicada no Hub a cada deploy.
  IMAGE="${IMAGE%@*}"   # descarta qualquer @sha256 herdado de .env antigo
  $SUDO docker pull "$IMAGE"
  ok "Imagem $IMAGE baixada"
  note "Imagem: $IMAGE"
}
deploy_stack() {
  title "Deploy (Swarm)"
  set -a; . "./$ENV_FILE"; set +a
  $SUDO docker stack deploy --resolve-image always -c docker-compose.yml "$STACK_NAME"
  ok "Stack '$STACK_NAME' implantada"
  note "Stack: $STACK_NAME (Swarm, rede ${NET_NAME:-$(genv WOOTRICO_NETWORK)})"
}
print_summary() {
  title "Resumo"
  for line in "${SUMMARY[@]:-}"; do [ -n "$line" ] && echo "  • $line"; done
  echo; echo -e "${C_B}Serviços:${C_0}"; $SUDO docker stack services "$STACK_NAME" 2>/dev/null || true

  echo; echo -e "${C_B}Configuração em uso:${C_0}"
  echo "  Rede:     $(genv WOOTRICO_NETWORK)"
  echo "  Traefik:  $([ "$(genv WOOTRICO_TRAEFIK)" = 1 ] && echo 'instalado pelo Wootrico' || echo 'externo/intocado')"
  echo "  Postgres: $(genv WOOTRICO_PG_MODE) → $(genv WOOTRICO_PG_HOST):$(genv WOOTRICO_PG_PORT)/$(genv POSTGRES_DB)"
  echo "  RabbitMQ: $(genv WOOTRICO_RB_MODE) → $(genv WOOTRICO_RB_HOST):$(genv WOOTRICO_RB_PORT)"
  echo "  Redis:    $(genv WOOTRICO_RD_MODE) → $(genv WOOTRICO_RD_HOST):$(genv WOOTRICO_RD_PORT)"

  local DOM; DOM="${DOMAIN:-$(grep -E '^DOMAIN=' "$ENV_FILE"|cut -d= -f2-)}"
  echo; echo -e "${C_B}Acesso:${C_0} https://${DOM}  (o setup wizard cria o admin no 1º acesso)"
  echo -e "${C_Y}DNS:${C_0} confirme um registro A de '${DOM}' apontando para $(public_ip) (sem isso o domínio não abre e o TLS falha)."
  echo -e "${C_C}Webhooks (gerados por integração no painel): https://${DOM}/webhook/<token>/provider e /chatwoot${C_0}"
  echo; echo -e "${C_B}${C_Y}Chaves/segredos (guarde em local seguro):${C_0}"
  grep -E '^(DOMAIN|POSTGRES_PASSWORD|RABBITMQ_PASSWORD|JWT_SECRET|APP_ENCRYPTION_KEY)=' "$ENV_FILE" | sed 's/^/  /'
  echo; echo -e "${C_C}Salvo em ${PWD}/${ENV_FILE} (chmod 600). Logs: docker service logs -f ${STACK_NAME}_app${C_0}"
}

# ───────────────────────────── UPDATE ─────────────────────────────
cmd_update() {
  need_root
  # Auto-atualização: baixa o install.sh mais novo, atualiza o comando `wootrico`
  # e re-executa a versão nova (uma única vez, via WOOTRICO_SELF_UPDATED).
  if [ "${WOOTRICO_SELF_UPDATED:-}" != "1" ]; then
    if self_update; then
      ok "Comando 'wootrico' atualizado para a versão mais nova"
      exec env WOOTRICO_SELF_UPDATED=1 "$CLI_PATH" update
    else
      warn "Não consegui baixar a versão nova do instalador — seguindo com a atual."
    fi
  fi
  enter_install_dir manage
  title "Atualizar"
  # Reaproveita as escolhas da instalação (rede/Traefik) e regenera o compose
  # apontando para a imagem mais recente do Docker Hub. Sem git.
  USE_TRAEFIK="$(genv WOOTRICO_TRAEFIK)"; USE_TRAEFIK="${USE_TRAEFIK:-1}"
  NET_NAME="$(genv WOOTRICO_NETWORK)"; NET_NAME="${NET_NAME:-${STACK_NAME}-net}"
  pull_image      # repega o :latest e refixa pelo digest mais novo
  write_compose
  deploy_stack
  ok "Atualizado."; $SUDO docker stack services "$STACK_NAME"
}

# ───────────────────────────── UNINSTALL ─────────────────────────────
cmd_uninstall() {
  need_root
  enter_install_dir manage
  title "Desinstalar"
  warn "Isto remove a stack '$STACK_NAME'."
  $SUDO docker stack rm "$STACK_NAME" 2>/dev/null || true
  if confirm "Remover TAMBÉM os volumes de dados (APAGA Postgres/RabbitMQ/Redis)?"; then
    info "aguardando a stack encerrar…"; sleep 8
    for v in pgdata rabbitmq_data redis_data traefik_letsencrypt; do
      $SUDO docker volume rm "${STACK_NAME}_$v" >/dev/null 2>&1 && ok "volume $v removido" || true
    done
  else info "Volumes preservados."; fi
  confirm "Remover a imagem $IMAGE?" && { $SUDO docker rmi "$IMAGE" >/dev/null 2>&1 || true; ok "imagem removida"; }
  ok "Concluído. (o arquivo .env foi preservado)"
}

# Comando padrão: o one-liner (curl | bash, sem argumento) INSTALA; o comando
# `wootrico` sem argumento mostra a AJUDA.
arg="${1:-}"
if [ -z "$arg" ]; then
  case "${BASH_SOURCE[0]:-}" in
    */wootrico) arg="--help" ;;
    *) arg="install" ;;
  esac
fi
case "$arg" in
  install) cmd_install ;;
  update) cmd_update ;;
  uninstall) cmd_uninstall ;;
  -h | --help | help) usage ;;
  *) err "Comando desconhecido: $arg"; echo; usage; exit 1 ;;
esac
