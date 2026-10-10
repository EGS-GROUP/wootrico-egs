import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhone, getCountryDialCode } from './phone.js';

test('getCountryDialCode returns correct dial codes', () => {
  assert.equal(getCountryDialCode('PE'), '51');
  assert.equal(getCountryDialCode('pe'), '51');
  assert.equal(getCountryDialCode('51'), '51');
  assert.equal(getCountryDialCode('+51'), '51');
  assert.equal(getCountryDialCode('BR'), '55');
  assert.equal(getCountryDialCode('AR'), '54');
  assert.equal(getCountryDialCode('CL'), '56');
  assert.equal(getCountryDialCode('CO'), '57');
  assert.equal(getCountryDialCode('MX'), '52');
  assert.equal(getCountryDialCode('US'), '1');
});

test('normalizePhone for Peru (PE)', () => {
  // WhatsApp JID already with 51
  assert.deepEqual(normalizePhone('51987654321@s.whatsapp.net', 'PE'), {
    digits: '51987654321',
    e164: '+51987654321',
  });

  // Full number digits
  assert.deepEqual(normalizePhone('51987654321', 'PE'), {
    digits: '51987654321',
    e164: '+51987654321',
  });

  // Number with leading '+'
  assert.deepEqual(normalizePhone('+51987654321', 'PE'), {
    digits: '51987654321',
    e164: '+51987654321',
  });

  // Local 9-digit mobile in Peru
  assert.deepEqual(normalizePhone('987654321', 'PE'), {
    digits: '51987654321',
    e164: '+51987654321',
  });

  // Local 8-digit landline in Peru
  assert.deepEqual(normalizePhone('12345678', 'PE'), {
    digits: '5112345678',
    e164: '+5112345678',
  });

  // Corrupted number previously saved with +55 prefix (55 + 51...)
  assert.deepEqual(normalizePhone('+5551987654321', 'PE'), {
    digits: '51987654321',
    e164: '+51987654321',
  });
  assert.deepEqual(normalizePhone('5551987654321', 'PE'), {
    digits: '51987654321',
    e164: '+51987654321',
  });

  // Foreign WhatsApp JID (Chile 56) incoming to Peru integration
  assert.deepEqual(normalizePhone('56912345678@s.whatsapp.net', 'PE'), {
    digits: '56912345678',
    e164: '+56912345678',
  });

  // Foreign number with '+'
  assert.deepEqual(normalizePhone('+56912345678', 'PE'), {
    digits: '56912345678',
    e164: '+56912345678',
  });
});

test('normalizePhone for Brazil (BR) preserves backward compatibility', () => {
  // Local 11-digit mobile with DDD
  assert.deepEqual(normalizePhone('11987654321', 'BR'), {
    digits: '5511987654321',
    e164: '+5511987654321',
  });

  // Full WhatsApp JID
  assert.deepEqual(normalizePhone('5511987654321@s.whatsapp.net', 'BR'), {
    digits: '5511987654321',
    e164: '+5511987654321',
  });

  // Full E.164
  assert.deepEqual(normalizePhone('+5511987654321', 'BR'), {
    digits: '5511987654321',
    e164: '+5511987654321',
  });
});
