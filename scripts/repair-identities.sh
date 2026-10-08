#!/usr/bin/env bash
# Diagnostica (e opcionalmente zera) o diretório GLOBAL de identidades.
#
# Um bug do parser da uazapi entregava ao resolveIdentity o LID do DONO DA CONTA
# pareado com o telefone do CONTATO em toda mensagem enviada pelo celular. O
# resolveIdentity lê isso como "mesma pessoa vista duas vezes" e funde as linhas
# — então cada contato respondido pelo celular foi absorvido numa única
# identidade. No Chatwoot isso aparece como conversas misturadas, nomes trocados
# e a foto do dono em vários contatos.
#
# A fusão é destrutiva: as linhas absorvidas não existem mais, não há como
# desfundir. O diretório é um CACHE reconstruído pelo tráfego, então o reparo é
# zerá-lo e deixar encher de novo com dados corretos.
#
# Roda TUDO por dentro do container do wootrico, que já tem DATABASE_URL e
# REDIS_URL apontando para os serviços certos — funciona igual com Postgres/Redis
# na stack ou externos (compartilhados com o Chatwoot, por exemplo).
#
# RODE NA VPS, DEPOIS de já ter atualizado a imagem (wootrico update).
#   bash repair-identities.sh            # só o relatório
#   bash repair-identities.sh --reset    # apaga o diretório + caches
set -euo pipefail

STACK="${WOOTRICO_STACK:-wootrico}"
RESET=0
[ "${1:-}" = "--reset" ] && RESET=1

# Qualquer task do app ou do worker serve: ambas rodam a mesma imagem e têm o
# mesmo env.
C="$(docker ps -q -f "name=${STACK}_app" -f "name=${STACK}_worker" | head -n1)"
[ -n "$C" ] || { echo "nenhum container ${STACK}_app/${STACK}_worker rodando"; exit 1; }
echo "usando container: $(docker inspect --format '{{.Name}}' "$C" | sed 's#^/##')"
echo

docker exec -i -e WOOTRICO_RESET="$RESET" "$C" node <<'JS'
const { PrismaClient } = require('/app/packages/db/node_modules/@prisma/client');
const Redis = require('/app/packages/cache/node_modules/ioredis');

const RESET = process.env.WOOTRICO_RESET === '1';
const prisma = new PrismaClient();

(async () => {
  const one = async (sql) => Number(Object.values((await prisma.$queryRawUnsafe(sql))[0])[0]);

  console.log('== diagnóstico ==');
  console.log('identidades..................... ' + await one('SELECT count(*) FROM contact_identities'));
  console.log('  pareadas (pn + lid)........... ' + await one('SELECT count(*) FROM contact_identities WHERE pn IS NOT NULL AND lid IS NOT NULL'));
  // Um LID é um id de roteamento de 15+ dígitos, não um número discável. Um LID
  // na coluna pn significa que um JID @lid foi lido como telefone.
  console.log('  LID gravado como telefone..... ' + await one("SELECT count(*) FROM contact_identities WHERE length(regexp_replace(coalesce(pn,''),'\D','','g')) > 15"));
  // A mesma foto de perfil em identidades distintas é a assinatura da fusão: a
  // foto do dono copiada para todo mundo que ele respondeu pelo celular.
  console.log('  fotos repetidas entre pessoas. ' + await one("SELECT count(*) FROM (SELECT 1 FROM contact_identities WHERE avatar_url IS NOT NULL GROUP BY split_part(avatar_url,'?',1) HAVING count(*) > 1) x"));

  if (!RESET) {
    console.log('\nsomente relatório — rode com --reset para limpar.');
    await prisma.$disconnect();
    return;
  }

  console.log('\n== reparo ==');
  // contact_avatars cai junto (ON DELETE CASCADE).
  const del = await prisma.$executeRawUnsafe('DELETE FROM contact_identities');
  console.log('identidades apagadas: ' + del);

  // O id do contato no Chatwoot, o nome e o avatar são memoizados por chave
  // canônica; essas chaves ficaram obsoletas. Só os dois prefixos do wootrico
  // são removidos — o Redis pode ser compartilhado com o Chatwoot.
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  let removed = 0;
  for (const pattern of ['cw:contact:*', 'cw:meta:*']) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      if (keys.length) removed += await redis.del(...keys);
    } while (cursor !== '0');
  }
  console.log('chaves de cache removidas: ' + removed);
  await redis.quit();
  await prisma.$disconnect();
  console.log('pronto.');
})().catch((err) => { console.error(err); process.exit(1); });
JS
