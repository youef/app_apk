(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const CHUNK = 6 * 1024 * 1024; // Required by Supabase Storage's TUS implementation.
  const state = {file: null, ticket: null, uploadUrl: '', controller: null,
                 running: false, paused: false, uploaded: false};
  const mb = bytes => (Number(bytes || 0) / (1024 * 1024)).toFixed(1) + ' MB';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function message(text, kind) {
    $('feedback').textContent = text;
    $('feedback').className = 'feedback' + (kind ? ' ' + kind : '');
  }

  async function api(method, path, body) {
    const res = await fetch('/api/studio/video-upload' + (path || ''), {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: {'Accept': 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      throw new Error(typeof data.detail === 'string' ? data.detail : ('خطأ الاتصال (' + res.status + ')'));
    }
    return data;
  }

  async function clipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      message('تم نسخ رابط MP4 بنجاح.', 'success');
    } catch (_) {
      $('result-url').value = text;
      $('result-url').select();
      message('حدّد الرابط الموجود في الحقل وانسخه يدويًا.');
    }
  }

  function displayProgress(n, total, label) {
    $('progress-area').hidden = false;
    $('progress').value = total ? Math.min(100, Math.round(n * 100 / total)) : 0;
    $('percent').textContent = $('progress').value + '%';
    $('bytes').textContent = mb(n) + ' / ' + mb(total);
    $('progress-label').textContent = label;
  }

  function buttons() {
    $('upload').disabled = !state.file || state.running;
    $('upload').textContent = state.uploaded ? 'تأكيد حفظ الفيديو' :
      state.ticket ? 'متابعة رفع الفيديو' : 'رفع إلى الداتا';
    $('pause').hidden = !state.running;
    $('pause').disabled = !state.running;
    $('change-file').disabled = state.running;
    $('dropzone').style.pointerEvents = state.running ? 'none' : '';
  }

  async function validMp4(file) {
    if (!file || !/\.mp4$/i.test(file.name) || !file.size) {
      throw new Error('اختر ملف فيديو MP4 صالحًا وليس ملفًا فارغًا.');
    }
    // MP4 containers have an ISO-BMFF "ftyp" box at byte offset four.
    const bytes = new Uint8Array(await file.slice(4, 8).arrayBuffer());
    if (bytes.length !== 4 || String.fromCharCode(...bytes) !== 'ftyp') {
      throw new Error('الملف ليس MP4 حقيقيًا. حوّله إلى MP4 قبل الرفع.');
    }
  }

  async function choose(file) {
    if (state.running || !file) return;
    try { await validMp4(file); }
    catch (e) { message(e.message, 'error'); return; }
    state.file = file;
    state.ticket = null; state.uploadUrl = ''; state.uploaded = false; state.paused = false;
    $('result').hidden = true;
    $('progress-area').hidden = true;
    $('chosen').hidden = false;
    $('file-name').textContent = file.name;
    $('file-size').textContent = mb(file.size);
    $('video-title').value = file.name.replace(/\.mp4$/i, '').slice(0, 180);
    message('الفيديو جاهز للرفع. يمكنك تعديل العنوان ثم الضغط على «رفع إلى الداتا».');
    buttons();
  }

  function tusHeaders() {
    const t = state.ticket;
    return {'Tus-Resumable': '1.0.0', 'x-signature': t.token,
            'apikey': t.public_key};
  }

  // Supabase accepts TUS v1 with 6-MiB chunks. Keeping the transfer in the
  // browser avoids Render upload timeouts and the server's tiny disk quota.
  function uploadMetadata(ticket) {
    const fields = {bucketName: ticket.bucket, objectName: ticket.path,
                    contentType: 'video/mp4', cacheControl: '3600'};
    return Object.entries(fields).map(([name, value]) => {
      return name + ' ' + btoa(value);
    }).join(',');
  }

  async function responseError(response) {
    let detail = '';
    try {
      const data = await response.json();
      detail = data.message || data.error || data.detail || '';
    } catch (_) { detail = await response.text().catch(() => ''); }
    return new Error('فشل التخزين (' + response.status + '): ' + String(detail).slice(0, 240));
  }

  async function createUpload() {
    const t = state.ticket;
    const headers = {...tusHeaders(), 'Upload-Length': String(state.file.size),
                     'Upload-Metadata': uploadMetadata(t)};
    state.controller = new AbortController();
    const response = await fetch(t.tus_endpoint, {
      method: 'POST', mode: 'cors', credentials: 'omit',
      headers, signal: state.controller.signal
    });
    if (!response.ok) throw await responseError(response);
    const location = response.headers.get('Location');
    if (!location) throw new Error('لم يعِد Supabase عنوان جلسة الرفع.');
    const url = new URL(location, t.tus_endpoint);
    if (url.origin !== new URL(t.tus_endpoint).origin) {
      throw new Error('عنوان جلسة الرفع غير موثوق.');
    }
    state.uploadUrl = url.href;
  }

  async function getOffset() {
    if (!state.uploadUrl) return 0;
    state.controller = new AbortController();
    const response = await fetch(state.uploadUrl, {
      method: 'HEAD', mode: 'cors', credentials: 'omit',
      headers: tusHeaders(), signal: state.controller.signal
    });
    if (!response.ok) throw await responseError(response);
    const offset = Number(response.headers.get('Upload-Offset'));
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > state.file.size) {
      throw new Error('أعاد خادم التخزين موضع استئناف غير صالح.');
    }
    return offset;
  }

  async function uploadChunks() {
    if (!state.uploadUrl) await createUpload();
    let offset = await getOffset();
    displayProgress(offset, state.file.size, 'جاري رفع الفيديو إلى Supabase...');
    let failures = 0;
    while (offset < state.file.size) {
      if (state.paused) return false;
      state.controller = new AbortController();
      try {
        const end = Math.min(offset + CHUNK, state.file.size);
        const response = await fetch(state.uploadUrl, {
          method: 'PATCH', mode: 'cors', credentials: 'omit',
          headers: {...tusHeaders(), 'Upload-Offset': String(offset),
                    'Content-Type': 'application/offset+octet-stream'},
          body: state.file.slice(offset, end), signal: state.controller.signal
        });
        if (!response.ok) throw await responseError(response);
        const next = Number(response.headers.get('Upload-Offset'));
        if (!Number.isSafeInteger(next) || next <= offset || next > state.file.size) {
          throw new Error('رد غير صحيح لموضع رفع البيانات.');
        }
        offset = next;
        failures = 0;
        displayProgress(offset, state.file.size, 'جاري رفع الفيديو إلى Supabase...');
      } catch (error) {
        if (state.paused) return false;
        if (++failures > 5) throw error;
        message('انقطع الاتصال مؤقتًا؛ محاولة استئناف الجزء الأخير (' + failures + '/5).');
        await sleep(Math.min(1000 * (2 ** failures), 10000));
        if (state.paused) return false;
        try { offset = await getOffset(); } catch (_) {}
      }
    }
    return true;
  }

  async function finish() {
    displayProgress(state.file.size, state.file.size, 'جاري التحقق والحفظ في قاعدة البيانات...');
    const data = await api('POST', '/finish', {receipt: state.ticket.receipt});
    const row = data.file || {};
    if (!row.public_url) throw new Error('فشل استلام الرابط المباشر من قاعدة البيانات.');
    $('result-url').value = row.public_url;
    $('open-result').href = row.public_url;
    $('preview').src = row.public_url;
    $('result').hidden = false;
    state.ticket = null; state.uploadUrl = ''; state.uploaded = false;
    message('تم حفظ الفيديو في Supabase، والرابط جاهز للإضافة إلى تطبيق العز.', 'success');
    $('result').scrollIntoView({behavior: 'smooth', block: 'start'});
    refreshLibrary();
  }

  async function upload() {
    if (state.running || !state.file) return;
    const title = $('video-title').value.trim();
    if (!title || title.length > 180) {
      message('أدخل عنوان فيديو من 1 إلى 180 حرفًا.', 'error'); return;
    }
    state.running = true; state.paused = false;
    buttons();
    try {
      if (!state.ticket) {
        displayProgress(0, state.file.size, 'جاري تجهيز رابط الرفع الآمن...');
        state.ticket = await api('POST', '/start', {
          filename: state.file.name, title, size_bytes: state.file.size
        });
      }
      if (state.paused) return;
      if (!state.uploaded) {
        const done = await uploadChunks();
        if (!done) return;
        state.uploaded = true;
      }
      await finish();
    } catch (error) {
      if (!state.paused) {
        message(error.message || 'تعذّر الرفع. يمكنك المحاولة مرة أخرى.', 'error');
        if (state.uploaded) {
          $('progress-label').textContent = 'تم رفع الملف، ولم يكتمل تأكيد حفظ البيانات.';
        }
      }
    } finally {
      state.controller = null; state.running = false;
      if (state.paused) message('تم إيقاف الرفع مؤقتًا. اضغط «متابعة رفع الفيديو» لاستكماله.');
      buttons();
    }
  }

  function make(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function renderLibrary(files) {
    const area = $('library');
    area.replaceChildren();
    $('library-status').textContent = files.length ?
      'آخر ' + files.length + ' ملف MP4 محفوظ.' : 'لا توجد ملفات مرفوعة بعد.';
    files.forEach(item => {
      const row = make('article', null, 'library-item');
      const icon = make('span', '▶', 'media-icon');
      const meta = make('div', null, 'library-meta');
      meta.append(make('strong', item.title || item.original_filename),
                  make('small', mb(item.size_bytes) + ' · ' +
                    new Date(item.created_at).toLocaleString('ar-SA')));
      const actions = make('div', null, 'library-actions');
      const copy = make('button', 'نسخ MP4');
      copy.type = 'button';
      copy.addEventListener('click', () => clipboard(item.public_url));
      const view = make('a', 'تشغيل');
      view.href = item.public_url;
      view.target = '_blank';
      view.rel = 'noopener noreferrer';
      actions.append(copy, view);
      row.append(icon, meta, actions);
      area.append(row);
    });
  }

  async function refreshLibrary() {
    try {
      const data = await api('GET', '');
      renderLibrary(Array.isArray(data.files) ? data.files : []);
    } catch (error) {
      $('library-status').textContent = error.message;
      if (!state.file) message('للوصول للرفع، سجل دخول مسؤول في العز TV ثم افتح هذه الصفحة.', 'error');
    }
  }

  $('dropzone').addEventListener('click', () => { if (!state.running) $('file').click(); });
  $('dropzone').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); if (!state.running) $('file').click();
    }
  });
  $('dropzone').addEventListener('dragover', event => {
    event.preventDefault(); $('dropzone').classList.add('dragging');
  });
  $('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
  $('dropzone').addEventListener('drop', event => {
    event.preventDefault(); $('dropzone').classList.remove('dragging');
    choose(event.dataTransfer && event.dataTransfer.files[0]);
  });
  $('file').addEventListener('change', event => choose(event.target.files[0]));
  $('change-file').addEventListener('click', () => $('file').click());
  $('upload').addEventListener('click', upload);
  $('pause').addEventListener('click', () => {
    state.paused = true;
    if (state.controller) state.controller.abort();
  });
  $('copy-result').addEventListener('click', () => clipboard($('result-url').value));
  $('refresh').addEventListener('click', refreshLibrary);
  buttons();
  refreshLibrary();
})();
