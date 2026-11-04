const resultLimit = 150;
const captureId = 'alezz-auto-detector';
const origins = ['https://*/*', 'http://*/*'];
let pending = Promise.resolve();
let enabled = chrome.storage.local.get('automatic').then(data => Boolean(data.automatic));
const tabKey = tabId => 'media:' + tabId;

function queue(work) {
  const task = pending.then(work);
  pending = task.catch(() => {});
  return task;
}

function mediaType(url, headers = [], element = false) {
  const mime = (headers.find(h => h.name.toLowerCase() === 'content-type')?.value || '').split(';')[0].trim().toLowerCase();
  if (mime === 'text/html' || mime === 'application/json') return '';
  const path = new URL(url).pathname.toLowerCase();
  if (/mpegurl/.test(mime) || path.endsWith('.m3u8')) return 'HLS';
  if (mime === 'application/dash+xml' || path.endsWith('.mpd')) return 'DASH';
  if (mime === 'video/mp2t' || /\.(ts|m4s)$/.test(path)) return '';
  if (mime.startsWith('video/') || /\.(mp4|m4v|webm|mov|ogv)$/.test(path)) return 'video';
  return element ? 'media' : '';
}

function validUrl(url) {
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password && url.length < 8192; }
  catch { return false; }
}

async function rows(tabId) {
  const key = tabKey(tabId);
  return (await chrome.storage.session.get(key))[key] || [];
}

function record(tabId, entries) {
  return queue(async () => {
    if (!await enabled || tabId < 0) return;
    const current = await rows(tabId);
    let changed = false;
    for (const entry of entries) {
      if (!validUrl(entry.url) || !entry.kind) continue;
      const old = current.find(item => item.url === entry.url);
      if (!old) {
        current.unshift({...entry, capturedAt: Date.now()});
        changed = true;
      } else {
        const kind = old.kind === 'media' ? entry.kind : old.kind;
        const live = Boolean(old.live || entry.live);
        if (kind !== old.kind || live !== Boolean(old.live)) {
          Object.assign(old, {kind, live});
          changed = true;
        }
      }
    }
    if (!changed) return;
    await chrome.storage.session.set({[tabKey(tabId)]: current.slice(0, resultLimit)});
    await chrome.action.setBadgeText({tabId, text: String(Math.min(current.length, resultLimit))}).catch(() => {});
    scheduleStudioSync(tabId);
  });
}

function clear(tabId) {
  return queue(async () => {
    await chrome.storage.session.remove(tabKey(tabId));
    await chrome.action.setBadgeText({tabId, text: ''}).catch(() => {});
  });
}

chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.tabId >= 0) clear(details.tabId).catch(console.error);
}, {urls: origins, types: ['main_frame']});

chrome.webRequest.onHeadersReceived.addListener(details => {
  if (details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 300) return;
  const kind = mediaType(details.url, details.responseHeaders || []);
  if (kind) record(details.tabId, [{url: details.url, kind}]).catch(console.error);
}, {urls: origins}, ['responseHeaders']);

chrome.tabs.onRemoved.addListener(tabId => clear(tabId).catch(console.error));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url && !validUrl(change.url)) clear(tabId).catch(console.error);
});

async function setAutomatic(value, tabId) {
  if (value && !await chrome.permissions.contains({origins})) throw new Error('اسمح بالوصول إلى مواقع الفيديو أولًا.');
  const registered = await chrome.scripting.getRegisteredContentScripts({ids: [captureId]});
  if (value && !registered.length) {
    await chrome.scripting.registerContentScripts([{
      id: captureId, matches: origins, js: ['detector.js'], allFrames: true,
      runAt: 'document_start', persistAcrossSessions: true
    }]);
  }
  await chrome.storage.local.set({automatic: value});
  enabled = Promise.resolve(value);
  if (!value && registered.length) await chrome.scripting.unregisterContentScripts({ids: [captureId]});
  if (value && Number.isInteger(tabId)) {
    await chrome.scripting.executeScript({target: {tabId, allFrames: true}, files: ['detector.js']}).catch(() => {});
    await chrome.tabs.sendMessage(tabId, {action: 'scan'}).catch(() => {});
  }
}

async function readManifest(url) {
  const response = await fetch(url, {credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000)});
  if (!response.ok || !response.body) throw new Error('تعذّر قراءة قائمة البث.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) { text += decoder.decode(); break; }
      bytes += value.length;
      if (bytes > 262144) throw new Error('قائمة البث كبيرة جدًا للتحقق.');
      text += decoder.decode(value, {stream: true});
    }
  } finally { await reader.cancel().catch(() => {}); }
  return text;
}

async function inspectLive(tabId, url) {
  const item = (await rows(tabId)).find(row => row.url === url && ['HLS', 'DASH'].includes(row.kind));
  if (!item) throw new Error('رابط البث غير موجود في هذا التبويب.');
  const text = await readManifest(url);
  if (item.kind === 'DASH') {
    const type = /<MPD\b[^>]*\btype=["'](dynamic|static)["']/i.exec(text)?.[1];
    return type === 'dynamic' ? 'بث مباشر' : type === 'static' ? 'فيديو مسجّل' : 'تعذّر تحديد نوع DASH';
  }
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('الاستجابة ليست قائمة HLS.');
  if (/^#EXT-X-STREAM-INF:/m.test(text)) return 'قائمة جودات HLS. اختر رابط بث فرعي لتحديد نوعه.';
  if (/^#EXT-X-ENDLIST\s*$/m.test(text)) return 'فيديو مسجّل أو بث انتهى';
  if (/^#EXT-X-TARGETDURATION:/m.test(text)) return 'بث مباشر';
  return 'تعذّر تحديد نوع HLS';
}

const studioOrigin = 'http://127.0.0.1:8765';
const syncTimers = new Map();
const studioLinks = 'linkedStudioPages';

function studioPage(value) {
  if (!validUrl(value || '') || !value.startsWith('https://') || value.length>2048) return '';
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

function scheduleStudioSync(tabId) {
  clearTimeout(syncTimers.get(tabId));
  syncTimers.set(tabId,setTimeout(()=>{
    syncTimers.delete(tabId);
    syncLinkedPage(tabId).catch(()=>{});
  },2500));
}

async function syncLinkedPage(tabId) {
  if (!await enabled) return;
  const sourceTab = await chrome.tabs.get(tabId);
  const page = studioPage(sourceTab.url);
  const records = (await chrome.storage.local.get(studioLinks))[studioLinks] || {};
  const link = Object.hasOwn(records,page) && records[page];
  if (!link) return;
  const key = 'studio-sent:'+tabId;
  const previous = (await chrome.storage.session.get(key))[key];
  const links = (await rows(tabId)).filter(item=>item.url.startsWith('https://') && item.url.length<=2048)
    .map(({url,kind})=>({url,kind}));
  const signature = JSON.stringify([page,links.map(item=>item.url).sort()]);
  if (!links.length || previous?.signature===signature) return;
  if (previous && Date.now()-previous.at<120000) return;
  const [studioTab] = await chrome.tabs.query({url:studioOrigin+'/*'});
  if (!studioTab) return;
  await chrome.storage.session.set({[key]:{at:Date.now(),signature:''}});
  const [result] = await chrome.scripting.executeScript({
    target:{tabId:studioTab.id},
    func:async (origin,payload)=>{
      if (location.origin!==origin || location.pathname!=='/') return false;
      const init=await fetch('/api/init',{cache:'no-store'});
      if (!init.ok) return false;
      const session=await init.json();
      if (!session.authenticated) return false;
      const response=await fetch('/api/browser-capture',{
        method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},
        body:JSON.stringify(payload)
      });
      return response.ok && (await response.json()).capture?.saved===true;
    },
    args:[studioOrigin,{...link,page,links,auto_save:true,background:true}]
  });
  if (result?.result) await chrome.storage.session.set({[key]:{at:Date.now(),signature}});
}

async function transferToStudio(tabId, message) {
  const sourceTab = await chrome.tabs.get(tabId);
  const page = studioPage(sourceTab.url);
  if (!page) {
    throw new Error('افتح صفحة HTTPS للفيلم أو الحلقة قبل الإرسال.');
  }
  const episodeMode = Boolean(message.seriesUrl || message.season || message.episode);
  if (episodeMode && (!studioPage(message.seriesUrl) ||
      !Number.isInteger(message.season) || !Number.isInteger(message.episode))) {
    throw new Error('أدخل رابط المسلسل ورقم الموسم والحلقة معًا.');
  }
  const response = await fetch(studioOrigin + '/healthz', {redirect: 'error', signal: AbortSignal.timeout(3000)});
  if (!response.ok || (await response.json()).service !== 'al-ezz-tv-python-studio') {
    throw new Error('شغّل استوديو العز المحلي أولًا.');
  }
  await pending;
  const payload = {
    page, series_url: episodeMode ? studioPage(message.seriesUrl) : '',
    season: episodeMode ? message.season : null, episode: episodeMode ? message.episode : null,
    links: (await rows(tabId)).filter(item=>item.url.startsWith('https://') && item.url.length<=2048)
      .map(({url, kind}) => ({url, kind})),
    auto_save: true
  };
  const [openStudio] = await chrome.tabs.query({url:studioOrigin+'/*'});
  const studioTab = openStudio || await chrome.tabs.create({url: studioOrigin + '/'});
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: {tabId: studioTab.id},
        func: (data, origin) => {
          if (location.origin !== origin || location.pathname !== '/') return false;
          sessionStorage.setItem('alezz:browser-capture', JSON.stringify(data));
          window.dispatchEvent(new Event('alezz-browser-capture'));
          return true;
        },
        args: [payload, studioOrigin]
      });
      if (result?.result) {
        await queue(async()=>{
          const records=(await chrome.storage.local.get(studioLinks))[studioLinks] || {};
          delete records[payload.page];
          records[payload.page]={series_url:payload.series_url,season:payload.season,episode:payload.episode};
          await chrome.storage.local.set({[studioLinks]:Object.fromEntries(Object.entries(records).slice(-200))});
        });
        if (openStudio) await chrome.tabs.update(studioTab.id,{active:true});
        return {sent:true};
      }
    } catch { /* Wait for the studio tab to finish opening. */ }
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  throw new Error('تعذّر إرسال الروابط. افتح الاستوديو المحلي ثم أعد الإرسال.');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message) return;
  if (message.action === 'media' && Number.isInteger(sender.tab?.id) && Array.isArray(message.entries)) {
    const entries = message.entries.slice(0, 50).filter(item => item && validUrl(item.url))
      .map(item => ({url: item.url, kind: mediaType(item.url, [], true), live: Boolean(item.live)}));
    record(sender.tab.id, entries).catch(console.error);
    return;
  }
  const popupUrl = chrome.runtime.getURL('popup.html');
  if ((sender.url || '').split(/[?#]/, 1)[0] !== popupUrl) return;
  const {action} = message;
  (async () => {
    let tabId = message.tabId;
    if (!Number.isInteger(tabId)) {
      const [active] = await chrome.tabs.query({active: true, currentWindow: true});
      tabId = active?.id;
    }
    if (!Number.isInteger(tabId)) throw new Error('افتح صفحة فيديو في تبويب ثم أعد المحاولة.');
    if (action === 'toggle') await queue(() => setAutomatic(Boolean(message.value), tabId));
    if (action === 'clear') await clear(tabId);
    if (action === 'transfer') return transferToStudio(tabId, message);
    if (action === 'inspect') return {label: await inspectLive(tabId, message.url)};
    await pending;
    return {automatic: await enabled && await chrome.permissions.contains({origins}), items: await rows(tabId)};
  })().then(respond, error => respond({error: error.message}));
  return true;
});
