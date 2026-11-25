# vibe-templates

A personal gallery for browsing website templates. Search by keyword or filter by tag, then open a template to explore its design, read its build prompt, and try the live preview.

## Using the gallery

1. Sign in with your gallery password.
2. Open a template. If it has multiple variants, select the one you want to preview.
3. Choose **Download source code** to save that variant’s ZIP. **Source queued for download** means the archive has yet to arrive.

The gallery works without a membership or payment plan. This repository contains the application code. Downloaded templates and their source archives stay in the private collection.

## Run the TypeScript version

Use Node.js 22.18 or newer. Start the gallery from the repository root with an existing collection.

```sh
node app/serve.ts
```

Open [the local gallery](http://127.0.0.1:4175/). The default collection directory is `~/.local/share/vibe-templates/data`. Set `VIBE_DATA_DIR` to use another collection containing `catalog/source-inventory.json`. Set `VIBE_PORT` to change the listening port. Hosted mode uses `VIBE_PUBLIC_HOST` and a password file specified by `VIBE_ACCESS_FILE`.

For development, run `npm ci`, `npm run typecheck`, and `npm test`. Node runs the TypeScript directly and the server strips the browser script’s types before serving it. The deployment entry point is `ops/deploy.ts`. Existing Python service commands forward to Node. Set `VIBE_NODE` to select its executable when necessary.
