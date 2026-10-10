import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEvolutionInbound } from './parse-inbound.js';

const ctxPE = { defaultCountry: 'PE', ignoreGroups: false };
const ctxBR = { defaultCountry: 'BR', ignoreGroups: false };

test('Evolution Go whatsmeow direct format (event: Message)', () => {
  const payload = {
    event: 'Message',
    data: {
      Info: {
        Chat: '51987654321@s.whatsapp.net',
        Sender: '51987654321@s.whatsapp.net',
        ID: '3EB0W123456789',
        IsFromMe: false,
        PushName: 'Juan Perez',
      },
      Message: {
        conversation: 'Hola desde Peru con whatsmeow',
      },
    },
  };

  const norm = parseEvolutionInbound(payload, ctxPE);
  assert.equal(norm.kind, 'message');
  assert.equal(norm.phone, '51987654321');
  assert.equal(norm.providerMessageId, '3EB0W123456789');
  assert.equal(norm.text, 'Hola desde Peru con whatsmeow');
  assert.equal(norm.senderName, 'Juan Perez');
  assert.equal(norm.fromMe, false);
  assert.equal(norm.isGroup, false);
});

test('Evolution API / Baileys format (event: messages.upsert)', () => {
  const payload = {
    event: 'messages.upsert',
    instance: 'evo-inst',
    data: {
      key: {
        remoteJid: '51987654321@s.whatsapp.net',
        fromMe: false,
        id: 'BAILEYS_ID_123',
      },
      pushName: 'Cliente Peru',
      message: {
        conversation: 'Hola desde Baileys',
      },
    },
  };

  const norm = parseEvolutionInbound(payload, ctxPE);
  assert.equal(norm.kind, 'message');
  assert.equal(norm.phone, '51987654321');
  assert.equal(norm.providerMessageId, 'BAILEYS_ID_123');
  assert.equal(norm.text, 'Hola desde Baileys');
  assert.equal(norm.senderName, 'Cliente Peru');
  assert.equal(norm.fromMe, false);
  assert.equal(norm.isGroup, false);
});

test('Evolution API array format (data: [{ key, message }])', () => {
  const payload = {
    event: 'messages.upsert',
    data: [
      {
        key: {
          remoteJid: '51987654321@s.whatsapp.net',
          fromMe: false,
          id: 'ARR_ID_456',
        },
        pushName: 'Array Contact',
        message: {
          extendedTextMessage: {
            text: 'Texto en extendedTextMessage',
          },
        },
      },
    ],
  };

  const norm = parseEvolutionInbound(payload, ctxPE);
  assert.equal(norm.kind, 'message');
  assert.equal(norm.phone, '51987654321');
  assert.equal(norm.providerMessageId, 'ARR_ID_456');
  assert.equal(norm.text, 'Texto en extendedTextMessage');
  assert.equal(norm.senderName, 'Array Contact');
});

test('Evolution non-message events are ignored', () => {
  const presence = { event: 'presence.update', data: { id: '51987654321@s.whatsapp.net' } };
  const norm1 = parseEvolutionInbound(presence, ctxPE);
  assert.equal(norm1.kind, 'ignored');

  const conn = { event: 'connection.update', data: { state: 'open' } };
  const norm2 = parseEvolutionInbound(conn, ctxPE);
  assert.equal(norm2.kind, 'ignored');
});

test('Evolution group message handling', () => {
  const payload = {
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '1203630123456789@g.us',
        participant: '51987654321@s.whatsapp.net',
        fromMe: false,
        id: 'GRP_MSG_1',
      },
      pushName: 'Miembro Grupo',
      message: {
        conversation: 'Hola a todos en el grupo',
      },
    },
  };

  const norm = parseEvolutionInbound(payload, ctxPE);
  assert.equal(norm.kind, 'message');
  assert.equal(norm.isGroup, true);
  assert.equal(norm.groupId, '1203630123456789@g.us');
  assert.equal(norm.phone, '51987654321');
  assert.equal(norm.senderName, 'Miembro Grupo');
  assert.equal(norm.text, 'Hola a todos en el grupo');
});

test('Evolution delete/revoke message handling', () => {
  const payload = {
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '51987654321@s.whatsapp.net',
        fromMe: false,
        id: 'REVOKE_KEY',
      },
      message: {
        protocolMessage: {
          type: 'REVOKE',
          key: { id: 'TARGET_TO_DELETE' },
        },
      },
    },
  };

  const norm = parseEvolutionInbound(payload, ctxPE);
  assert.equal(norm.kind, 'message_deleted');
  assert.deepEqual(norm.deletedProviderMessageIds, ['TARGET_TO_DELETE']);
});
