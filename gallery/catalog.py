"""Read the private collection. The manifest is replaced atomically by its owner."""

import hashlib
import json
import re
from collections import Counter, defaultdict
from functools import lru_cache
from urllib.parse import urlsplit

from django.conf import settings

ROOT = settings.DATA / "catalog"
MANIFEST = ROOT / "source-inventory.json"
FEATURED = [
    "cinematic-scroll-product-story",
    "aquarium-exhibits-and-tickets-website",
    "3d-flower-garden-toy",
]


def snapshot():
    return load(MANIFEST.stat().st_mtime_ns)


@lru_cache(maxsize=1)
def load(version):
    variants = defaultdict(list)
    by_id = {}
    for row in json.loads(MANIFEST.read_text()):
        variants[row["template"]].append(row)
        by_id[row["variant"]] = row
    ordered = re.findall(
        r"/templates/([a-z0-9-]+)\.md\)", (ROOT / "catalog.md").read_text()
    )
    entries = {}
    facets = Counter()
    for slug in dict.fromkeys(FEATURED + ordered + list(variants)):
        if slug not in variants:
            continue
        meta = json.loads((ROOT / slug / "template.json").read_text())
        tags = list(dict.fromkeys(t["slug"] for t in meta.get("tags", [])))
        facets.update(
            {(tag.get("facet", "type"), tag["slug"]): 1 for tag in meta.get("tags", [])}
        )
        entries[slug] = {
            "slug": slug,
            "title": meta["title"],
            "tagline": meta.get("tagline", ""),
            "tags": tags,
            "types": meta.get("types", []),
            "styles": meta.get("styles", []),
            "model": meta["examples"][0]["model"] if meta.get("examples") else "",
            "thumbnail": f"/api/templates/{slug}/thumbnail"
            if meta.get("media")
            else None,
            "available": any(archive(r) for r in variants[slug]),
            "variants": len(variants[slug]),
        }
    return entries, variants, by_id, facets


def archive(row):
    if row.get("archive"):
        p = settings.DATA / row["archive"]
        if p.is_file() and p.resolve().is_relative_to(settings.DATA.resolve()):
            return p
    return None


def build_root(row):
    if row["archive"] == "used-car-dealership.zip":
        root = settings.DATA / "used-car-dealership" / row["template"]
    else:
        root = settings.DATA / "projects" / row["variant"] / row["template"]
    if (root / "dist/index.html").is_file():
        return root / "dist"
    if (root / "index.html").is_file() and not (root / "package.json").exists():
        return root
    return None


def detail(slug):
    entries, groups, _, _ = snapshot()
    if slug not in entries:
        return None
    meta = json.loads((ROOT / slug / "template.json").read_text())
    examples = {
        urlsplit(e["demo"]).path.strip("/").split("/")[0]: e for e in meta["examples"]
    }
    label_path = settings.DATA / "case-labels.json"
    labels = json.loads(label_path.read_text()) if label_path.is_file() else {}
    cases = []
    for row in groups[slug]:
        key = row["variant"]
        example = examples.get(key, {})
        local = bool(build_root(row))
        cases.append(
            {
                "id": key,
                "label": labels.get(key, example.get("model", key)),
                "model": example.get("model", ""),
                "tool": example.get("tool", ""),
                "preview": f"/builds/{key}/" if local else example.get("demo"),
                "local": local,
                "source": f"/api/sources/{key}.zip" if archive(row) else None,
            }
        )
    return {
        **entries[slug],
        "description": meta.get("description", ""),
        "stack": meta.get("stack", ""),
        "pages": meta.get("pages"),
        "cases": cases,
    }


def thumbnail(slug):
    meta = json.loads((ROOT / slug / "template.json").read_text())
    media = meta["media"]
    for field in ("shotDesktop", "poster", "webp", "og"):
        url = media.get(field)
        if url:
            key = hashlib.sha256(
                json.dumps([url, {}], sort_keys=True).encode()
            ).hexdigest()
            saved = settings.DATA / "cache" / key[:2] / key
            if saved.is_file():
                return saved, url
    return None, next(
        (u for k in ("shotDesktop", "poster", "webp", "og") if (u := media.get(k))),
        None,
    )
