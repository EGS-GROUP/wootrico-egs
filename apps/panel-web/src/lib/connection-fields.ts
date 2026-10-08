// Structured connection fields <-> URL helpers, shared by the setup wizard and
// the System > Connections editor. Keeping the parse/build here avoids drift
// between the two places that edit Postgres/RabbitMQ/Redis URLs.

const enc = (s: string) => encodeURIComponent(s);
const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export type PgFields = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  query: string;
};
export type RbFields = { host: string; port: string; user: string; password: string; vhost: string };
export type RdFields = { host: string; port: string; password: string };

export function parsePg(url: string): PgFields {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port || '5432',
      user: dec(u.username),
      password: dec(u.password),
      database: dec(u.pathname.replace(/^\//, '')),
      query: u.search || '?schema=public',
    };
  } catch {
    return { host: '', port: '5432', user: '', password: '', database: '', query: '?schema=public' };
  }
}
export function buildPg(f: PgFields): string {
  const q = f.query || '?schema=public';
  return `postgresql://${enc(f.user)}:${enc(f.password)}@${f.host}:${f.port}/${enc(f.database)}${q}`;
}

export function parseRb(url: string): RbFields {
  try {
    const u = new URL(url);
    const p = u.pathname;
    const vhost = p && p.length > 1 ? dec(p.slice(1)) : '/';
    return { host: u.hostname, port: u.port || '5672', user: dec(u.username), password: dec(u.password), vhost };
  } catch {
    return { host: '', port: '5672', user: '', password: '', vhost: '/' };
  }
}
export function buildRb(f: RbFields): string {
  // Aceita o vhost só pelo nome (sem barra): 'padrao' ou '/padrao' → vhost
  // 'padrao'. '/' (ou vazio) = vhost padrão, codificado como %2F.
  let vh = (f.vhost || '/').trim();
  if (vh !== '/') vh = vh.replace(/^\/+/, '') || '/';
  const path = `/${enc(vh)}`;
  return `amqp://${enc(f.user)}:${enc(f.password)}@${f.host}:${f.port}${path}`;
}

export function parseRd(url: string): RdFields {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port || '6379', password: dec(u.password) };
  } catch {
    return { host: '', port: '6379', password: '' };
  }
}
export function buildRd(f: RdFields): string {
  return f.password ? `redis://:${enc(f.password)}@${f.host}:${f.port}` : `redis://${f.host}:${f.port}`;
}
