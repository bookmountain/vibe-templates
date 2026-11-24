// Resume the licensed source queue through the signed-in VibeFather browser.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const root = path.resolve(__dirname, '..');
const state = process.env.VIBEFATHER_STATE || path.join(os.homedir(), '.local/share/vibefather-local');
const { chromium } = require(path.join(state, 'playwright-core'));
const inventory = path.join(root, 'vibefather-catalog/source-inventory.json');

async function run() {
  const rows = JSON.parse(fs.readFileSync(inventory));
  if (rows.every(row => row.archive)) return;
  const browser = await chromium.launchPersistentContext(path.join(state, 'member-browser'), {
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.goto('https://vibefather.ai/account');
    const counter = page.getByText(/^\d+ left today$/);
    const available = parseInt(await counter.innerText({timeout: 15000}), 10);
    console.log(available + ' source downloads available');
    if (!available) return;
    await browser.route('https://demo.vibefather.ai/**', route => route.abort());
    // Prioritize giving each template one local build before collecting additional variants.
    const have = new Set(rows.filter(row => row.archive).map(row => row.template));
    let remaining = available;
    for (const row of rows.filter(row => !row.archive).sort((a,b) => Number(have.has(a.template)) - Number(have.has(b.template)))) {
      if (!remaining) break;
      if (have.has(row.template) && rows.some(r => !have.has(r.template))) continue;
      await page.goto(row.page);
      const link = page.locator('a[target="_blank"]').filter({hasText: /Open in new tab/i});
      const target = await link.first().getAttribute('href');
      if (!target?.includes('/' + row.variant + '/')) throw Error('Selected case differs from queue: ' + row.variant);
      const btn = page.getByRole('button', {name:'Source code', exact:true});
      await btn.waitFor({timeout:15000});
      const [download] = await Promise.all([page.waitForEvent('download',{timeout:45000}), btn.click()]);
      const url = new URL(download.url());
      if (url.protocol !== 'https:') throw Error('Unexpected download protocol');
      const temp = path.join(root,'vibefather-build-kits',row.variant + '.partial');
      try {
        const response = await fetch(url);
        if (!response.ok) throw Error('Source request returned ' + response.status);
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp,{mode:0o600}));
        const result = spawnSync('python3',[path.join(__dirname,'install_kit.py'),row.variant,temp],{stdio:'inherit'});
        if (result.status !== 0) throw Error('Could not install ' + row.variant);
      } finally { fs.rmSync(temp,{force:true}); }
      have.add(row.template);
      remaining--;
    }
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error.name + ': ' + error.message.split('\n')[0]); process.exitCode=1; });
