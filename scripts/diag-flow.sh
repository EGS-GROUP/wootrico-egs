#!/usr/bin/env bash
# Mostra o que ENTROU (webhooks recebidos) e o que SAIU (mensagens espelhadas no
# Chatwoot) numa janela de tempo. Serve para separar dois cenários que parecem
# iguais de fora:
#
#   - webhook não chega        -> nada em "webhooks recebidos" com source=provider
#     (a uazapi não está mandando o evento; tipicamente o webhook da instância não
#      está configurado para entregar mensagens fromMe)
#   - webhook chega e é espelhado -> aparece em ambos, e o problema é de ROTEAMENTO
#     (a mensagem foi para a conversa de outro contato)
#
#   bash diag-flow.sh        # última 1 hora
#   bash diag-flow.sh 6      # últimas 6 horas
set -euo pipefail

STACK="${WOOTRICO_STACK:-wootrico}"
HOURS="${1:-1}"

C="$(docker ps -q -f "name=${STACK}_app" -f "name=${STACK}_worker" | head -n1)"
[ -n "$C" ] || { echo "nenhum container ${STACK}_app/${STACK}_worker rodando"; exit 1; }
echo "usando container: $(docker inspect --format '{{.Name}}' "$C" | sed 's#^/##')"
echo "janela: últimas ${HOURS}h"
echo

docker exec -i -e DIAG_HOURS="$HOURS" "$C" node <<'JS'
const { PrismaClient } = require('/app/packages/db/node_modules/@prisma/client');
const prisma = new PrismaClient();
const H = Number(process.env.DIAG_HOURS || 1);

const table = (rows, cols) => {
  if (!rows.length) return console.log('  (nenhum registro)');
  for (const r of rows) console.log('  ' + cols.map((c) => String(r[c] ?? '-')).join(' | '));
};

(async () => {
  console.log('== webhooks recebidos (source | evento | aceito | motivo | qtd) ==');
  table(
    await prisma.$queryRawUnsafe(`
      SELECT source::text, coalesce(event_type,'-') AS event_type, accepted,
             coalesce(reason,'-') AS reason, count(*)::int AS qtd
      FROM webhook_events
      WHERE received_at > now() - interval '${H} hours'
      GROUP BY 1,2,3,4 ORDER BY qtd DESC`),
    ['source', 'event_type', 'accepted', 'reason', 'qtd'],
  );

  console.log('\n== mensagens espelhadas (direção | tipo | kind | grupo | qtd) ==');
  table(
    await prisma.$queryRawUnsafe(`
      SELECT direction::text, message_type::text, kind, is_group, count(*)::int AS qtd
      FROM message_logs
      WHERE created_at > now() - interval '${H} hours'
      GROUP BY 1,2,3,4 ORDER BY qtd DESC`),
    ['direction', 'message_type', 'kind', 'is_group', 'qtd'],
  );

  // TESTE RETROATIVO DA FUSÃO DE IDENTIDADES.
  //
  // `conversations` é agrupada por peer_key — o id canônico da identidade — e é
  // gravada ANTES do espelho no Chatwoot, então guarda o histórico completo,
  // inclusive o de antes da correção. Numa conversa 1-a-1 só existe UM remetente
  // possível: o contato. Se uma linha não-grupo acumulou VÁRIOS remetentes
  // distintos, pessoas diferentes foram escritas sob a mesma identidade — a
  // assinatura da fusão. Grupos têm vários remetentes por natureza e ficam fora.
  console.log('\n== conversas 1-a-1 com mais de um remetente (assinatura da fusão) ==');
  table(
    await prisma.$queryRawUnsafe(`
      SELECT coalesce(c.contact_name,'-') AS contato,
             coalesce(c.contact_number,'-') AS numero,
             count(DISTINCT m.sender)::int AS remetentes,
             count(m.id)::int AS mensagens
      FROM conversations c
      JOIN conversation_messages m ON m.conversation_id = c.id
      WHERE c.is_group = false AND m.sender IS NOT NULL
      GROUP BY c.id, c.contact_name, c.contact_number
      HAVING count(DISTINCT m.sender) > 1
      ORDER BY remetentes DESC LIMIT 15`),
    ['contato', 'numero', 'remetentes', 'mensagens'],
  );

  const [ident] = await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM contact_identities');
  const [convs] = await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM conversations');
  console.log(`\nidentidades no diretório: ${ident.n}`);
  console.log(`conversas no histórico:   ${convs.n}`);

  await prisma.$disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
JS
