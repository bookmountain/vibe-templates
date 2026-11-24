"""Pull collected ZIPs and builds from the gallery server when the laptop is online."""
import json
import os
from pathlib import Path
import subprocess
from tempfile import NamedTemporaryFile

DATA = Path(os.getenv('VIBE_DATA_DIR', Path.home() / '.local/share/vibe-templates/data'))
MANIFEST = DATA / 'catalog/source-inventory.json'


def main():
    host = os.environ['VIBE_SYNC_HOST']
    ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8']
    remote_dir = 'vibe-templates/data'
    snapshot = subprocess.check_output([*ssh, host, 'cat', f'{remote_dir}/catalog/source-inventory.json'])
    files = []
    for row in json.loads(snapshot):
        if not row['archive']:
            continue
        files.append(row['archive'])
        if row['archive'] == 'used-car-dealership.zip':
            files.append('used-car-dealership/')
        else:
            files.append(f"projects/{row['variant']}/")
    subprocess.run([
        'rsync', '-ar', '--delay-updates', '--exclude=node_modules', '--exclude=*.partial',
        '--from0', '--files-from=-', '-e', ' '.join(ssh), f'{host}:{remote_dir}/', str(DATA),
    ], input=b'\0'.join(name.encode() for name in files), check=True)
    if MANIFEST.read_bytes() != snapshot:
        with NamedTemporaryFile(dir=MANIFEST.parent, delete=False) as staged:
            staged.write(snapshot)
        Path(staged.name).replace(MANIFEST)


if __name__ == '__main__':
    main()
