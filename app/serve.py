"""Run the private, local vibe-templates catalog on http://127.0.0.1:4175/."""
import base64
import hashlib
import hmac
import json
import os
import re
import threading
import time
from functools import partial
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import parse_qs, urlsplit
from http.cookies import SimpleCookie, CookieError

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.getenv('VIBE_DATA_DIR', Path.home()/'.local/share/vibe-templates/data'))
CATALOG = DATA / 'catalog'
CACHE = DATA / 'cache'
INVENTORY = json.loads((CATALOG / 'source-inventory.json').read_text())
ARCHIVES = {r['variant']: DATA / r['archive'] for r in INVENTORY if r['archive']}
first = INVENTORY[0]
source = json.loads((CATALOG / first['template'] / 'template.json').read_text())
ORIGIN = 'https://' + urlsplit(first['page']).netloc
MEDIA = 'https://' + urlsplit(source['media']['webp']).netloc
DEMO_ORIGIN = 'https://' + urlsplit(source['demo']).netloc
DEMOS = {}
SLUGS = {r['template'] for r in INVENTORY}
LOCKS = [threading.Lock() for _ in range(128)]
LOCAL = 'http://127.0.0.1:4175'
PUBLIC_HOST = os.getenv('VIBE_PUBLIC_HOST', '')
ACCESS_FILE = os.getenv('VIBE_ACCESS_FILE', '')
if PUBLIC_HOST and not ACCESS_FILE:
    raise RuntimeError('Hosted galleries require an access file')
ACCESS = ('Basic ' + base64.b64encode(('book:' + Path(ACCESS_FILE).read_text().strip()).encode()).decode()) if PUBLIC_HOST else ''
PORT = int(os.getenv('VIBE_PORT', '4175'))


def fetch(url, headers=None):
    """Keep complete public responses on disk. Router state identifies Next flight responses."""
    headers = headers or {}
    key = hashlib.sha256(json.dumps([url, headers], sort_keys=True).encode()).hexdigest()
    folder = CACHE / key[:2]
    blob, meta = folder / key, folder / (key + '.json')
    with LOCKS[int(key[:2], 16) % len(LOCKS)]:
        if meta.is_file() and blob.is_file():
            return 200, meta.read_text(), blob.read_bytes(), None
        r = requests.get(url, headers=headers, timeout=(8, 45), allow_redirects=False)
        typ = r.headers.get('Content-Type', 'application/octet-stream')
        if r.status_code == 200:
            folder.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile(dir=folder, delete=False) as tmp:
                tmp.write(r.content)
            os.replace(tmp.name, blob)
            meta.write_text(typ)
        return r.status_code, typ, r.content, r.headers.get('Location')


def localize(body):
    # Flight payloads contain byte-counted strings. Keep URL replacements equal in length.
    if PUBLIC_HOST:
        return body
    media_alias = LOCAL + '/media'
    body = body.replace(MEDIA.encode(), media_alias.encode())
    for key, origin in DEMOS.copy().items():
        remote = DEMO_ORIGIN + '/' + key
        alias = origin + '/app/' + key
        assert len(alias) == len(remote)
        body = body.replace((remote + '/').encode(), (alias + '/').encode())
    return body


class QuietFiles(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def translate_path(self, path):
        return super().translate_path(re.sub(r"^/app/[0-9a-f-]{36}/", "/", path))

    def end_headers(self):
        # The original live-demo frame is sandboxed and sends a null origin.
        if self.headers.get("Origin") == "null":
            self.send_header("Access-Control-Allow-Origin", "null")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)


class Gallery(BaseHTTPRequestHandler):
    def send_body(self, status, typ, data, location=None):
        self.send_response(status)
        self.send_header('Content-Type', typ)
        self.send_header('Cache-Control', 'private, no-store' if PUBLIC_HOST else 'no-cache')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if location:
            self.send_header('Location', location)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def sign_in_page(self, error=False):
        page = Path(__file__).with_name('signin.html').read_bytes()
        if error:
            page = page.replace(b'<!--error-->', b'<p class="error" role="alert">Check your username and gallery password.</p>')
        self.send_body(401 if error else 200, 'text/html; charset=utf-8', page)

    def signature(self, expiry):
        return hmac.new(ACCESS.encode(), ('gallery-session:' + expiry).encode(), 'sha256').hexdigest()

    def authorized(self):
        if not PUBLIC_HOST or hmac.compare_digest(self.headers.get('Authorization','').encode(), ACCESS.encode()):
            return True
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get('Cookie',''))
        except CookieError:
            pass
        entry = cookies.get('__Host-gallery')
        if entry:
            expiry, _, signature = entry.value.partition('.')
            if re.fullmatch(r'[0-9]{10}', expiry) and int(expiry) > time.time() and hmac.compare_digest(self.signature(expiry).encode(), signature.encode()):
                return True
        if self.command == 'GET' and (self.path == '/' or 'text/html' in self.headers.get('Accept','')):
            self.sign_in_page()
        else:
            self.send_body(401, 'text/plain', b'Sign in to vibe-templates.')
        return False

    def do_POST(self):
        if PUBLIC_HOST and self.path == '/_signin':
            if self.headers.get('Origin') != 'https://' + PUBLIC_HOST:
                return self.send_error(403)
            length = self.headers.get('Content-Length','')
            if not re.fullmatch(r'[0-9]{1,4}', length) or int(length) > 4096:
                return self.send_error(400)
            fields = parse_qs(self.rfile.read(int(length)).decode('utf-8', 'replace'))
            user = fields.get('username', [''])[0]
            password = fields.get('password', [''])[0]
            provided = b'Basic ' + base64.b64encode((user + ':' + password).encode())
            if not hmac.compare_digest(provided, ACCESS.encode()):
                return self.sign_in_page(error=True)
            duration = 86400
            expiry = str(int(time.time()) + duration)
            self.send_response(303)
            self.send_header('Set-Cookie', f'__Host-gallery={expiry}.{self.signature(expiry)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age={duration}')
            self.send_header('Cache-Control', 'private, no-store')
            self.send_header('Location', '/')
            self.end_headers()
            return
        if not self.authorized():
            return
        if urlsplit(self.path).path == "/api/v1/events":
            return self.send_body(204, "text/plain", b"")
        self.send_error(405)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if PUBLIC_HOST and self.path == '/_deployment':
            revision = ROOT / '.deployed-revision'
            return self.send_body(200, 'text/plain', revision.read_bytes() if revision.exists() else b'initial')
        if not self.authorized():
            return
        if self.headers.get("Host", "").split(":")[0] not in {"localhost", "127.0.0.1", PUBLIC_HOST}:
            return self.send_error(403)
        parts = urlsplit(self.path)
        path = parts.path
        if parts.netloc or not path.startswith('/') or path.startswith('//'):
            return self.send_error(400)
        if path == '/local-library.js':
            config = {'source': ORIGIN, 'demo': DEMO_ORIGIN, 'label': urlsplit(ORIGIN).hostname.split('.')[0]}
            script = ('const catalogProvider = ' + json.dumps(config) + ';\n').encode()
            return self.send_body(200, 'text/javascript', script + Path(__file__).with_name('library.js').read_bytes())
        if path == '/local-library.json':
            data = {r['template']: [] for r in INVENTORY}
            for r in INVENTORY:
                data[r['template']].append({'id': r['variant'], 'origin': ('/builds/' + r['variant'] if PUBLIC_HOST else DEMOS.get(r['variant'])) if r['variant'] in DEMOS else None})
            return self.send_body(200, 'application/json', json.dumps(data).encode())
        match = re.fullmatch(r'/local/(prompt|design)/([a-z0-9-]+)', path)
        if match and match[2] in SLUGS:
            file = 'prompt.md' if match[1] == 'prompt' else 'DESIGN.md'
            return self.send_body(200, 'text/plain; charset=utf-8', (CATALOG / match[2] / file).read_bytes())
        key = path.strip('/').split('/')[0]
        if PUBLIC_HOST:
            # Serve standalone builds on this host. Vendor iframes retain their isolated origin.
            match = re.match(r'^/builds/([a-f0-9-]{36})(/.*)?$', path)
            referer = urlsplit(self.headers.get('Referer', ''))
            parent = re.match(r'^/builds/([a-f0-9-]{36})/', referer.path)
            if match and match[1] in DEMOS:
                if not match[2]:
                    return self.send_body(302, 'text/plain', b'', path + '/')
                upstream = DEMOS[match[1]] + match[2]
            elif parent and parent[1] in DEMOS and referer.hostname == PUBLIC_HOST and path.startswith(('/images/','/assets/','/fonts/','/audio/','/models/')):
                upstream = DEMOS[parent[1]] + path
            else:
                upstream = None
            if upstream:
                r = requests.get(upstream, timeout=15, allow_redirects=False)
                return self.send_body(r.status_code, r.headers.get('Content-Type','application/octet-stream'), r.content)
            if key in DEMOS:
                return self.send_body(302, 'text/plain', b'', '/builds' + self.path)
        if key in DEMOS:
            suffix = path.removeprefix('/' + key) or '/'
            return self.send_body(302, 'text/plain', b'', DEMOS[key] + suffix)
        if path.startswith('/local/source/'):
            archive = ARCHIVES.get(path.rsplit('/', 1)[-1].removesuffix('.zip'))
            if archive:
                return self.send_body(200, 'application/zip', archive.read_bytes())
            return self.send_error(404)
        # Account actions stay on the vendor site. The local reader has no vendor token.
        if re.match(r'^/(?:zh/)?(?:account|login|checkout)(?:/|$)', path):
            if self.headers.get('RSC'):
                return self.send_body(204, 'text/x-component', b'')
            return self.send_body(302, 'text/plain', b'', ORIGIN + self.path)
        if path == '/api/auth/get-session':
            return self.send_body(200, 'application/json', b'{"session":{"id":"local-library"},"user":{"id":"local-library","name":"Local library","email":"","image":null}}')
        member_page = re.fullmatch(r'/api/account/templates/([a-z0-9-]+)', path)
        if member_page and member_page[1] in SLUGS:
            prompt = (CATALOG / member_page[1] / 'prompt.md').read_text()
            payload = dict(signedIn=True, pro=True, admin=False, prompt=prompt,
                           unlimited=False, downloadsLeft=0)
            return self.send_body(200, 'application/json', json.dumps(payload).encode())
        if path.startswith(('/api/auth/', '/api/account/')):
            return self.send_error(403)
        if path != '/api/billing/plans' and re.search(r'(?:magic-link|/billing|/checkout|/download|/source)(?:/|$)', path):
            return self.send_error(403)
        cdn_path = '/media'
        host, target = (MEDIA, self.path[len(cdn_path):]) if path.startswith(cdn_path + '/') else (ORIGIN, self.path)
        headers = {k: self.headers[k] for k in ('RSC', 'Next-Router-State-Tree', 'Next-Router-Prefetch', 'Next-Router-Segment-Prefetch', 'Next-Url') if self.headers.get(k)}
        try:
            status, typ, data, location = fetch(host + target, headers)
        except requests.RequestException:
            return self.send_error(503, 'This page or asset has not yet been saved locally')
        if location and location.startswith(ORIGIN + '/'):
            location = location[len(ORIGIN):]
        if any(t in typ for t in ('text/', 'javascript', 'json')):
            data = localize(data)
        if 'text/html' in typ and b'</head>' in data:
            data = data.replace(b'</head>', b'<script defer src="/local-library.js"></script></head>', 1)
        try:
            self.send_body(status, typ, data, location)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *args):
        pass


def load_builds():
    global INVENTORY, ARCHIVES
    rows = json.loads((CATALOG / 'source-inventory.json').read_text())
    ARCHIVES = {r['variant']: DATA / r['archive'] for r in rows if r['archive']}
    INVENTORY = rows
    for r in rows:
        key = r['variant']
        if key in DEMOS or key not in ARCHIVES:
            continue
        if r['archive'] == 'used-car-dealership.zip':
            folder = DATA / 'used-car-dealership/used-car-dealership-website/dist'
        else:
            folder = DATA / 'projects' / key / r['template'] / 'dist'
        if not (folder / 'index.html').is_file():
            static_root = folder.parent
            if (static_root/'package.json').is_file() or not (static_root/'index.html').is_file():
                continue
            folder = static_root
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietFiles, directory=str(folder)))
        DEMOS[key] = 'http://127.0.0.1:' + str(server.server_port)
        threading.Thread(target=server.serve_forever, daemon=True).start()
def watch_builds():
    while True:
        time.sleep(60)
        load_builds()


def serve():
    load_builds()
    threading.Thread(target=watch_builds, daemon=True).start()
    print(f'Serving the catalog and {len(DEMOS)} local builds at {LOCAL}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Gallery).serve_forever()


if __name__ == '__main__':
    serve()
