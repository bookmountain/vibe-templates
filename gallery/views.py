import base64
import hmac
import json
import mimetypes
import re
from functools import wraps
from urllib.parse import urlsplit

from django.conf import settings
from django.core import signing
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.middleware.csrf import get_token, rotate_token
from django.shortcuts import redirect
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST, require_safe

from . import catalog


def authenticated(request):
    if request.session.get("owner") is True:
        return True
    expected = b"Basic " + base64.b64encode(
        ("book:" + settings.OWNER_PASSWORD).encode()
    )
    return hmac.compare_digest(
        request.headers.get("Authorization", "").encode(), expected
    )


def private(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not authenticated(request):
            return JsonResponse(
                {"error": "Sign in to the gallery."},
                status=401,
                headers={"Cache-Control": "private, no-store"},
            )
        response = view(request, *args, **kwargs)
        response.setdefault("Cache-Control", "private, no-store")
        return response

    return wrapped


@require_safe
@ensure_csrf_cookie
def session(request):
    return session_data(request)


@require_POST
def login(request):
    try:
        fields = (
            json.loads(request.body)
            if request.content_type == "application/json"
            else request.POST
        )
        password = fields.get("password", "")
    except (ValueError, AttributeError):
        return JsonResponse({"error": "Invalid form."}, status=400)
    if not isinstance(password, str) or not hmac.compare_digest(
        password.encode(), settings.OWNER_PASSWORD.encode()
    ):
        return JsonResponse(
            {"error": "Check your gallery password and try again."}, status=401
        )
    request.session.cycle_key()
    request.session["owner"] = True
    rotate_token(request)
    return session_data(request)


def session_data(request):
    return JsonResponse(
        {
            "authenticated": authenticated(request),
            "csrf": get_token(request),
            "features": settings.FEATURES,
        },
        headers={"Cache-Control": "private, no-store"},
    )


@require_POST
def logout(request):
    request.session.flush()
    rotate_token(request)
    return session_data(request)


@private
@require_safe
def templates(request):
    entries, _, cases, facets = catalog.snapshot()
    rows = list(entries.values())
    query = request.GET.get("q", "").casefold().strip()
    tags = set(request.GET.getlist("tag"))
    if query:
        terms = query.split()
        rows = [
            r
            for r in rows
            if all(
                t
                in (
                    " ".join([r["title"], r["tagline"], *r["tags"], r["model"]])
                ).casefold()
                for t in terms
            )
        ]
    if tags:
        rows = [r for r in rows if tags.issubset(r["tags"])]
    if request.GET.get("source") == "local":
        rows = [r for r in rows if r["available"]]
    if request.GET.get("sort") == "name":
        rows.sort(key=lambda r: r["title"].casefold())
    try:
        page = max(1, int(request.GET.get("page", 1)))
    except ValueError:
        return JsonResponse({"error": "Invalid page."}, status=400)
    size = 24
    return JsonResponse(
        {
            "results": rows[(page - 1) * size : page * size],
            "count": len(rows),
            "page": page,
            "pageSize": size,
            "totalTemplates": len(entries),
            "totalVariants": len(cases),
            "facets": [
                {"group": group, "slug": tag, "count": count}
                for (group, tag), count in facets.most_common()
            ],
        }
    )


@private
@require_safe
def template(request, slug):
    data = catalog.detail(slug)
    if not data:
        raise Http404
    return JsonResponse(data)


@private
@require_safe
def document(request, slug, kind):
    if slug not in catalog.snapshot()[0] or kind not in ("design", "prompt"):
        raise Http404
    p = catalog.ROOT / slug / ("DESIGN.md" if kind == "design" else "prompt.md")
    if not p.is_file():
        raise Http404
    return FileResponse(p.open("rb"), content_type="text/plain; charset=utf-8")


@private
@require_safe
def thumbnail(request, slug):
    if slug not in catalog.snapshot()[0]:
        raise Http404
    p, url = catalog.thumbnail(slug)
    if p:
        return FileResponse(
            p.open("rb"),
            content_type=mimetypes.guess_type(url)[0] or "image/webp",
            headers={"Cache-Control": "private, max-age=86400"},
        )
    if url and urlsplit(url).scheme == "https":
        return redirect(url)
    raise Http404


def case(key):
    row = catalog.snapshot()[2].get(str(key))
    if not row:
        raise Http404
    return row


@private
@require_safe
def download(request, key):
    row = case(key)
    p = catalog.archive(row)
    if not p:
        return JsonResponse({"error": "Source queued for download."}, status=404)
    return FileResponse(
        p.open("rb"),
        as_attachment=True,
        filename=f"{row['template']}-{key}.zip",
        content_type="application/zip",
    )


@private
@require_safe
def preview(request, key):
    if not catalog.build_root(case(key)):
        raise Http404
    token = signing.dumps(str(key), salt="preview")
    return redirect(f"/preview/{token}/index.html")


def file_in(root, name):
    p = (root / name).resolve()
    if not p.is_relative_to(root.resolve()) or not p.is_file():
        raise Http404
    return p


@require_safe
def preview_asset(request, token, name):
    try:
        key = signing.loads(token, salt="preview", max_age=3600)
    except signing.BadSignature:
        raise Http404
    root = catalog.build_root(case(key))
    if not root:
        raise Http404
    p = file_in(root, name)
    response = FileResponse(p.open("rb"), filename=p.name)
    response["Content-Security-Policy"] = (
        "sandbox allow-scripts allow-forms allow-modals allow-downloads; frame-ancestors 'self'"
    )
    response["Access-Control-Allow-Origin"] = "null"
    response["Cache-Control"] = "private, max-age=1800"
    return response


@require_safe
def preview_absolute_asset(request, name):
    ref = urlsplit(request.headers.get("Referer", ""))
    match = re.match(r"^/preview/([^/]+)/", ref.path)
    if not match or ref.netloc != request.get_host():
        raise Http404
    return preview_asset(request, match[1], name)


@require_safe
def ui(request, name="index.html", slug=None):
    p = file_in(settings.BASE_DIR / "dist", name)
    return FileResponse(
        p.open("rb"),
        headers={
            "Cache-Control": "no-cache"
            if name == "index.html"
            else "public, max-age=86400"
        },
    )


@require_safe
def revision(request):
    p = settings.BASE_DIR / ".deployed-revision"
    return HttpResponse(
        p.read_text().strip() if p.exists() else "local",
        content_type="text/plain",
        headers={"Cache-Control": "no-store"},
    )


@private
@require_safe
def inventory(request):
    _, groups, _, _ = catalog.snapshot()
    return JsonResponse(
        {
            slug: [
                {
                    "id": r["variant"],
                    "archiveAvailable": bool(catalog.archive(r)),
                    "origin": f"/builds/{r['variant']}/"
                    if catalog.build_root(r)
                    else None,
                }
                for r in rows
            ]
            for slug, rows in groups.items()
        }
    )
