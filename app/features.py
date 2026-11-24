"""Optional upstream product surfaces. The gallery owner login is independent."""
import os
import re
from posixpath import normpath
from urllib.parse import unquote

FLAGS = {name: os.getenv(f'VIBE_ENABLE_{name.upper()}', 'false').lower() in ('true', '1')
         for name in ('oauth', 'membership', 'payments', 'pro')}
if not FLAGS['membership']:
    FLAGS.update(payments=False, pro=False)

ROUTES = {
    'oauth': r'(?:login|signup|register|oauth|account|auth|api/(?:auth|oauth))(?:/|$)',
    'payments': r'(?:pricing|checkout|billing|payment|payments|subscribe|subscription|api/(?:billing|checkout|payments?|stripe|subscriptions?))(?:/|$)',
    'membership': r'(?:memberships?|subscriptions?|account/(?:membership|subscription)|api/(?:account/)?(?:memberships?|subscriptions?))(?:/|$)',
    'pro': r'(?:pro|upgrade|api/(?:pro|upgrade))(?:/|$)',
}


def disabled_path(path):
    route = normpath('/' + unquote(path).lstrip('/')).lstrip('/')
    route = route.removeprefix('zh/')
    # These read-only responses describe the local owner and files already on disk.
    if route == 'api/auth/get-session' or re.fullmatch(r'api/account/templates/[a-z0-9-]+', route):
        return False
    return any(not FLAGS[key] and re.match(pattern, route, re.I)
               for key, pattern in ROUTES.items())


def chrome_style():
    selectors = []
    if not FLAGS['oauth']:
        selectors += ['a[href*="/login"]','a[href$="/account"]','a[href*="/signup"]']
    if not FLAGS['payments'] or not FLAGS['pro']:
        selectors += ['a[href$="/pricing"]','.bg-pro:has(> .shell a[href$="/pricing"])',
                      'section:has(a[href$="/pricing"].h-12)', 'li:has(> a[href$="/pricing"])']
    if not FLAGS['pro']:
        selectors += ['.pro-sheen:not(button)', 'p.text-pro-fg',
                      'a[href$="/upgrade"]','a[href$="/pro"]']
    if not selectors:
        return b''
    return ('<style>' + ','.join(selectors) + '{display:none!important}</style>').encode()
