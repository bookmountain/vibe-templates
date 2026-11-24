"""Validate and register a single official download before building its local demo."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'vibefather-catalog/source-inventory.json'


def install(key, source):
    rows = json.loads(MANIFEST.read_text())
    row = next(r for r in rows if r['variant'] == key)
    projects = ROOT / 'vibefather-projects'
    dest = projects / key / row['template']
    with zipfile.ZipFile(source) as kit, tempfile.TemporaryDirectory(dir=projects) as temp:
        names = kit.namelist()
        if any(Path(n).is_absolute() or '..' in Path(n).parts for n in names):
            raise ValueError('Unexpected archive path')
        readme = min((n for n in names if Path(n).name == 'README.md'), key=len)
        if f'https://demo.vibefather.ai/{key}/' not in kit.read(readme).decode() or kit.testzip():
            raise ValueError('Archive differs from the selected case or failed its integrity check')
        kit.extractall(temp)
        project = (Path(temp) / readme).parent
        dest.parent.mkdir(exist_ok=True)
        if not dest.exists():
            shutil.copytree(project, dest)
    archive = ROOT / 'vibefather-build-kits' / (key + '.zip')
    if source != archive:
        source.replace(archive)
    row['archive'] = str(archive.relative_to(ROOT))
    temp_manifest = MANIFEST.with_suffix('.new')
    temp_manifest.write_text(json.dumps(rows, indent=2) + '\n')
    temp_manifest.replace(MANIFEST)
    if (dest / 'package.json').exists():
        npm = ['node', str(Path(os.getenv('VIBEFATHER_STATE', Path.home()/'.local/share/vibefather-local')) / 'npm/bin/npm-cli.js')]
        subprocess.run(npm + ['ci' if (dest/'package-lock.json').exists() else 'install','--no-audit','--no-fund'],cwd=dest,check=True)
        manifest = json.loads((dest/'package.json').read_text())
        if 'build' in manifest.get('scripts', {}):
            subprocess.run(npm + ['run','build'],cwd=dest,check=True)
        if (dest/'dist/index.html').is_file():
            shutil.rmtree(dest/'node_modules', ignore_errors=True)
    print('Saved', row['template'], key, flush=True)


if __name__ == '__main__':
    install(sys.argv[1], Path(sys.argv[2]))
