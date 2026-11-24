// Keep the template's own UI. Resolve its source button against the local archives.
(() => {
  let inventory;
  document.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !/^Source code\b/i.test(button.innerText.trim())) return;
    const slug = location.pathname.match(/^\/(?:zh\/)?templates\/([a-z0-9-]+)\/?$/)?.[1];
    if (!slug) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    inventory ??= fetch('/local-library.json').then(r => r.json());
    const variants = (await inventory)[slug];
    if (!variants?.length) return;
    const link = document.querySelector('a[target="_blank"][href*="/app/"], a[target="_blank"][href*="/builds/"], a[target="_blank"][href*="demo.vibefather.ai/"]');
    const id = link?.href.match(/\/([a-f0-9-]{36})\//)?.[1] || new URLSearchParams(location.search).get('case');
    const variant = variants.find(v => v.id === id) || variants[0];
    if (variant.origin) {
      const a = document.createElement('a');
      a.href = '/local/source/' + variant.id + '.zip';
      a.download = slug + '-' + variant.id + '.zip';
      a.click();
    } else {
      location.assign('https://vibefather.ai/templates/' + slug + '?case=' + variant.id);
    }
  }, true);
})();

// The public-domain deployment opens installed builds on the private gallery's host.
if (location.hostname === 'vibe-template.bookmountain.work') {
  fetch('/local-library.json').then(r => r.json()).then(library => {
    const installed = new Set(Object.values(library).flat().filter(v => v.origin).map(v => v.id));
    function update() {
      for (const a of document.querySelectorAll('a[target="_blank"][href^="https://demo.vibefather.ai/"]')) {
        const id = new URL(a.href).pathname.split('/')[1];
        if (installed.has(id)) a.href = '/builds/' + id + '/';
      }
    }
    update();
    new MutationObserver(update).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['href']});
  });
}
