# vibe-templates

Personal local copy of the VibeFather catalog. The homepage and template pages use cached original HTML, scripts, styles, fonts and preview images. Downloaded Build Kits run on isolated loopback ports. Demos without a local build open from VibeFather until their official ZIPs are collected.

Run the gallery with Python 3 and the requests package installed.

```sh
python3 vibefather-local/serve.py
```

Open http://127.0.0.1:4175/. Search for “Used Car Dealership Website” and select “Try the live demo” to open Cedar Row Motors. The source inventory in `vibefather-catalog/source-inventory.json` maps each case to its official ZIP. Each kit includes its license.

The daily collector uses the machine owner's separate signed-in Chrome profile. It reads the available source quota before downloading and checks each archive against its case ID. Login data stays outside this repository. Locally scheduled downloads require the machine and authenticated browser profile to be available.
