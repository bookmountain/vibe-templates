import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface CachedResponse {
  status: number;
  type: string;
  body: Buffer;
  location: string | null;
}

// Existing collections use SHA-256 of Python's json.dumps([url, headers], sort_keys=True).
function cacheKey(url: string, headers: Record<string, string>): string {
  const quote = (s: string) => JSON.stringify(s).replace(/[\u007f-\uffff]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  const fields = Object.keys(headers).sort().map(key => quote(key) + ': ' + quote(headers[key]));
  return createHash('sha256').update('[' + quote(url) + ', {' + fields.join(', ') + '}]').digest('hex');
}

async function cachedRequest(cache: string, key: string, url: string, headers: Record<string, string>): Promise<CachedResponse> {
  const folder = join(cache, key.slice(0, 2));
  const blob = join(folder, key);
  try {
    const [type, body] = await Promise.all([readFile(blob + '.json', 'utf8'), readFile(blob)]);
    return { status: 200, type, body, location: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(45_000) });
  const type = response.headers.get('Content-Type') ?? 'application/octet-stream';
  const body = Buffer.from(await response.arrayBuffer());
  if (response.status === 200) {
    await mkdir(folder, { recursive: true });
    const temp = blob + '.' + randomUUID();
    try {
      await writeFile(temp, body, { flag: 'wx', mode: 0o600 });
      await rename(temp, blob);
      await writeFile(temp, type, { flag: 'wx', mode: 0o600 });
      await rename(temp, blob + '.json');
    } finally {
      await rm(temp, { force: true });
    }
  }
  return { status: response.status, type, body, location: response.headers.get('Location') };
}

export function responseCache(folder: string) {
  const pending = new Map<string, Promise<CachedResponse>>();
  return (url: string, headers: Record<string, string>) => {
    const key = cacheKey(url, headers);
    let request = pending.get(key);
    if (!request) {
      request = cachedRequest(folder, key, url, headers).finally(() => pending.delete(key));
      pending.set(key, request);
    }
    return request;
  };
}
