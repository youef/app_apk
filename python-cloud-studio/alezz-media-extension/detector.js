(() => {
  if (globalThis.alezzMediaObserver) return;
  globalThis.alezzMediaObserver = true;
  let timer;
  const reported = new Map();
  function scan() {
    timer = undefined;
    const entries = [];
    for (const video of document.querySelectorAll('video')) {
      const urls = [video.currentSrc, video.src, ...Array.from(video.querySelectorAll('source[src]'), el => el.src)];
      for (const url of urls) {
        if (!/^https?:\/\//i.test(url || '')) continue;
        const live = video.duration === Infinity;
        if (reported.get(url) === live) continue;
        if (reported.size >= 100) reported.delete(reported.keys().next().value);
        reported.set(url, live);
        entries.push({url, live});
      }
    }
    if (entries.length) chrome.runtime.sendMessage({action: 'media', entries: entries.slice(0, 50)}).catch(() => {});
  }
  function schedule() { if (timer === undefined) timer = setTimeout(scan, 180); }
  new MutationObserver(schedule).observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ['src']});
  document.addEventListener('loadedmetadata', schedule, true);
  document.addEventListener('durationchange', schedule, true);
  chrome.runtime.onMessage.addListener(message => { if (message.action === 'scan') { reported.clear(); schedule(); } });
  schedule();
})();
