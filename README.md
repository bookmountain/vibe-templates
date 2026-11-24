# vibe-templates

A password-protected gallery for browsing website templates, trying live previews, and downloading source code. The React and TypeScript frontend renders the gallery. Its Django API reads the catalog and serves each variant’s available files.

## Using the gallery

1. Sign in with your gallery password. Search by keyword, combine tags, or select **Downloaded** to find templates with at least one saved source archive.
2. Open a template and select a variant to preview it. The **Build prompt** and **Design guide** tabs hold the template’s reference documents.
3. Choose **Download source code** to save the selected variant’s ZIP. **Source queued for download** means that particular variant’s archive has yet to arrive.

Membership and payment features are disabled by default. Template files and source archives stay in the private collection.

## Project layout

- [`frontend/src/`](frontend/src/) contains the React pages for sign-in, search, filtering, and template previews.
- [`gallery/`](gallery/) contains the Django backend. Its [API routes](gallery/urls.py) cover sessions, catalog search, variant details, prompts, design guides, and ZIP downloads.
- [`tests/`](tests/) exercises sign-in, catalog filtering, previews, and downloads using a temporary sample collection.

## Run locally

Use Python 3.12 and Node.js 22.12 or newer. From the repository root, install the dependencies and build the frontend.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm run build
```

To browse an existing collection, set `VIBE_DATA_DIR` to the directory containing its `catalog/` folder. Set `VIBE_ACCESS_FILE` to a plain-text file containing your gallery password. Keep both outside the repository.

```sh
.venv/bin/python app/serve.py
```

Open [the local gallery](http://127.0.0.1:4175/) and sign in. To run the API tests independently of your collection, use `.venv/bin/python -m unittest discover -s tests`.
