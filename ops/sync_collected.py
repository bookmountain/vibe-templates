"""Send newly verified kits and successful builds to the private gallery on vm100."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(os.getenv('VIBE_DATA_DIR', Path.home()/'.local/share/vibe-templates/data'))
HOST = 'book@192.168.4.106'
DEST = HOST + ':vibe-templates/data/'
MANIFEST = ROOT/'catalog/source-inventory.json'
STATE = Path.home()/'.local/share/vibe-templates/sent.json'


def copy(*args):
    subprocess.run(['rsync','-a','--relative','--exclude=node_modules','--exclude=__pycache__',*args,DEST],cwd=ROOT,check=True)


def main():
    rows = json.loads(MANIFEST.read_text())
    known = json.loads(STATE.read_text()) if STATE.exists() else {}
    items = []
    for row in rows:
        if not row['archive']:
            continue
        key = row['variant']
        project = Path('used-car-dealership') if row['archive']=='used-car-dealership.zip' else Path('projects')/key
        ready = any((ROOT/project).glob('*/dist/index.html')) or any((ROOT/project).glob('*/index.html')) and not any((ROOT/project).glob('*/package.json'))
        if known.get(key) != ready:
            items.extend((row['archive'],str(project)))
            known[key] = ready
    if items:
        copy(*items)
        copy(str(MANIFEST.relative_to(ROOT)))
        STATE.with_suffix('.tmp').write_text(json.dumps(known))
        STATE.with_suffix('.tmp').replace(STATE)


if __name__=='__main__':
    main()
