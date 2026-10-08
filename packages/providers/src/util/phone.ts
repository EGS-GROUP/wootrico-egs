/** Phone normalization to E.164. Pragmatic; handles BR specifics. */

const COUNTRY_DIAL: Record<string, string> = {
  BR: '55',
  US: '1',
  PT: '351',
  AR: '54',
};

export interface NormalizedPhone {
  /** digits only, with country code, no '+' (used by providers) */
  digits: string;
  /** E.164 with leading '+' (used by Chatwoot phone_number) */
  e164: string;
}

/**
 * Normalize a raw WhatsApp number/jid into digits + E.164.
 * Strips suffixes like @s.whatsapp.net / @c.us / @lid before processing.
 */
export function normalizePhone(raw: string, defaultCountry = 'BR'): NormalizedPhone {
  const cleaned = raw.split('@')[0] ?? raw;
  let digits = cleaned.replace(/\D/g, '').replace(/^0+/, '');
  const dial = COUNTRY_DIAL[defaultCountry.toUpperCase()] ?? '55';

  // If it doesn't already start with the country dial code and looks like a
  // local number, prepend it.
  if (!digits.startsWith(dial) && digits.length <= 11) {
    digits = dial + digits;
  }

  return { digits, e164: `+${digits}` };
}

const E164 = /^\+[1-9]\d{1,14}$/;
export function isE164(value: string): boolean {
  return E164.test(value);
}
