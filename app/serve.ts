import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';

import { authorized, publicHost, send } from './access.ts';
import { responseCache } from './cache.ts';
import { Catalog, catalogDir, dataDir } from './catalog.ts';
import { chromeStyle, disabledPath, flags } from './features.ts';
import type { CatalogProvider } from './types.ts';

const catalog = new Catalog();
const cachedFetch = responseCache(join(dataDir, 'cache'));
const revisionFile = new URL('../.deployed-revision', import.meta.url);
const port = Number(process.env.VIBE_PORT ?? 4175);
const config: CatalogProvider = {
  features: flags, source: catalog.source, demo: catalog.demo,
  label: new URL(catalog.source).hostname.split('.')[0],
};
const libraryScript = 'const catalogProvider = ' + JSON.stringify(config) + ';\n' +
  stripTypeScriptTypes(readFileSync(new URL('./library.ts', import.meta.url), 'utf8'));
const routerHeaders = ['RSC', 'Next-Router-State-Tree', 'Next-Router-Prefetch', 'Next-Router-Segment-Prefetch', 'Next-Url'];
const injectedHead = chromeStyle() + '<script defer src="/local-library.js"></script></head>';

function json(res: ServerResponse, value: unknown) {
  send(res, 200, 'application/json', JSON.stringify(value));
}

async function proxyPage(req: IncomingMessage, res: ServerResponse, path: string, target: string) {
  const headers: Record<string, string> = {};
  for (const name of routerHeaders) {
    const value = req.headers[name.toLowerCase()];
    if (typeof value === 'string' && value) headers[name] = value;
  }
  const url = path.startsWith('/media/') ? catalog.media + target.slice('/media'.length) : catalog.source + target;
  let result;
  try {
    result = await cachedFetch(url, headers);
  } catch {
    return send(res, 503, 'text/plain', 'This page or asset has not yet been saved locally');
  }
  let { body, location } = result;
  const { type, status } = result;
  if (location?.startsWith(catalog.source + '/')) location = location.slice(catalog.source.length);
  if (/text\/|javascript|json/.test(type)) {
    // A latin1 round trip preserves all other bytes, including non-UTF-8 resources.
    let text = body.toString('latin1');
    if (!publicHost) {
      const alias = 'http://127.0.0.1:' + req.socket.localPort + '/media';
      // HTML can contain embedded Flight data too. Only substitute equal-width origins.
      if (alias.length === catalog.media.length) text = text.replaceAll(catalog.media, alias);
      for (const [id, origin] of catalog.demos) {
        if ((origin + '/app').length === catalog.demo.length) {
          text = text.replaceAll(catalog.demo + '/' + id + '/', origin + '/app/' + id + '/');
        }
      }
    }
    if (type.includes('text/html')) text = text.replace('</head>', injectedHead);
    body = Buffer.from(text, 'latin1');
  }
  send(res, status, type, body, location);
}

async function serveBuild(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const key = path.split('/')[1];
  if (publicHost) {
    const build = /^\/builds\/([a-f0-9-]{36})(\/.*)?$/.exec(path);
    let upstream: string | undefined;
    const origin = build && catalog.demos.get(build[1]);
    if (build && origin) {
      if (!build[2]) {
        send(res, 302, 'text/plain', '', path + '/');
        return true;
      }
      upstream = origin + build[2];
    } else if (/^\/(?:images|assets|fonts|audio|models)\//.test(path) && req.headers.referer) {
      const referer = URL.parse(req.headers.referer);
      const parent = referer && /^\/builds\/([a-f0-9-]{36})\//.exec(referer.pathname);
      const parentOrigin = parent && catalog.demos.get(parent[1]);
      if (referer?.hostname === publicHost && parentOrigin) upstream = parentOrigin + path;
    }
    if (upstream) {
      const response = await fetch(upstream, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      send(res, response.status, response.headers.get('content-type') ?? 'application/octet-stream',
        Buffer.from(await response.arrayBuffer()));
      return true;
    }
  }
  const origin = catalog.demos.get(key);
  if (!origin) return false;
  const location = publicHost ? '/builds' + req.url : origin + (path.slice(key.length + 1) || '/');
  send(res, 302, 'text/plain', '', location);
  return true;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const target = req.url ?? '/';
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    return send(res, 501, 'text/plain', 'Unsupported method');
  }
  if (publicHost && target === '/_deployment' && req.method !== 'POST') {
    return send(res, 200, 'text/plain', existsSync(revisionFile) ? await readFile(revisionFile) : 'initial');
  }
  if (!await authorized(req, res)) return;
  if (req.method !== 'POST' && !['localhost', '127.0.0.1', publicHost].includes(req.headers.host?.split(':')[0] ?? '')) {
    return send(res, 403, 'text/plain', 'Forbidden');
  }
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) {
    return send(res, 400, 'text/plain', 'Bad request');
  }
  const path = target.split(/[?#]/, 1)[0];
  if (disabledPath(path)) return send(res, 404, 'text/plain', 'Feature disabled');
  if (req.method === 'POST') {
    if (path === '/api/v1/events') return send(res, 204, 'text/plain', '');
    return send(res, 405, 'text/plain', 'Method not allowed');
  }
  if (path === '/local-library.js') return send(res, 200, 'text/javascript', libraryScript);
  if (path === '/local-library.json') return json(res, catalog.library(Boolean(publicHost)));
  const doc = /^\/local\/(prompt|design)\/([a-z0-9-]+)$/.exec(path);
  if (doc && catalog.slugs.has(doc[2])) {
    const file = join(catalogDir, doc[2], doc[1] === 'prompt' ? 'prompt.md' : 'DESIGN.md');
    return send(res, 200, 'text/plain; charset=utf-8', await readFile(file));
  }
  if (await serveBuild(req, res, path)) return;
  if (path.startsWith('/local/source/')) {
    const key = path.slice(path.lastIndexOf('/') + 1).replace(/\.zip$/, '');
    const archive = catalog.archives.get(key);
    if (archive) return send(res, 200, 'application/zip', await readFile(archive));
    return send(res, 404, 'text/plain', 'Not found');
  }
  if (/^\/(?:zh\/)?(?:account|login|checkout)(?:\/|$)/.test(path)) {
    if (req.headers.rsc) return send(res, 204, 'text/x-component', '');
    return send(res, 302, 'text/plain', '', catalog.source + target);
  }
  if (path === '/api/auth/get-session') {
    return json(res, { session: { id: 'local-library' }, user: { id: 'local-library', name: 'Local library', email: '', image: null } });
  }
  const member = /^\/api\/account\/templates\/([a-z0-9-]+)$/.exec(path);
  if (member && catalog.slugs.has(member[1])) {
    const prompt = await readFile(join(catalogDir, member[1], 'prompt.md'), 'utf8');
    return json(res, { signedIn: true, prompt, ...(flags.membership && { pro: flags.pro, admin: false, unlimited: false, downloadsLeft: 0 }) });
  }
  if (/^\/api\/(?:auth|account)\//.test(path) ||
      (path !== '/api/billing/plans' && /(?:magic-link|\/billing|\/checkout|\/download|\/source)(?:\/|$)/.test(path))) {
    return send(res, 403, 'text/plain', 'Forbidden');
  }
  await proxyPage(req, res, path, target);
}

await catalog.refresh();
async function refresh() {
  try { await catalog.refresh(); }
  catch (error) { console.error('Could not refresh gallery inventory:', error); }
  finally { setTimeout(refresh, 60_000).unref(); }
}
setTimeout(refresh, 60_000).unref();
const server = createServer((req, res) => {
  handle(req, res).catch(error => {
    if (res.destroyed) return;
    if (res.headersSent) return res.destroy();
    if (error instanceof URIError) return send(res, 400, 'text/plain', 'Bad request');
    if (error?.code === 'ENOENT') return send(res, 404, 'text/plain', 'Not found');
    console.error('Gallery request failed:', error);
    send(res, 500, 'text/plain', 'Internal server error');
  });
});
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') {
    console.log(`Serving the catalog and ${catalog.demos.size} local builds at http://127.0.0.1:${address.port}`);
  }
});
