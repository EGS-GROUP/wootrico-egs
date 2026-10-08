function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export const cfg = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  adminToken: required('ADMIN_TOKEN'),
  // Free-trial lifetime in days. Granted ONCE per instance — after it elapses
  // the key is inactive and the customer must buy a definitive license (no free
  // renewal).
  trialDays: Number(process.env.LICENSE_TRIAL_DAYS ?? 14),
  // Paid keys are time-limited (default 1 year). A paid purchase/renewal grants
  // this many days; the admin can override the date per key (always a date —
  // there are no lifetime keys).
  paidDays: Number(process.env.LICENSE_PAID_DAYS ?? 365),
  // Checkout URL the customer is sent to when buying (Hotmart). The server
  // appends `?sck=<intentId>` so the payment maps back even if the buyer's
  // Hotmart e-mail differs from the registered one.
  checkoutUrl: process.env.LICENSE_CHECKOUT_URL ?? 'https://pay.hotmart.com/F106461744G',
  // Hotmart Postback (webhook) token — set in the license-server .env. Without
  // it the Hotmart webhook rejects every call.
  hotmartHottok: process.env.HOTMART_HOTTOK,
  // Optional: only accept Hotmart events for this product id (extra safety).
  hotmartProductId: process.env.HOTMART_PRODUCT_ID,
  // Support WhatsApp number (digits with country code) delivered to all clients.
  supportWhatsapp: process.env.LICENSE_SUPPORT_WHATSAPP,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Admin web panel credentials (optional). When set, /admin/login issues a JWT;
  // when unset, the panel login is disabled and only ADMIN_TOKEN (Bearer) works.
  adminEmail: process.env.LICENSE_ADMIN_EMAIL,
  adminPassword: process.env.LICENSE_ADMIN_PASSWORD,
  adminJwtSecret: process.env.LICENSE_ADMIN_JWT_SECRET ?? required('ADMIN_TOKEN'),
  // Google OAuth (optional) — when both are set, the license server brokers
  // "Sign in with Google" for customer instances (single redirect URI on this
  // server's domain). Customers never configure Google themselves.
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
};
