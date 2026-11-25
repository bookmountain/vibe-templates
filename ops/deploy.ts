// Install the deploy ref into a versioned directory and activate it after staging succeeds.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const home = homedir();
const base = join(home, 'vibe-templates');
const current = join(base, 'current');
const releases = join(base, 'releases');
const ref = 'refs/heads/deploy';
const gitEnv = {
  ...process.env,
  GIT_SSH_COMMAND: `ssh -i "${home}/.ssh/vibe-templates-readonly" -o "UserKnownHostsFile=${home}/.ssh/vibe-github-known-hosts" -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o BatchMode=yes`,
};

function git(...args: string[]): string {
  return execFileSync('git', ['--git-dir', join(base, 'deploy.git'), ...args], { encoding: 'utf8', env: gitEnv }).trim();
}

function activate(release: string) {
  const next = current + '.next';
  rmSync(next, { force: true });
  symlinkSync(release, next, 'dir');
  renameSync(next, current);
  execFileSync('systemctl', ['--user', 'restart', 'vibe-templates.service'], { stdio: 'inherit' });
}

async function healthy(): Promise<boolean> {
  const password = readFileSync(join(home, '.config/vibe-templates/password'), 'utf8').trim();
  const authorization = 'Basic ' + Buffer.from('book:' + password).toString('base64');
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:4875/local-library.json', {
        headers: { authorization }, signal: AbortSignal.timeout(3000), redirect: 'error',
      });
      if (response.ok && Object.hasOwn(await response.json(), 'used-car-dealership-website')) return true;
    } catch {
      // The service may still be starting after the symlink switch.
    }
    await delay(1000);
  }
  return false;
}

async function deploy() {
  const remoteSha = git('ls-remote', 'origin', ref).split(/\s+/)[0];
  const previous = existsSync(current) ? realpathSync(current) : undefined;
  if (!remoteSha || (previous === join(releases, remoteSha) && await healthy())) return;
  git('fetch', '--quiet', 'origin', ref);
  const sha = git('rev-parse', 'FETCH_HEAD');
  const release = join(releases, sha);
  if (previous === release && await healthy()) return;

  if (!existsSync(release)) {
    mkdirSync(releases, { recursive: true });
    const stage = mkdtempSync(join(releases, '.stage-'));
    try {
      git('--work-tree', stage, 'checkout', '--force', sha, '--', '.');
      execFileSync(process.execPath, ['--check', join(stage, 'app/serve.ts')], { stdio: 'inherit' });
      writeFileSync(join(stage, '.deployed-revision'), sha + '\n');
      renameSync(stage, release);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }

  try {
    activate(release);
    if (!await healthy()) throw new Error('New release failed its health check');
  } catch (error) {
    if (previous && previous !== release) activate(previous);
    else if (!previous) rmSync(current, { force: true });
    throw error;
  }
}
await deploy();
