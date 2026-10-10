/** Phone normalization to E.164. Supports international country codes with per-country specifics. */

export const COUNTRY_DIAL: Record<string, string> = {
  // Latin America & Caribbean
  PE: '51', // Peru
  BR: '55', // Brazil
  AR: '54', // Argentina
  CL: '56', // Chile
  CO: '57', // Colombia
  MX: '52', // Mexico
  EC: '593', // Ecuador
  BO: '591', // Bolivia
  PY: '595', // Paraguay
  UY: '598', // Uruguay
  VE: '58', // Venezuela
  PA: '507', // Panama
  CR: '506', // Costa Rica
  GT: '502', // Guatemala
  SV: '503', // El Salvador
  HN: '504', // Honduras
  NI: '505', // Nicaragua
  DO: '1809', // Dominican Republic (also 1829, 1849)
  CU: '53', // Cuba
  PR: '1', // Puerto Rico
  JM: '1876', // Jamaica
  HT: '509', // Haiti
  TT: '1868', // Trinidad & Tobago
  BZ: '501', // Belize
  GY: '592', // Guyana
  SR: '597', // Suriname

  // North America
  US: '1', // United States
  CA: '1', // Canada

  // Europe
  ES: '34', // Spain
  PT: '351', // Portugal
  FR: '33', // France
  IT: '39', // Italy
  DE: '49', // Germany
  GB: '44', // United Kingdom
  UK: '44', // UK alias
  IE: '353', // Ireland
  NL: '31', // Netherlands
  BE: '32', // Belgium
  CH: '41', // Switzerland
  AT: '43', // Austria
  SE: '46', // Sweden
  NO: '47', // Norway
  DK: '45', // Denmark
  FI: '358', // Finland
  PL: '48', // Poland
  UA: '380', // Ukraine
  RO: '40', // Romania
  CZ: '420', // Czech Republic
  GR: '30', // Greece
  HU: '36', // Hungary
  RU: '7', // Russia
  TR: '90', // Turkey

  // Asia & Middle East
  CN: '86', // China
  JP: '81', // Japan
  KR: '82', // South Korea
  IN: '91', // India
  ID: '62', // Indonesia
  PH: '63', // Philippines
  VN: '84', // Vietnam
  TH: '66', // Thailand
  MY: '60', // Malaysia
  SG: '65', // Singapore
  PK: '92', // Pakistan
  BD: '880', // Bangladesh
  AE: '971', // UAE
  SA: '966', // Saudi Arabia
  IL: '972', // Israel
  QA: '974', // Qatar
  KW: '965', // Kuwait

  // Africa & Oceania
  ZA: '27', // South Africa
  EG: '20', // Egypt
  NG: '234', // Nigeria
  KE: '254', // Kenya
  MA: '212', // Morocco
  AU: '61', // Australia
  NZ: '64', // New Zealand
};

export function getCountryDialCode(defaultCountry = 'BR'): string {
  const trimmed = (defaultCountry ?? '').trim();
  const numeric = trimmed.replace(/^\+/, '');
  if (/^\d{1,4}$/.test(numeric)) {
    return numeric;
  }
  return COUNTRY_DIAL[trimmed.toUpperCase()] ?? '55';
}

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
  const trimmed = (raw ?? '').trim();
  const hadPlus = trimmed.startsWith('+');
  const isWhatsAppJid = trimmed.includes('@s.whatsapp.net') || trimmed.includes('@c.us');
  const cleaned = trimmed.split('@')[0] ?? trimmed;
  let digits = cleaned.replace(/\D/g, '').replace(/^0+/, '');
  const dial = getCountryDialCode(defaultCountry);

  // If defaultCountry is not Brazil, and the number starts with '55' followed by the target country's dial code
  // (e.g. '5551987654321' for PE with dial '51'), strip the erroneous '55' prefix caused by the earlier bug.
  if (dial !== '55' && digits.startsWith(`55${dial}`)) {
    digits = digits.slice(2);
  }

  // Prepend dial code if missing:
  // - If it already starts with the country dial code, it's complete.
  // - If it explicitly came with a '+' or from a WhatsApp JID with valid length, it's already an international number.
  // - Otherwise, if it has local number length, prepend the dial code.
  if (!digits.startsWith(dial)) {
    if (!hadPlus && !isWhatsAppJid) {
      // Local numbers without country code:
      // In Brazil (55): 10 or 11 digits (e.g. 11987654321).
      // In Peru (51): 8 or 9 digits (mobile is 9 digits, e.g. 987654321).
      // General: local numbers without country code are typically <= 10 digits (Brazil is 11).
      const maxLocalLen = dial === '55' ? 11 : dial === '51' ? 9 : 10;
      if (digits.length <= maxLocalLen) {
        digits = dial + digits;
      }
    }
  }

  return { digits, e164: `+${digits}` };
}

const E164 = /^\+[1-9]\d{1,14}$/;
export function isE164(value: string): boolean {
  return E164.test(value);
}
