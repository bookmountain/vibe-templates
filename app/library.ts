import type { CatalogProvider, Library } from './types.ts';

declare const catalogProvider: CatalogProvider;

// Render the source action from the local inventory, including when the preview case changes.
(() => {
  const controls = 'button, a';
  const sourceLabel = /^(?:(?:download|get)\s+)?(?:source code|source zip|build kit)\b|^(?:下载|下載)?(?:源码|源代码|源碼|原始碼)/i;
  const marker = 'data-local-source';
  let records: Library = {};
  let refreshing = false;
  let inventoryError = false;
  let activeButton: HTMLElement | undefined;
  let replacement: HTMLAnchorElement | HTMLButtonElement | undefined;
  let pending = false;

  function currentSlug() {
    return location.pathname.match(/^\/(?:zh\/)?templates\/([a-z0-9-]+)\/?$/)?.[1];
  }

  function isSource(element: Element | null): element is HTMLElement {
    return element instanceof HTMLElement && !element.hasAttribute(marker) &&
      (sourceLabel.test((element.innerText || element.textContent || '').trim()) || sourceLabel.test(element.getAttribute('aria-label') || ''));
  }

  function update() {
    pending = false;
    const slug = currentSlug();
    if (!slug) return;
    if (!activeButton?.isConnected) {
      activeButton = [...document.querySelectorAll(controls)].find(isSource);
    }
    if (!activeButton) return;
    const zh = location.pathname.startsWith('/zh/');
    const selector = 'a[target="_blank"][href*="/app/"], a[target="_blank"][href*="/builds/"], a[target="_blank"][href^="' + catalogProvider.demo + '/"]';
    const preview = document.querySelector<HTMLAnchorElement>(selector);
    const previewId = preview?.href.match(/\/([a-f0-9-]{36})(?:\/|$)/)?.[1];
    const id = previewId || new URLSearchParams(location.search).get('case');
    const variants = records[slug] || [];
    const selected = id ? variants.find(v => v.id === id) : variants[0];
    const key = [slug, selected?.id, selected?.archiveAvailable, inventoryError, zh].join('/');
    if (replacement?.isConnected && replacement.previousElementSibling === activeButton && replacement.dataset.key === key) return;
    replacement?.remove();
    if (selected?.archiveAvailable) {
      replacement = document.createElement('a');
      replacement.href = '/local/source/' + selected.id + '.zip';
      replacement.download = slug + '-' + selected.id + '.zip';
      replacement.textContent = zh ? '下载源码' : 'Download source code';
    } else {
      replacement = document.createElement('button');
      replacement.type = 'button';
      replacement.disabled = true;
      if (variants.length) replacement.textContent = zh ? '源码等待下载' : 'Source queued for download';
      else if (inventoryError) replacement.textContent = zh ? '本地目录暂不可用' : 'Local inventory unavailable';
      else replacement.textContent = zh ? '正在检查本地源码…' : 'Checking local source…';
    }
    replacement.setAttribute(marker, '');
    replacement.dataset.key = key;
    replacement.className = activeButton.className;
    replacement.style.whiteSpace = 'normal';
    replacement.style.textAlign = 'center';
    activeButton.style.setProperty('display', 'none', 'important');
    activeButton.after(replacement);
  }

  function schedule() {
    if (!pending && currentSlug()) {
      pending = true;
      requestAnimationFrame(update);
    }
  }

  // Capture clicks before the provider app can start a checkout or a remote download.
  function intercept(event: MouseEvent) {
    const button = event.target instanceof Element ? event.target.closest(controls) : null;
    if (currentSlug() && isSource(button)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      schedule();
    }
  }
  window.addEventListener('click', intercept, true);
  window.addEventListener('auxclick', intercept, true);
  async function load() {
    if (refreshing) return;
    refreshing = true;
    try {
      const response = await fetch('/local-library.json');
      if (!response.ok) throw new Error('Local inventory unavailable');
      records = await response.json();
      inventoryError = false;
    } catch {
      inventoryError = true;
    } finally {
      refreshing = false;
      schedule();
    }
  }
  load();
  window.addEventListener('focus', load);
  setInterval(() => { if (!document.hidden && currentSlug()) load(); }, 60000);
  new MutationObserver(schedule).observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['href']});
})();

// The public-domain deployment opens installed builds on the private gallery's host.
if (location.hostname === 'vibe-template.bookmountain.work') {
  fetch('/local-library.json').then(r => r.json()).then((library: Library) => {
    const installed = new Set(Object.values(library).flat().filter(v => v.origin).map(v => v.id));
    function update() {
      for (const a of document.querySelectorAll<HTMLAnchorElement>('a[target="_blank"][href^="' + catalogProvider.demo + '/"]')) {
        const id = new URL(a.href).pathname.split('/')[1];
        if (installed.has(id)) a.href = '/builds/' + id + '/';
      }
    }
    update();
    new MutationObserver(update).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['href']});
  });
}

// Brand the catalog chrome while keeping source documents and resource addresses intact.
(() => {
  const brand = 'vibe-templates';
  const sourceName = catalogProvider.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = new RegExp('(?<![\\w/@.-])' + sourceName + '(?![\\w./@-])', 'gi');
  function rename(text: Node) {
    if (!(text instanceof Text)) return;
    if (!text.parentElement || text.parentElement.closest('script, style, pre, code, textarea')) return;
    const value = text.data.replace(name, brand);
    if (value !== text.data) text.data = value;
  }
  function scan(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) return rename(node);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) rename(walker.currentNode);
  }
  let hydrated = false;
  function start() {
    // The account link is rendered by the client after the session lookup.
    if (!hydrated && document.querySelector('header a[href$="/account"]')) {
      hydrated = true;
      scan(document.documentElement);
    }
    return hydrated;
  }
  new MutationObserver(records => {
    if (!start()) return;
    for (const change of records) {
      if (change.type === 'characterData') rename(change.target);
      else for (const added of change.addedNodes) scan(added);
    }
  }).observe(document.documentElement, {subtree:true, childList:true, characterData:true});
  start();
})();
