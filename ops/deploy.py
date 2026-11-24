"""Install the GitHub Actions deploy ref on vm100; keep the licensed data private."""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import requests

BASE = Path.home()/'vibe-templates'
REPO = BASE/'deploy.git'
DATA = BASE/'site'
CURRENT = BASE/'current'
RELEASES = BASE/'releases'
SERVICE = ['systemctl','--user','restart','vibe-templates.service']
ENV = {**os.environ, 'GIT_SSH_COMMAND':f'ssh -i {Path.home()}/.ssh/vibe-templates-readonly -o UserKnownHostsFile={Path.home()}/.ssh/vibe-github-known-hosts -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o BatchMode=yes'}


def git(*args, **options):
    return subprocess.run(['git','--git-dir',str(REPO),*args],env=ENV,check=True,**options)


def activate(path):
    tmp = BASE/'current.next'
    tmp.unlink(missing_ok=True)
    tmp.symlink_to(path, target_is_directory=True)
    tmp.replace(CURRENT)
    subprocess.run(SERVICE, check=True)


def healthy():
    auth=('book',(Path.home()/'.config/vibe-templates/password').read_text().strip())
    for _ in range(12):
        try:
            r = requests.get('http://127.0.0.1:4875/local-library.json',auth=auth,timeout=3)
            if r.ok and 'used-car-dealership-website' in r.json():
                return True
        except requests.RequestException:
            pass
        time.sleep(1)
    return False


def main():
    remote = git('ls-remote','origin','refs/heads/deploy',capture_output=True,text=True).stdout.split()
    if not remote or (CURRENT.resolve() == RELEASES/remote[0] and healthy()):
        return
    git('fetch','--quiet','origin','refs/heads/deploy')
    sha = git('rev-parse','FETCH_HEAD',capture_output=True,text=True).stdout.strip()
    release = RELEASES/sha
    if CURRENT.resolve() == release and healthy():
        return
    RELEASES.mkdir(exist_ok=True)
    if not release.exists():
        with tempfile.TemporaryDirectory(dir=RELEASES) as work:
            stage = Path(work)/'release'
            stage.mkdir()
            git('--work-tree',str(stage),'checkout','--force',sha,'--','.')
            subprocess.run(['python3','-m','py_compile',str(stage/'vibefather-local/serve.py')],check=True)
            for name in ('vibefather-catalog','vibefather-projects','vibefather-build-kits','used-car-dealership','used-car-dealership.zip','vibefather-local/cache'):
                if not (stage/name).exists():
                    (stage/name).symlink_to(DATA/name)
            (stage/'.deployed-revision').write_text(sha+'\n')
            stage.rename(release)
    previous = CURRENT.resolve()
    activate(release)
    if not healthy():
        activate(previous)
        raise RuntimeError('New release failed its health check; restored previous release')


if __name__=='__main__':
    main()
