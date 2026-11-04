const get = id => document.getElementById(id);
const origins = ['https://*/*', 'http://*/*'];
const kinds = {video: 'فيديو مباشر', media: 'وسائط', HLS: 'HLS', DASH: 'DASH'};
let tabId, state, rendered;
const send = async (action, extra = {}) => {
  const reply = await chrome.runtime.sendMessage({action, tabId, ...extra});
  if (!reply) throw new Error('خدمة الإضافة لم ترد. أعد تحميل الإضافة من صفحة الإضافات ثم افتحها مجددًا.');
  if (reply.error) throw new Error(reply.error);
  return reply;
};
const notice = text => { get('notice').textContent = text; };

function copyPrefix() {
  const season = get('season'), episode = get('episode');
  if (!season.value && !episode.value) return '';
  if (!season.value || !episode.value || !season.checkValidity() || !episode.checkValidity()) {
    throw new Error('أدخل رقم الموسم والحلقة معًا.');
  }
  return 'S' + season.value.padStart(2,'0') + 'E' + episode.value.padStart(2,'0') + '|';
}

async function copy(items) {
  if (!items.length) return;
  const prefix = copyPrefix();
  if (prefix && items.length > 1) throw new Error('عند تحديد حلقة، انسخ رابط الجودة التي تريدها وحدها.');
  await navigator.clipboard.writeText(items.map(item => prefix + item.url).join('\n'));
  notice(items.length === 1 ? 'نُسخ الرابط إلى الحافظة.' : 'نُسخت الروابط إلى الحافظة.');
}

function button(title, action) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = title;
  el.onclick = async () => {
    try { await action(); } catch (error) { notice(error.message); }
  };
  return el;
}

function card(item) {
  const row = document.createElement('li');
  const meta = document.createElement('div');
  meta.className = 'meta';
  const type = document.createElement('strong');
  type.className = 'kind';
  type.textContent = kinds[item.kind];
  meta.append(type);
  if (item.live) {
    const live = document.createElement('span');
    live.className = 'live';
    live.textContent = 'مباشر';
    meta.append(live);
  }
  const label = document.createElement('textarea');
  label.className = 'url';
  label.dir = 'ltr';
  label.rows = 3;
  label.readOnly = true;
  label.setAttribute('aria-label', 'رابط الوسائط الكامل');
  label.value = item.url;
  const buttons = document.createElement('div');
  buttons.className = 'buttons';
  buttons.append(button('نسخ الرابط', async () => {
    try { await copy([item]); }
    catch (error) {
      if (error.name !== 'NotAllowedError') throw error;
      label.focus();
      label.select();
      notice('الرابط محدد. اضغط Ctrl+C للنسخ.');
    }
  }));
  if (item.kind === 'HLS' || item.kind === 'DASH') {
    buttons.append(button('فحص نوع البث', async () => {
      notice('جارٍ قراءة قائمة البث…');
      notice((await send('inspect', {url: item.url})).label);
    }));
  } else if (item.kind === 'video') {
    buttons.append(button('تنزيل الملف', async () => {
      if (!await chrome.permissions.request({permissions: ['downloads']})) return;
      await chrome.downloads.download({url: item.url, saveAs: true});
    }));
  }
  row.append(meta, label, buttons);
  return row;
}

async function refresh() {
  state = await send('status');
  const serialized = JSON.stringify(state);
  if (serialized === rendered) return;
  rendered = serialized;
  get('status').textContent = state.automatic ? 'تلقائي نشط' : 'متوقف';
  get('status').dataset.on = String(state.automatic);
  get('toggle').textContent = state.automatic ? 'إيقاف الالتقاط' : 'تفعيل الالتقاط التلقائي';
  get('hint').textContent = state.automatic ? 'تُلتقط روابط التبويب تلقائيًا. بعض المشغلات ترسل الرابط عند الضغط على تشغيل.' : 'فعّل الالتقاط مرة واحدة، ثم افتح أي صفحة فيديو.';
  get('count').textContent = String(state.items.length);
  get('empty').hidden = Boolean(state.items.length);
  get('copyAll').disabled = !state.items.length;
  get('clear').disabled = !state.items.length;
  get('results').replaceChildren(...state.items.map(card));
}

get('toggle').onclick = async () => {
  const toggle = get('toggle');
  toggle.disabled = true;
  try {
    const value = !state?.automatic;
    if (value && !await chrome.permissions.request({origins})) {
      notice('الالتقاط التلقائي يحتاج إذن الوصول إلى مواقع الفيديو.');
      return;
    }
    await send('toggle', {value});
    await refresh();
  } catch (error) { notice(error.message); }
  finally { toggle.disabled = false; }
};
get('sendStudio').onclick = async () => {
  const control = get('sendStudio');
  control.disabled = true;
  try {
    copyPrefix();
    if (!await chrome.permissions.contains({origins}) && !await chrome.permissions.request({origins})) {
      throw new Error('اسمح بالوصول إلى مواقع الفيديو والاستوديو المحلي.');
    }
    await send('transfer', {seriesUrl: get('seriesSource').value.trim(),
      season: Number(get('season').value) || null, episode: Number(get('episode').value) || null});
    notice('رُبطت الصفحة وأُرسلت الروابط للفحص والحفظ في الاستوديو.');
  } catch (error) { notice(error.message); }
  finally { control.disabled = false; }
};
get('copyAll').onclick = () => copy(state?.items || []).catch(error => notice(error.message));
get('clear').onclick = async () => {
  try { await send('clear'); await refresh(); } catch (error) { notice(error.message); }
};
(async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  const params = new URLSearchParams(location.search);
  const target = params.get('tab');
  tabId = target && /^\d+$/.test(target) ? Number(target) : tab?.id;
  if (params.get('view') === 'full') {
    document.body.classList.add('full');
    get('expand').hidden = true;
    get('site').textContent = 'نتائج تبويب المصدر';
  }
  get('expand').onclick = () => {
    if (Number.isInteger(tabId)) chrome.tabs.create({url: chrome.runtime.getURL('popup.html') + '?view=full&tab=' + tabId}).catch(error => notice(error.message));
  };
  if (!target && /^https?:\/\//.test(tab?.url || '')) get('site').textContent = new URL(tab.url).hostname;
  await refresh();
  setInterval(() => refresh().catch(error => notice(error.message)), 1300);
})().catch(error => notice(error.message));
