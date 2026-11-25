import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';
import type { TestContext } from 'node:test';
import type { Library } from '../app/types.ts';

const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const queued = '11111111-2222-3333-4444-555555555555';
const demo = 'https://demo.gallery.local';
const page = 'https://gallery.example/templates/sample';
const basic = 'Basic ' + Buffer.from('book:fixture').toString('base64');
let data: string;

async function file(path: string, contents: string | Buffer) {
  const dest = join(data, path);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, contents);
}

before(async () => {
  data = await mkdtemp(join(tmpdir(), 'gallery-test-'));
  await file('catalog/source-inventory.json', JSON.stringify([
    { template: 'sample', variant: id, page, archive: 'build-kits/sample.zip' },
    { template: 'sample', variant: queued, page, archive: null },
  ]));
  await file('catalog/sample/template.json', JSON.stringify({ media: { webp: 'https://media.gallery.local/image.webp' }, demo }));
  await file('catalog/sample/prompt.md', 'Template prompt');
  await file('catalog/sample/DESIGN.md', 'Design guide');
  await file('build-kits/sample.zip', Buffer.from([80, 75, 3, 4]));
  await file(`projects/${id}/sample/dist/index.html`, '<title>Local preview</title>');
  await file(`projects/${id}/sample/dist/assets/example.js`, 'const example = 1;');
  await file('password', 'fixture\n');

  // These keys were computed by the original Python server for its URL and router headers.
  const html = '99e541b696a4b5c946dffeb44fe7353c35111f637aa6b19cf524534fd21d8773';
  const flight = '44c292852cc6772c985cfdb8794c2b50f5d01945273331cd849009fd7b98e71f';
  const media = '6f6735b72ef14455a37dc633e02ee89e94cb4af8c8c6c7b00b556f6fb70c642b';
  for (const [key, type, body] of [
    [html, 'text/html', `<head><title>Gallery</title></head><body>✨ ${demo}/${id}/</body>`],
    [flight, 'text/x-component', `RSC ${demo}/${id}/`],
    [media, 'image/webp', 'binary asset'],
  ]) {
    const blob = 'cache/' + key.slice(0, 2) + '/' + key;
    await file(blob, body);
    await file(blob + '.json', type);
  }
});
after(async () => { if (data) await rm(data, { recursive: true, force: true }); });

async function start(t: TestContext, hosted: boolean) {
  const child = spawn(process.execPath, ['app/serve.ts'], {
    env: {
      ...process.env, VIBE_DATA_DIR: data, VIBE_PORT: '0', VIBE_PUBLIC_HOST: hosted ? 'gallery.test' : '',
      VIBE_ACCESS_FILE: join(data, 'password'), VIBE_ENABLE_MEMBERSHIP: hosted ? 'true' : 'false',
      VIBE_ENABLE_OAUTH: String(hosted), VIBE_ENABLE_PRO: 'true', VIBE_ENABLE_PAYMENTS: '1',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const closed = once(child, 'close');
  t.after(async () => { child.kill(); await closed; });
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    const url = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url) return (path: string, init?: RequestInit) => fetch(url + path, { redirect: 'manual', ...init });
  }
  throw new Error('Gallery exited before listening');
}

test('local catalog, downloaded files, isolated builds and existing HTML/Flight cache', { timeout: 15000 }, async t => {
  const get = await start(t, false);
  const inventory: Library = await (await get('/local-library.json')).json();
  const [ready, pending] = inventory.sample;
  assert.deepEqual(pending, { id: queued, archiveAvailable: false, origin: null });
  assert.equal(ready.archiveAvailable, true);
  assert.ok(ready.origin);
  assert.equal(await (await get('/local/prompt/sample')).text(), 'Template prompt');
  assert.equal(await (await get('/local/design/sample')).text(), 'Design guide');
  assert.deepEqual(await (await get('/api/account/templates/sample')).json(), { signedIn: true, prompt: 'Template prompt' });
  const archive = await get('/local/source/' + id + '.zip');
  assert.equal(archive.headers.get('content-type'), 'application/zip');
  assert.deepEqual(Buffer.from(await archive.arrayBuffer()), Buffer.from([80, 75, 3, 4]));
  assert.equal((await get('/local/source/' + queued + '.zip')).status, 404);
  const head = await get('/local/prompt/sample', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '15');
  assert.equal(await head.text(), '');
  const redirect = await get('/' + id + '/');
  assert.equal(redirect.headers.get('location'), ready.origin + '/');
  const preview = await fetch(ready.origin + '/app/' + id + '/', { headers: { Origin: 'null' } });
  assert.equal(preview.headers.get('access-control-allow-origin'), 'null');
  assert.match(await preview.text(), /Local preview/);
  assert.equal((await fetch(ready.origin + '/assets/')).status, 404);
  assert.equal((await get('/zh/pricing')).status, 404);
  assert.equal((await get('/api/v1/events', { method: 'POST' })).status, 204);
  const html = await (await get('/templates/sample')).text();
  assert.ok(html.includes('✨ ' + ready.origin + '/app/' + id + '/'));
  assert.match(html, /<script defer src="\/local-library.js"><\/script><\/head>/);
  const flight = await get('/templates/sample', { headers: { RSC: '1', 'Next-Router-State-Tree': '["router, state"]' } });
  assert.equal(flight.headers.get('content-type'), 'text/x-component');
  assert.equal(await flight.text(), 'RSC ' + ready.origin + '/app/' + id + '/');
  assert.equal(await (await get('/media/image.webp')).text(), 'binary asset');
  const js = await (await get('/local-library.js')).text();
  assert.doesNotThrow(() => new Function(js));
});

test('hosted sign-in, existing session cookies, feature flags and hosted preview URLs', { timeout: 15000 }, async t => {
  const get = await start(t, true);
  assert.equal((await get('/_deployment')).status, 200);
  assert.match(await (await get('/')).text(), /Open your gallery/);
  assert.equal((await get('/local-library.json')).status, 401);
  const post = (password: string, origin = 'https://gallery.test') => get('/_signin', {
    method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ username: 'book', password }),
  });
  assert.equal((await post('fixture', 'https://elsewhere.test')).status, 403);
  assert.equal((await post('incorrect')).status, 401);
  const signed = await post('fixture');
  assert.equal(signed.status, 303);
  const cookie = signed.headers.get('set-cookie')!;
  assert.match(cookie, /Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400/);
  const expiry = cookie.match(/=(\d{10})\./)![1];
  const legacySignature = createHmac('sha256', basic).update('gallery-session:' + expiry).digest('hex');
  assert.equal(cookie.split(';')[0], '__Host-gallery=' + expiry + '.' + legacySignature);
  const session = { headers: { Cookie: cookie.split(';')[0] } };
  const lib = await get('/local-library.json', session);
  assert.equal(lib.headers.get('cache-control'), 'private, no-store');
  assert.equal((await lib.json()).sample[0].origin, '/builds/' + id);
  assert.equal((await get('/local-library.json', { headers: { Cookie: session.headers.Cookie + 'x' } })).status, 401);
  const auth = { headers: { Authorization: basic } };
  assert.equal((await get('/api/account/templates/sample', auth)).status, 200);
  assert.deepEqual(await (await get('/api/account/templates/sample', auth)).json(), {
    signedIn: true, prompt: 'Template prompt', pro: true, admin: false, unlimited: false, downloadsLeft: 0,
  });
  assert.equal((await get('/account?via=nav', auth)).headers.get('location'), 'https://gallery.example/account?via=nav');
  assert.equal((await get('/account', { headers: { Authorization: basic, RSC: '1' } })).status, 204);
  assert.equal((await get('/builds/' + id, auth)).headers.get('location'), '/builds/' + id + '/');
  assert.match(await (await get('/builds/' + id + '/', auth)).text(), /Local preview/);
  assert.equal(await (await get('/assets/example.js', {
    headers: { Authorization: basic, Referer: 'https://gallery.test/builds/' + id + '/' },
  })).text(), 'const example = 1;');
  assert.match(await (await get('/templates/sample', auth)).text(), /https:\/\/demo.gallery.local/);
});
