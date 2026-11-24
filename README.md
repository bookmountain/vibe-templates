# vibe-templates

A private, searchable template gallery. Open the [hosted gallery](https://vibe-template.bookmountain.work/) or run it locally with Python 3 and the `requests` package.

```sh
python3 app/serve.py
```

The local gallery is available at http://127.0.0.1:4175/. Its private data directory defaults to `~/.local/share/vibe-templates/data`. Set `VIBE_DATA_DIR` to use another location. It contains the catalog, source inventory, licensed archives, built projects, and cached assets. Provider addresses come from the installed catalog metadata.

The collector checks the signed-in account's download allowance, verifies each source archive against its catalog entry, and builds the downloaded project. GitHub Actions deploys updates to the application from `main`. The licensed collection and login credentials stay outside this repository.

OAuth, payments, and Pro promotions are off by default. The server reads `VIBE_ENABLE_OAUTH`, `VIBE_ENABLE_PAYMENTS`, and `VIBE_ENABLE_PRO` at startup. Set an option to `true` to restore its upstream surface. The hosted gallery uses its own password and serves downloaded files independently of these flags.
