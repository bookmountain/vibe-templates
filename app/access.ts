import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const publicHost = process.env.VIBE_PUBLIC_HOST || '';
const accessFile = process.env.VIBE_ACCESS_FILE;
if (publicHost && !accessFile) throw new Error('Hosted galleries require an access file');

function basic(user: string, password: string): string {
  return 'Basic ' + Buffer.from(user + ':' + password).toString('base64');
}
const access = publicHost && accessFile ? basic('book', readFileSync(accessFile, 'utf8').trim()) : '';

export function send(res: ServerResponse, status: number, type: string, body: string | Buffer, location?: string | null) {
  res.setHeader('Cache-Control', publicHost ? 'private, no-store' : 'no-cache');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (location) res.setHeader('Location', location);
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

function signInPage(res: ServerResponse, invalid = false) {
  let page = readFileSync(new URL('./signin.html', import.meta.url), 'utf8');
  if (invalid) page = page.replace('<!--error-->', '<p class="error" role="alert">Check your gallery password and try again.</p>');
  send(res, invalid ? 401 : 200, 'text/html; charset=utf-8', page);
}

function signature(expiry: string): string {
  return createHmac('sha256', access).update('gallery-session:' + expiry).digest('hex');
}

function matches(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function signIn(req: IncomingMessage, res: ServerResponse) {
  if (req.headers.origin !== 'https://' + publicHost) return send(res, 403, 'text/plain', 'Forbidden');
  const length = req.headers['content-length'] ?? '';
  if (!/^\d{1,4}$/.test(length) || Number(length) > 4096) return send(res, 400, 'text/plain', 'Bad request');
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part);
  const fields = new URLSearchParams(Buffer.concat(parts).toString());
  if (!matches(basic(fields.get('username') ?? '', fields.get('password') ?? ''), access)) return signInPage(res, true);

  const duration = 86400;
  const expiry = String(Math.floor(Date.now() / 1000) + duration);
  res.writeHead(303, {
    'Set-Cookie': `__Host-gallery=${expiry}.${signature(expiry)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${duration}`,
    'Cache-Control': 'private, no-store',
    Location: '/',
  }).end();
}

export async function authorized(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!publicHost) return true;
  if (req.method === 'POST' && req.url === '/_signin') {
    await signIn(req, res);
    return false;
  }
  if (matches(req.headers.authorization ?? '', access)) return true;
  const token = /(?:^|;\s*)__Host-gallery=(\d{10})\.([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie ?? '');
  if (token && Number(token[1]) > Date.now() / 1000 && matches(token[2], signature(token[1]))) return true;
  if (req.method === 'GET' && (req.url === '/' || req.headers.accept?.includes('text/html'))) signInPage(res);
  else send(res, 401, 'text/plain', 'Sign in to vibe-templates.');
  return false;
}
