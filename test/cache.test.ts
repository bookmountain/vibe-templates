import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { responseCache } from '../app/cache.ts';

test('concurrent cache misses share a fetch and persist only complete 200 responses', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'gallery-cache-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  let hits = 0;
  const upstream = createServer((req, res) => {
    hits++;
    if (req.url === '/redirect') return res.writeHead(302, { Location: '/asset' }).end();
    if (req.url === '/retry' && hits === 4) return res.writeHead(503).end();
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(req.headers.rsc ? 'Flight' : 'HTML');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => new Promise<void>(done => upstream.close(() => done())));
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  const cached = responseCache(folder);
  const results = await Promise.all(Array.from({ length: 5 }, () => cached(origin + '/asset', {})));
  assert.ok(results.every(result => result.body.toString() === 'HTML'));
  assert.equal(hits, 1);
  assert.equal((await cached(origin + '/asset', { RSC: '1' })).body.toString(), 'Flight');
  assert.equal((await responseCache(folder)(origin + '/asset', {})).type, 'text/plain');
  assert.equal(hits, 2);
  const redirect = await cached(origin + '/redirect', {});
  assert.equal(redirect.location, '/asset');
  assert.equal(redirect.status, 302);
  assert.equal((await cached(origin + '/retry', {})).status, 503);
  assert.equal((await cached(origin + '/retry', {})).status, 200);
  assert.equal(hits, 5);
});
