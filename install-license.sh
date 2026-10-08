#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Wootrico — instalador do SERVIDOR DE LICENÇA (fornecedor) para VPS (Docker Swarm).
#   sudo bash install-license.sh            # instalar (Swarm; Traefik/TLS opcional)
#   sudo bash install-license.sh update     # repull da imagem + regenera compose + redeploy
#   sudo bash install-license.sh uninstall  # remover a stack (e opcionalmente volumes)
#
# VENDOR-ONLY: hospede isto SEPARADO dos clientes, num subdomínio próprio
# (ex.: license.suaempresa.com). Sobe a imagem `runtime-license` publicada no Hub,
# NÃO clona o repositório. Detecta SO/Docker/Swarm, pergunta a rede overlay, o
# subdomínio e reaproveita um Postgres existente (ou sobe um embarcado). Valida
# pagamentos via webhook e serve o painel admin na própria porta 4000.
# Idempotente: re-executar NÃO sobrescreve valores já existentes no .env.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

STACK_NAME="wootrico-license"
IMAGE="${WOOTRICO_LICENSE_IMAGE:-ericoautomacao/wootrico-license:latest}"
ENV_FILE=".env.license"

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
ask_pass() { local p="$1" a; read -rsp "$(echo -e "${C_C}?${C_0} ${p}: ")" a </dev/tty || true; printf '\n' >&2; printf '%s' "$a"; }
confirm() {
  local ans; read -rp "$(echo -e "${C_C}?${C_0} $1 [Y/n]: ")" ans </dev/tty || true
  case "${ans:-Y}" in [Nn]*) return 1 ;; *) return 0 ;; esac
}
need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else err "Rode como root ou instale sudo."; exit 1; fi
  fi
}
genv() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
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
host_gw() { hostname -I 2>/dev/null | awk '{print $1}'; }
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1 && { exec 3>&- 3<&-; return 0; }; return 1; }
containers_for() { $SUDO docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -iE "$1" | awk '{print $1}'; }
svc_detected() { [ -n "$(containers_for "$1")" ] && return 0; port_open "$2"; }
public_ip() {
  local ip
  ip="$(curl -s --max-time 4 https://api.ipify.org 2>/dev/null)"
  [ -z "$ip" ] && ip="$(curl -s --max-time 4 https://ifconfig.me 2>/dev/null)"
  [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "$ip"
}
svc_alias_on_net() { # $1 img-regex
  local c nets raw
  for c in $(containers_for "$1"); do
    nets="$($SUDO docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$c" 2>/dev/null)"
    case " $nets " in *" ${NET_NAME} "*) ;; *) continue ;; esac
    raw="$($SUDO docker inspect -f '{{ index .Config.Labels "com.docker.swarm.service.name" }}' "$c" 2>/dev/null)"
    [ -z "$raw" ] && raw="${c%%.*}"
    printf '%s' "${raw#*_}"
    return 0
  done
  return 1
}

# ───────────────────────────── INSTALL ─────────────────────────────
cmd_install() {
  title "Sistema operacional"
  [ "$(uname -s)" = "Linux" ] || { err "Este instalador é para Linux (VPS)."; exit 1; }
  need_root
  local OS_ID="desconhecido" PKG=""
  [ -f /etc/os-release ] && . /etc/os-release && OS_ID="${ID:-desconhecido}"
  case "$OS_ID" in
    ubuntu|debian|raspbian|linuxmint|pop) PKG="apt" ;;
    centos|rhel|rocky|almalinux|fedora|amzn) command -v dnf >/dev/null 2>&1 && PKG="dnf" || PKG="yum" ;;
    *) warn "Distro '$OS_ID' não reconhecida; tentarei seguir." ;;
  esac
  ok "Detectado: ${PRETTY_NAME:-$OS_ID} (gerenciador: ${PKG:-n/d})"; note "SO: ${PRETTY_NAME:-$OS_ID}"

  pkg_update_done=0
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
  pkg_install curl; pkg_install openssl

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

  decide_network
  decide_traefik
  decide_infra
  configure_env
  pull_image
  write_compose
  deploy_stack
  print_summary
}

# ───────────────────────────── rede ─────────────────────────────
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
    ok "Usando a rede existente '${NET_NAME}'."; note "Rede: ${NET_NAME} (existente)"
  else
    NET_NAME="${STACK_NAME}-net"
    info "Nenhuma rede overlay encontrada — vou criar uma dedicada: '${NET_NAME}'."
    $SUDO docker network create --driver overlay --attachable "$NET_NAME" >/dev/null \
      && ok "Rede '${NET_NAME}' criada." || { err "Falha ao criar a rede."; exit 1; }
    note "Rede: ${NET_NAME} (criada)"
  fi
}

# ───────────────────────────── Traefik ─────────────────────────────
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
    if detect_traefik_config; then
      ok "Config do Traefik detectada: entrypoint='${TRAEFIK_ENTRYPOINT}', certresolver='${TRAEFIK_RESOLVER}'."
    else
      warn "Não consegui ler toda a config do Traefik; usando: entrypoint='${TRAEFIK_ENTRYPOINT}', certresolver='${TRAEFIK_RESOLVER}'."
    fi
    warn "Seu Traefik precisa usar o provider Swarm e observar a rede '${NET_NAME:-<rede>}' (o servidor expõe labels na porta 4000)."
    note "Traefik: existente (intocado); entrypoint=${TRAEFIK_ENTRYPOINT} resolver=${TRAEFIK_RESOLVER}"
  elif confirm "Traefik não detectado. Instalar o Traefik (com TLS Let's Encrypt)?"; then
    USE_TRAEFIK=1; TRAEFIK_ENTRYPOINT="websecure"; TRAEFIK_RESOLVER="le"
    note "Traefik: será instalado pelo Wootrico"
  else
    USE_TRAEFIK=0
    warn "Sem Traefik: publique o serviço 'license-server' (porta 4000) no subdomínio com seu próprio proxy."
    note "Traefik: não instalado (proxy externo)"
  fi
}

# ───────────────────────────── infra (só Postgres) ─────────────────────────────
decide_infra() {
  title "Banco (Postgres) — o servidor de licença só precisa de um banco"
  local gw; gw="$(host_gw)"
  PG_USER="$(genv POSTGRES_USER)"; PG_USER="${PG_USER:-license}"
  PG_DB="$(genv POSTGRES_DB)";     PG_DB="${PG_DB:-license}"
  PG_PASS="$(genv POSTGRES_PASSWORD)"

  local __MODE=new __DEFHOST=""
  if svc_detected 'postgres|postgis' 5432; then
    local alias; alias="$(svc_alias_on_net 'postgres|postgis')"; [ -z "$alias" ] && alias="${gw:-127.0.0.1}"
    echo
    warn "Postgres já existe neste ambiente (host sugerido: ${alias})."
    if confirm "Reaproveitar o Postgres existente? ('n' = subir um novo, dedicado ao servidor de licença)"; then
      __MODE=existing; __DEFHOST="$alias"
    fi
  else
    info "Postgres não encontrado — vou subir um embarcado dedicado."
  fi

  PG_MODE="$__MODE"
  if [ "$PG_MODE" = existing ]; then
    info "Crie um banco separado para as licenças (não compartilhe com o do cliente)."
    PG_HOST="$(ask "Host do Postgres (nome do serviço na rede / IP)" "${__DEFHOST:-${gw:-127.0.0.1}}")"
    PG_PORT="$(ask "Porta do Postgres" "5432")"
    PG_USER="$(ask "Usuário do Postgres" "$PG_USER")"
    local pp; pp="$(ask_pass "Senha do Postgres")"; [ -n "$pp" ] && PG_PASS="$pp"
    PG_DB="$(ask "Banco das licenças (crie-o antes, se não existir)" "$PG_DB")"
  else
    PG_HOST="license-postgres"
    PG_PORT="$(svc_detected 'postgres|postgis' 5432 && echo 5442 || echo 5432)"
    [ -z "$PG_PASS" ] && { PG_PASS="$(openssl rand -hex 16)"; note "Postgres: senha gerada automaticamente"; }
  fi
  ok "Postgres: ${PG_MODE} → ${PG_HOST}:${PG_PORT}/${PG_DB}"; note "Postgres: ${PG_MODE} (${PG_HOST}:${PG_PORT}/${PG_DB})"
}

# ───────────────────────────── .env ─────────────────────────────
configure_env() {
  title "Configuração (${ENV_FILE})"
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
  set_env() { local k="$1" v="$2" tmp; if grep -qE "^$k=" "$ENV_FILE"; then tmp="$(mktemp)"; grep -vE "^$k=" "$ENV_FILE" > "$tmp"; mv "$tmp" "$ENV_FILE"; fi; printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"; }
  keep_or() { local cur; cur="$(get_env "$1")"; [ -n "$cur" ] && echo "$cur" || echo "$2"; }
  gen() { openssl rand -base64 "$1" | tr -d '\n='; }

  echo
  info "Informe o SUBDOMÍNIO onde o servidor de licença vai responder — é o endereço"
  info "do PAINEL admin e do WEBHOOK de pagamento. Ex.: license.suaempresa.com"
  while :; do
    DOMAIN="$(ask "Subdomínio do servidor de licença" "$(get_env DOMAIN)")"
    [ -n "$DOMAIN" ] && break
    warn "Informe um subdomínio."
  done
  info "Aponte um registro A de '${DOMAIN}' para o IP deste servidor para o TLS emitir o certificado."

  if [ "${USE_TRAEFIK:-1}" = 1 ]; then
    ACME_EMAIL="$(ask "E-mail para o certificado TLS (Let's Encrypt)" "$(keep_or ACME_EMAIL "admin@${DOMAIN}")")"
  else
    ACME_EMAIL="$(get_env ACME_EMAIL)"
  fi

  # Login do painel admin (obrigatório para usar o painel).
  echo
  info "Credenciais do PAINEL admin (login em https://${DOMAIN}/)."
  LIC_ADMIN_EMAIL="$(ask "E-mail do admin do painel" "$(keep_or LICENSE_ADMIN_EMAIL "admin@${DOMAIN}")")"
  LIC_ADMIN_PASS="$(get_env LICENSE_ADMIN_PASSWORD)"
  if [ -z "$LIC_ADMIN_PASS" ]; then
    local p1; p1="$(ask_pass "Senha do admin do painel (enter = gerar aleatória)")"
    if [ -n "$p1" ]; then LIC_ADMIN_PASS="$p1"; else LIC_ADMIN_PASS="$(gen 18)"; note "Senha do painel: gerada automaticamente (veja o resumo)"; fi
  fi

  # Validade da licença inicial (antes de expirar e exigir renovação/compra).
  TRIAL_DAYS="$(ask "Dias de validade da licença inicial" "$(keep_or LICENSE_TRIAL_DAYS 14)")"

  # Login com Google (opcional). Crie um OAuth 2.0 Client (Web) no Google Cloud
  # com redirect URI https://${DOMAIN}/auth/google/callback. Enter em branco pula.
  echo
  info "Login com Google (opcional). Redirect URI a cadastrar no Google Cloud:"
  info "  https://${DOMAIN}/auth/google/callback"
  GOOGLE_ID="$(ask "GOOGLE_CLIENT_ID (enter = pular)" "$(get_env GOOGLE_CLIENT_ID)")"
  GOOGLE_SECRET="$(get_env GOOGLE_CLIENT_SECRET)"
  if [ -n "$GOOGLE_ID" ] && [ -z "$GOOGLE_SECRET" ]; then
    GOOGLE_SECRET="$(ask_pass "GOOGLE_CLIENT_SECRET")"
  fi

  # Segredos automáticos (preserva existentes).
  ADMIN_TOKEN="$(get_env ADMIN_TOKEN)"; [ -z "$ADMIN_TOKEN" ] && { ADMIN_TOKEN="$(gen 36)"; note "ADMIN_TOKEN: gerado automaticamente"; }
  ADMIN_JWT="$(get_env LICENSE_ADMIN_JWT_SECRET)"; [ -z "$ADMIN_JWT" ] && ADMIN_JWT="$(gen 36)"

  set_env DOMAIN "$DOMAIN"; set_env ACME_EMAIL "$ACME_EMAIL"
  set_env WOOTRICO_TRAEFIK "${USE_TRAEFIK:-1}"
  set_env WOOTRICO_TRAEFIK_ENTRYPOINT "${TRAEFIK_ENTRYPOINT:-websecure}"
  set_env WOOTRICO_TRAEFIK_RESOLVER "${TRAEFIK_RESOLVER:-le}"
  set_env WOOTRICO_NETWORK "${NET_NAME:-${STACK_NAME}-net}"

  set_env POSTGRES_USER "$PG_USER"; set_env POSTGRES_PASSWORD "$PG_PASS"; set_env POSTGRES_DB "$PG_DB"
  # O Prisma do servidor de licença usa LICENSE_DATABASE_URL.
  set_env LICENSE_DATABASE_URL "postgresql://$(urlenc "$PG_USER"):$(urlenc "$PG_PASS")@${PG_HOST}:${PG_PORT}/${PG_DB}?schema=public"
  set_env WOOTRICO_PG_MODE "$PG_MODE"; set_env WOOTRICO_PG_HOST "$PG_HOST"; set_env WOOTRICO_PG_PORT "$PG_PORT"

  set_env ADMIN_TOKEN "$ADMIN_TOKEN"
  set_env LICENSE_ADMIN_EMAIL "$LIC_ADMIN_EMAIL"
  set_env LICENSE_ADMIN_PASSWORD "$LIC_ADMIN_PASS"
  set_env LICENSE_ADMIN_JWT_SECRET "$ADMIN_JWT"
  set_env LICENSE_TRIAL_DAYS "$TRIAL_DAYS"
  set_env GOOGLE_CLIENT_ID "$GOOGLE_ID"
  set_env GOOGLE_CLIENT_SECRET "$GOOGLE_SECRET"
  set_env NODE_ENV "$(keep_or NODE_ENV production)"
  set_env PORT "$(keep_or PORT 4000)"; set_env HOST "$(keep_or HOST 0.0.0.0)"
  chmod 600 "$ENV_FILE"; ok "${ENV_FILE} atualizado (preservando valores existentes)"
}

# ───────────────────────────── compose ─────────────────────────────
write_compose() {
  local pg_mode="${PG_MODE:-$(genv WOOTRICO_PG_MODE)}"; pg_mode="${pg_mode:-new}"
  local pg_port="${PG_PORT:-$(genv WOOTRICO_PG_PORT)}"; pg_port="${pg_port:-5432}"
  local tf="${USE_TRAEFIK:-${WOOTRICO_TRAEFIK:-1}}"
  local net="${NET_NAME:-$(genv WOOTRICO_NETWORK)}"; net="${net:-${STACK_NAME}-net}"
  local ep="${TRAEFIK_ENTRYPOINT:-$(genv WOOTRICO_TRAEFIK_ENTRYPOINT)}"; ep="${ep:-websecure}"
  local rs="${TRAEFIK_RESOLVER:-$(genv WOOTRICO_TRAEFIK_RESOLVER)}"; rs="${rs:-le}"
  title "Gerando compose (rede: ${net}; traefik: ${tf}; postgres: ${pg_mode})"
  local f="docker-compose.license.generated.yml"
  local vols=()

  printf '%s\n' "# GERADO pelo install-license.sh — não edite à mão (rode o instalador novamente)." > "$f"
  printf '%s\n' "services:" >> "$f"

  if [ "$pg_mode" = new ]; then
    vols+=("license_pgdata")
    cat >> "$f" <<'YAML'
  license-postgres:
    image: postgres:16-alpine
    command: ["postgres", "-p", "__PGPORT__"]
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-license}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-license}
      POSTGRES_DB: ${POSTGRES_DB:-license}
    volumes: [license_pgdata:/var/lib/postgresql/data]
    networks: [wlnet]
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -p __PGPORT__ -U ${POSTGRES_USER:-license} -d ${POSTGRES_DB:-license}']
      interval: 5s
      timeout: 5s
      retries: 12
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      placement: { constraints: [node.role == manager] }

YAML
  fi

  cat >> "$f" <<'YAML'
  license-server:
    image: __IMAGE__
    env_file: __ENVFILE__
    command: >-
      sh -c "pnpm --filter @wootrico/license-server exec prisma migrate deploy &&
             node apps/license-server/dist/server.cjs"
    networks: [wlnet]
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      labels:
        - traefik.enable=true
        - traefik.http.routers.wootrico-license.rule=Host(`${DOMAIN}`)
        - traefik.http.routers.wootrico-license.entrypoints=__ENTRYPOINT__
        - traefik.http.routers.wootrico-license.tls=true
        - traefik.http.routers.wootrico-license.tls.certresolver=__RESOLVER__
        - traefik.http.routers.wootrico-license.service=wootrico-license
        - traefik.http.services.wootrico-license.loadbalancer.server.port=4000
        - traefik.http.services.wootrico-license.loadbalancer.passHostHeader=true
YAML

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
    networks: [wlnet]
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      placement: { constraints: [node.role == manager] }
YAML
  fi

  cat >> "$f" <<'YAML'

networks:
  wlnet:
    external: true
    name: __NET__
YAML
  if [ "${#vols[@]}" -gt 0 ]; then
    printf '\nvolumes:\n' >> "$f"
    local v; for v in "${vols[@]}"; do printf '  %s:\n' "$v" >> "$f"; done
  fi

  sed -i "s|__IMAGE__|${IMAGE}|g; s|__NET__|${net}|g; s|__PGPORT__|${pg_port}|g; s|__ENTRYPOINT__|${ep}|g; s|__RESOLVER__|${rs}|g; s|__ENVFILE__|${ENV_FILE}|g" "$f"
  chmod 600 "$f"
  COMPOSE_FILE="$f"
  ok "Compose gerado em ${PWD}/${f}"
}

pull_image() {
  title "Imagem"
  IMAGE="${IMAGE%@*}"
  $SUDO docker pull "$IMAGE"
  ok "Imagem $IMAGE baixada"; note "Imagem: $IMAGE"
}
deploy_stack() {
  title "Deploy (Swarm)"
  set -a; . "./$ENV_FILE"; set +a
  $SUDO docker stack deploy --resolve-image always -c "$COMPOSE_FILE" "$STACK_NAME"
  ok "Stack '$STACK_NAME' implantada"; note "Stack: $STACK_NAME (rede ${NET_NAME:-$(genv WOOTRICO_NETWORK)})"
}
print_summary() {
  title "Resumo"
  for line in "${SUMMARY[@]:-}"; do [ -n "$line" ] && echo "  • $line"; done
  echo; echo -e "${C_B}Serviços:${C_0}"; $SUDO docker stack services "$STACK_NAME" 2>/dev/null || true

  local DOM; DOM="${DOMAIN:-$(genv DOMAIN)}"
  echo; echo -e "${C_B}Painel admin:${C_0} https://${DOM}/  (login: $(genv LICENSE_ADMIN_EMAIL))"
  echo -e "${C_B}Webhook de pagamento:${C_0} https://${DOM}/webhook/payment  (Bearer WHK-… criada no painel → aba Webhooks)"
  echo -e "${C_Y}DNS:${C_0} confirme um registro A de '${DOM}' apontando para $(public_ip) (sem isso o domínio não abre e o TLS falha)."
  echo; echo -e "${C_B}${C_Y}Chaves/segredos (guarde em local seguro):${C_0}"
  grep -E '^(DOMAIN|LICENSE_ADMIN_EMAIL|LICENSE_ADMIN_PASSWORD|ADMIN_TOKEN|POSTGRES_PASSWORD)=' "$ENV_FILE" | sed 's/^/  /'
  echo; echo -e "${C_C}Salvo em ${PWD}/${ENV_FILE} (chmod 600). Logs: docker service logs -f ${STACK_NAME}_license-server${C_0}"
  echo -e "${C_C}Nos clientes, aponte LICENSE_SERVER_URL=https://${DOM}${C_0}"
}

# ───────────────────────────── UPDATE ─────────────────────────────
cmd_update() {
  need_root
  [ -f "$ENV_FILE" ] || { err "${ENV_FILE} não encontrado — rode a instalação primeiro." ; exit 1; }
  title "Atualizar"
  USE_TRAEFIK="$(genv WOOTRICO_TRAEFIK)"; USE_TRAEFIK="${USE_TRAEFIK:-1}"
  NET_NAME="$(genv WOOTRICO_NETWORK)"; NET_NAME="${NET_NAME:-${STACK_NAME}-net}"
  pull_image
  write_compose
  deploy_stack
  ok "Atualizado."; $SUDO docker stack services "$STACK_NAME"
}

# ───────────────────────────── UNINSTALL ─────────────────────────────
cmd_uninstall() {
  need_root
  title "Desinstalar"
  warn "Isto remove a stack '$STACK_NAME'."
  $SUDO docker stack rm "$STACK_NAME" 2>/dev/null || true
  if confirm "Remover TAMBÉM o volume de dados (APAGA o banco de licenças)?"; then
    info "aguardando a stack encerrar…"; sleep 8
    for v in license_pgdata traefik_letsencrypt; do
      $SUDO docker volume rm "${STACK_NAME}_$v" >/dev/null 2>&1 && ok "volume $v removido" || true
    done
  else info "Volumes preservados (o banco de licenças foi mantido)."; fi
  confirm "Remover a imagem $IMAGE?" && { $SUDO docker rmi "$IMAGE" >/dev/null 2>&1 || true; ok "imagem removida"; }
  ok "Concluído. (o arquivo ${ENV_FILE} foi preservado)"
}

case "${1:-install}" in
  install) cmd_install ;;
  update) cmd_update ;;
  uninstall) cmd_uninstall ;;
  *) echo "uso: install-license.sh [install|update|uninstall]"; exit 1 ;;
esac
