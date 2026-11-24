import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import django
from django.test import Client, override_settings

LOCAL = "4c6384b1-8823-4b10-9af1-bae42cdc72fa"
QUEUED = "a6566065-e82c-4523-9f64-ab6a76c88c4e"
SLUG = "sample-shop"


class GalleryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(tmp.cleanup)
        data = Path(tmp.name)
        password = data / "password"
        password.write_text("fixture-password")
        cls.enterClassContext(
            patch.dict(
                os.environ,
                {
                    "DJANGO_SETTINGS_MODULE": "gallery.settings",
                    "VIBE_ACCESS_FILE": str(password),
                    "VIBE_DATA_DIR": str(data),
                    "VIBE_PUBLIC_HOST": "",
                },
            )
        )
        django.setup()
        from gallery import catalog

        root = data / "catalog"
        folder = root / SLUG
        folder.mkdir(parents=True)
        (root / "catalog.md").write_text("Sample")
        (folder / "template.json").write_text(
            json.dumps(
                {
                    "title": "Sample Shop",
                    "media": {},
                    "tags": [{"slug": "shop"}],
                    "examples": [
                        {
                            "model": "demo",
                            "tool": "Example",
                            "demo": f"https://example.test/{key}/index.html",
                        }
                        for key in (LOCAL, QUEUED)
                    ],
                }
            )
        )
        (folder / "prompt.md").write_text("Sample prompt")
        (folder / "DESIGN.md").write_text("Sample design")
        (data / "sample.zip").write_bytes(b"sample archive")
        dist = data / "projects" / LOCAL / SLUG / "dist"
        dist.mkdir(parents=True)
        (dist / "index.html").write_text("<title>Sample</title>")
        (dist / "image.svg").write_text("<svg/>")
        manifest = root / "source-inventory.json"
        manifest.write_text(
            json.dumps(
                [
                    {"template": SLUG, "variant": LOCAL, "archive": "sample.zip"},
                    {"template": SLUG, "variant": QUEUED, "archive": None},
                ]
            )
        )
        cls.enterClassContext(
            override_settings(
                ALLOWED_HOSTS=["testserver"],
                DATA=data,
                OWNER_PASSWORD="fixture-password",
            )
        )
        cls.enterClassContext(patch.object(catalog, "ROOT", root))
        cls.enterClassContext(patch.object(catalog, "MANIFEST", manifest))
        catalog.load.cache_clear()
        cls.addClassCleanup(catalog.load.cache_clear)

    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.session = self.client.get("/api/session").json()

    def login(self):
        result = self.client.post(
            "/api/session/login",
            {"password": "fixture-password"},
            HTTP_X_CSRFTOKEN=self.session["csrf"],
        )
        self.assertEqual(result.status_code, 200)
        self.session = result.json()
        self.assertTrue(self.session["authenticated"])

    def test_access_and_logout(self):
        self.assertFalse(self.session["authenticated"])
        self.assertFalse(any(self.session["features"].values()))
        for route in (
            "/api/templates",
            f"/api/templates/{SLUG}/prompt",
            f"/api/sources/{LOCAL}.zip",
            f"/builds/{LOCAL}/",
        ):
            self.assertEqual(self.client.get(route).status_code, 401)
        self.assertEqual(
            self.client.post(
                "/api/session/login", {"password": "fixture-password"}
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/api/session/login",
                {"password": "wrong"},
                HTTP_X_CSRFTOKEN=self.session["csrf"],
            ).status_code,
            401,
        )
        self.login()
        self.assertEqual(
            self.client.post(
                "/api/session/logout", HTTP_X_CSRFTOKEN=self.session["csrf"]
            ).status_code,
            200,
        )
        self.assertEqual(self.client.get("/api/templates").status_code, 401)

    def test_filtered_catalog_and_pagination(self):
        self.login()
        listing = self.client.get(
            "/api/templates", {"q": "SAMPLE shop", "tag": "shop", "source": "local"}
        ).json()
        self.assertEqual([row["slug"] for row in listing["results"]], [SLUG])
        self.assertEqual((listing["totalTemplates"], listing["totalVariants"]), (1, 2))
        self.assertEqual(
            self.client.get("/api/templates", {"q": "absent"}).json()["count"], 0
        )
        self.assertEqual(
            self.client.get("/api/templates", {"page": 2}).json()["results"], []
        )
        self.assertEqual(
            self.client.get("/api/templates", {"page": "invalid"}).status_code, 400
        )

    def test_variant_downloads_and_documents(self):
        self.login()
        first, second = self.client.get(f"/api/templates/{SLUG}").json()["cases"]
        self.assertTrue(first["local"])
        archive = self.client.get(first["source"])
        self.assertIn("attachment", archive["Content-Disposition"])
        self.assertEqual(b"".join(archive.streaming_content), b"sample archive")
        self.assertFalse(second["local"])
        self.assertIsNone(second["source"])
        self.assertEqual(self.client.get(f"/api/sources/{QUEUED}.zip").status_code, 404)
        for kind, content in (
            ("prompt", b"Sample prompt"),
            ("design", b"Sample design"),
        ):
            response = self.client.get(f"/api/templates/{SLUG}/{kind}")
            self.assertEqual(b"".join(response.streaming_content), content)
        self.assertEqual(self.client.get("/api/templates/absent").status_code, 404)
        self.assertEqual(self.client.get("/pricing").status_code, 404)

    def test_private_preview(self):
        self.login()
        url = self.client.get(f"/builds/{LOCAL}/")["Location"]
        index = self.client.get(url)
        self.assertIn("sandbox", index["Content-Security-Policy"])
        self.assertIn(b"Sample", b"".join(index.streaming_content))
        base = url.rsplit("/", 1)[0]
        image = self.client.get(base + "/image.svg")
        self.assertIn("sandbox", image["Content-Security-Policy"])
        image.close()
        for route in (
            base + "/../template.json",
            "/preview/invalid/index.html",
            f"/builds/{QUEUED}/",
        ):
            self.assertEqual(self.client.get(route).status_code, 404)
