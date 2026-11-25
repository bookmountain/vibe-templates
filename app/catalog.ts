import { createReadStream, readFileSync, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, posix, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { InventoryRow, Library, TemplateMetadata } from './types.ts';

export const dataDir = resolve(process.env.VIBE_DATA_DIR ?? join(homedir(), '.local/share/vibe-templates/data'));
export const catalogDir = join(dataDir, 'catalog');

function fileExists(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

function readInventory(): InventoryRow[] {
  return JSON.parse(readFileSync(join(catalogDir, 'source-inventory.json'), 'utf8'));
}

const mimeTypes = new Map<string, string>();
try {
  for (const line of readFileSync('/etc/mime.types', 'utf8').split('\n')) {
    const [type, ...extensions] = line.split('#')[0].trim().split(/\s+/);
    for (const extension of extensions) mimeTypes.set(extension, type);
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
for (const [extension, type] of Object.entries({
  html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp', woff2: 'font/woff2', wasm: 'application/wasm',
})) mimeTypes.set(extension, type);

async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse) {
  if (req.headers.origin === 'null') res.setHeader('Access-Control-Allow-Origin', 'null');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(501).end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname.replace(/^\/app\/[0-9a-f-]{36}\//, '/'));
  let file = await realpath(join(root, posix.normalize('/' + path)));
  let info = await stat(file);
  if (info.isDirectory()) {
    if (!url.pathname.endsWith('/')) {
      res.writeHead(301, { Location: url.pathname + '/' + url.search }).end();
      return;
    }
    const index = fileExists(join(file, 'index.html')) ? 'index.html' : 'index.htm';
    file = await realpath(join(file, index));
    info = await stat(file);
  }
  if (!file.startsWith(root + sep) || !info.isFile()) {
    res.writeHead(404).end();
    return;
  }
  const modified = req.headers['if-modified-since'];
  if (modified && !req.headers['if-none-match'] && Math.floor(info.mtimeMs / 1000) <= Date.parse(modified) / 1000) {
    res.writeHead(304).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': mimeTypes.get(extname(file).slice(1).toLowerCase()) ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Last-Modified': info.mtime.toUTCString(),
  });
  if (req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(file), res);
}

async function startDemo(folder: string): Promise<string> {
  const root = await realpath(folder);
  const server = createServer((req, res) => {
    serveStatic(root, req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else res.writeHead(404).end();
    });
  });
  await new Promise<void>((ready, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', ready);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing demo port');
  return 'http://127.0.0.1:' + address.port;
}

export class Catalog {
  rows = readInventory();
  archives = new Map<string, string>();
  demos = new Map<string, string>();
  slugs = new Set<string>();
  readonly source: string;
  readonly media: string;
  readonly demo: string;

  constructor() {
    const first = this.rows[0];
    if (!first) throw new Error('The gallery inventory is empty');
    const template: TemplateMetadata = JSON.parse(readFileSync(join(catalogDir, first.template, 'template.json'), 'utf8'));
    this.source = 'https://' + new URL(first.page).host;
    this.media = 'https://' + new URL(template.media.webp).host;
    this.demo = 'https://' + new URL(template.demo).host;
  }

  async refresh() {
    const rows = readInventory();
    const archives = new Map<string, string>();
    for (const row of rows) {
      if (!row.archive) continue;
      const archive = resolve(dataDir, row.archive);
      if (!fileExists(archive)) continue;
      archives.set(row.variant, archive);
      if (this.demos.has(row.variant)) continue;
      let folder = row.archive === 'used-car-dealership.zip'
        ? join(dataDir, 'used-car-dealership/used-car-dealership-website/dist')
        : join(dataDir, 'projects', row.variant, row.template, 'dist');
      if (!fileExists(join(folder, 'index.html'))) {
        folder = dirname(folder);
        if (fileExists(join(folder, 'package.json')) || !fileExists(join(folder, 'index.html'))) continue;
      }
      this.demos.set(row.variant, await startDemo(folder));
    }
    this.rows = rows;
    this.archives = archives;
    this.slugs = new Set(rows.map(row => row.template));
  }

  library(hosted: boolean): Library {
    const library: Library = Object.create(null);
    for (const { template, variant } of this.rows) {
      const demo = this.demos.get(variant);
      (library[template] ??= []).push({
        id: variant, archiveAvailable: this.archives.has(variant),
        origin: demo && hosted ? '/builds/' + variant : demo ?? null,
      });
    }
    return library;
  }
}
