import hashlib
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA = Path(
    os.getenv("VIBE_DATA_DIR", Path.home() / ".local/share/vibe-templates/data")
)
PASSWORD_FILE = Path(
    os.getenv(
        "VIBE_ACCESS_FILE", Path.home() / ".config/vibe-templates/hosted-password"
    )
)
OWNER_PASSWORD = PASSWORD_FILE.read_text().strip()
if not OWNER_PASSWORD:
    raise RuntimeError("Configure the owner password before starting the gallery.")
SECRET_KEY = hashlib.sha256(
    ("vibe-templates/session/" + OWNER_PASSWORD).encode()
).hexdigest()
HOST = os.getenv("VIBE_PUBLIC_HOST", "")
ALLOWED_HOSTS = ["localhost", "127.0.0.1"] + ([HOST] if HOST else [])
CSRF_TRUSTED_ORIGINS = ["https://" + HOST] if HOST else []
SESSION_ENGINE = "django.contrib.sessions.backends.signed_cookies"
SESSION_COOKIE_NAME = "__Host-vibe-session" if HOST else "vibe-session"
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = bool(HOST)
SESSION_COOKIE_AGE = 86400
SESSION_COOKIE_HTTPONLY = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
ROOT_URLCONF = "gallery.urls"
WSGI_APPLICATION = "gallery.wsgi.application"
INSTALLED_APPS = ["django.contrib.sessions"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
]
USE_TZ = True
FEATURES = {
    key: os.getenv("VIBE_ENABLE_" + key.upper(), "false").lower() in ("1", "true")
    for key in ("oauth", "payments", "membership", "pro")
}
if not FEATURES["membership"]:
    FEATURES.update(pro=False, payments=False)
