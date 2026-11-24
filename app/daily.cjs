// Resume the licensed source queue through the signed-in provider session.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const root = process.env.VIBE_DATA_DIR || path.join(os.homedir(), '.local/share/vibe-templates/data');
const state = process.env.VIBE_TEMPLATES_STATE || path.join(os.homedir(), '.local/share/vibe-templates');
const { chromium } = require(path.join(state, 'playwright-core'));
const inventory = path.join(root, 'catalog/source-inventory.json');

async function run() {
  const rows = JSON.parse(fs.readFileSync(inventory));
  if (rows.every(row => row.archive)) return;
  const browser = await chromium.launchPersistentContext(path.join(state, 'member-browser'), {
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.goto(new URL('/account', rows[0].page).href);
    const counter = page.getByText(/^\d+ left today$/);
    const available = parseInt(await counter.innerText({timeout: 15000}), 10);
    console.log(available + ' source downloads available');
    if (!available) return;
    const template = JSON.parse(fs.readFileSync(path.join(root,'catalog',rows[0].template,'template.json')));
    await browser.route(new URL(template.demo).origin + '/**', route => route.abort());
    // Explicit requests go first, followed by one case per template, then the other cases.
    const requested = process.env.VIBE_PRIORITY_TEMPLATE;
    const represented = new Set(rows.filter(row => row.archive).map(row => row.template));
    const firstCases = [];
    const otherCases = [];
    const priority = [];
    for (const row of rows.filter(row => !row.archive)) {
      if (row.template === requested) priority.push(row);
      else if (!represented.has(row.template)) firstCases.push(row);
      else otherCases.push(row);
      represented.add(row.template);
    }
    for (const row of [...priority, ...firstCases, ...otherCases].slice(0, available)) {
      await page.goto(row.page);
      const link = page.locator('a[target="_blank"]').filter({hasText: /Open in new tab/i});
      const target = await link.first().getAttribute('href');
      if (!target?.includes('/' + row.variant + '/')) throw Error('Selected case differs from queue: ' + row.variant);
      const btn = page.getByRole('button', {name:'Source code', exact:true});
      await btn.waitFor({timeout:15000});
      const [download] = await Promise.all([page.waitForEvent('download',{timeout:45000}), btn.click()]);
      const url = new URL(download.url());
      if (url.protocol !== 'https:') throw Error('Unexpected download protocol');
      const temp = path.join(root,'build-kits',row.variant + '.partial');
      try {
        const response = await fetch(url);
        if (!response.ok) throw Error('Source request returned ' + response.status);
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp,{mode:0o600}));
        const result = spawnSync('python3',[path.join(__dirname,'install_kit.py'),row.variant,temp],{stdio:'inherit'});
        if (result.status !== 0) throw Error('Could not install ' + row.variant);
      } finally { fs.rmSync(temp,{force:true}); }

    }
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error.name + ': ' + error.message.split('\n')[0]); process.exitCode=1; });
