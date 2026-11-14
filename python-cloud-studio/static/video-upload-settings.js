(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SERVICE = '/api/studio/video-upload';
  const NAMES = {r2: 'Cloudflare R2', b2: 'Backblaze B2', oracle: 'Oracle Object Storage'};
  const SIGNUP = {r2: 'https://dash.cloudflare.com/', b2: 'https://secure.backblaze.com/',
                  oracle: 'https://cloud.oracle.com/'};
  const HELP = {
    r2: 'Cloudflare R2: الصق Account ID ومفتاحَي S3 وCloudflare API Token منفصلًا. يمكنك حفظها قبل إنشاء الحاوية أو رابط القراءة، ثم الضغط على إعداد R2 تلقائيًا. يجب تفعيل R2 في حساب Cloudflare أولًا.',
    b2: 'Backblaze B2: اختر المنطقة التي أنشئت فيها الحاوية مثل us-west-004. أنشئ Application Key بحقوق Read/Write على الحاوية. يمكن إظهار ملفات الحاوية للعامة من لوحة B2.',
    oracle: 'Oracle: أدخل رابط S3 Compatibility API والـ Region الخاصين بك. أنشئ Customer Secret Key من إعدادات مستخدم OCI، وجهز الحاوية وسياسة القراءة العامة.'
  };
  let selected = 'r2';
  let config = {};
  let busy = false;

  async function api(method, path, body) {
    const response = await fetch(SERVICE + path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: {'Accept': 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(
      typeof data.detail === 'string' ? data.detail : 'فشل الاتصال (' + response.status + ')');
    return data;
  }

  function feedback(message, success = false) {
    $('settings-feedback').textContent = message;
    $('settings-feedback').className = 'feedback ' + (success ? 'success' : 'error');
  }

  function openPanel(id = selected) {
    $('settings-body').hidden = false;
    $('settings-toggle').setAttribute('aria-expanded', 'true');
    $('settings-toggle').textContent = 'إغلاق الإعدادات';
    if (id && NAMES[id]) selectProvider(id);
    $('provider-settings').scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function togglePanel() {
    const shown = $('settings-body').hidden;
    $('settings-body').hidden = !shown;
    $('settings-toggle').setAttribute('aria-expanded', String(shown));
    $('settings-toggle').textContent = shown ? 'إغلاق الإعدادات' : 'إعداد المراكز ⚙';
    if (shown) loadSettings();
  }

  function selectProvider(id) {
    if (busy || !NAMES[id]) return;
    selected = id;
    document.querySelectorAll('[data-settings-provider]').forEach(button => {
      const active = button.dataset.settingsProvider === id;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('settings-provider-title').textContent = NAMES[id];
    $('settings-signup').href = SIGNUP[id];
    $('settings-hint').textContent = HELP[id];
    $('settings-account-wrap').hidden = id !== 'r2';
    $('settings-region-wrap').hidden = id === 'r2';
    $('settings-endpoint-wrap').hidden = id !== 'oracle';
    $('settings-management-wrap').hidden = id !== 'r2';
    $('publish-dev-wrap').hidden = id !== 'r2';
    $('verify-management-token').hidden = id !== 'r2';
    $('auto-setup-r2').hidden = id !== 'r2';
    $('settings-public-url').placeholder = id === 'r2'
      ? 'اختياري قبل الإعداد التلقائي — https://videos.example.com'
      : 'https://videos.example.com';
    const c = config[id] || {};
    $('settings-account-id').value = c.account_id || '';
    $('settings-region').value = c.region || (id === 'b2' ? 'us-west-004' :
                                               id === 'oracle' ? 'me-jeddah-1' : 'auto');
    $('settings-endpoint').value = c.endpoint || '';
    $('settings-bucket').value = c.bucket || '';
    $('settings-public-url').value = c.public_base_url || '';
    $('settings-access').value = '';
    $('settings-secret').value = '';
    $('settings-management-token').value = '';
    $('settings-management-token').placeholder = c.has_management_token
      ? 'الرمز محفوظ مشفّرًا — اتركه فارغًا للاحتفاظ به'
      : 'Cloudflare API Token (Workers R2 Storage Write)';
    $('verify-management-token').disabled = !c.has_management_token;
    $('auto-setup-r2').disabled = !c.has_management_token;
    $('settings-access').placeholder = c.has_access_key
      ? 'محفوظ مشفّرًا — اتركه فارغًا للاحتفاظ به' : 'S3 Access Key ID';
    $('settings-secret').placeholder = c.has_secret_key
      ? 'محفوظ مشفّرًا — اتركه فارغًا للاحتفاظ به' : 'S3 Secret Access Key';
    $('settings-quota').value = c.quota_gb || (id === 'oracle' ? 20 : 10);
    $('settings-max-file').value = c.max_file_gb || 50;
    $('settings-priority').value = c.priority || 50;
    $('enable-provider').textContent = c.enabled ? 'إيقاف المركز مؤقتًا' : 'تفعيل المركز';
    $('enable-provider').disabled = !c.has_access_key || !c.has_secret_key ||
                                    (!c.enabled && c.health_status !== 'healthy');
    $('test-provider').disabled = !(c.has_access_key && c.has_secret_key);
    $('setup-provider').disabled = !(c.has_access_key && c.has_secret_key);
    $('disconnect-provider').disabled = !(c.has_access_key || c.has_secret_key);
    $('settings-provider-status').textContent = !c.has_access_key
      ? 'لم يتم ربط الحساب' : c.enabled ? 'متصل ومفعّل ✓'
        : c.health_status === 'healthy' ? 'تم الاختبار — جاهز للتفعيل'
        : c.health_status === 'error' ? 'مشكلة في الاتصال' : 'محفوظ — يحتاج الفحص';
    $('settings-provider-status').className = c.enabled
      ? 'settings-status active' : 'settings-status';
    if (c.health_message) {
      $('settings-feedback').textContent = c.health_message;
      $('settings-feedback').className = 'feedback';
    }
    const cors = [{
      AllowedOrigins: [window.location.origin],
      AllowedMethods: ['PUT','GET','HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag','Content-Length'],
      MaxAgeSeconds: 3600
    }];
    $('cors-policy').textContent = JSON.stringify(cors, null, 2);
  }

  function reloadUpload() {
    window.dispatchEvent(new CustomEvent('alezz-storage-updated'));
  }

  async function loadSettings() {
    try {
      const data = await api('GET', '/settings');
      config = Object.fromEntries((data.providers || []).map(p => [p.provider_id, p]));
      $('distribution-mode').value = data.distribution?.mode || 'balanced';
      $('fallback-supabase').checked = data.distribution?.fallback_supabase !== false;
      selectProvider(selected);
      return data;
    } catch (error) {
      feedback('تعذّر تحميل الإعدادات: ' + error.message);
      return null;
    }
  }

  async function action(buttonId, callback) {
    if (busy) return;
    busy = true;
    const button = $(buttonId);
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'جاري التنفيذ...';
    try {
      await callback();
    } catch (error) {
      feedback(error.message || 'حدث خطأ أثناء تنفيذ الإعدادات.');
    } finally {
      busy = false;
      button.textContent = original;
      button.disabled = false;
      selectProvider(selected);
    }
  }

  $('settings-toggle').addEventListener('click', togglePanel);
  document.querySelectorAll('[data-settings-provider]').forEach(button =>
    button.addEventListener('click', () => selectProvider(button.dataset.settingsProvider)));

  $('save-distribution').addEventListener('click', () => action('save-distribution', async () => {
    const result = await api('POST', '/settings', {
      mode: $('distribution-mode').value, fallback_supabase: $('fallback-supabase').checked
    });
    feedback('تم حفظ استراتيجية التوزيع بنجاح.', true);
    reloadUpload();
  }));

  $('save-provider').addEventListener('click', () => action('save-provider', async () => {
    const id = selected;
    const body = {
      account_id: $('settings-account-id').value.trim(),
      region: $('settings-region').value.trim(),
      endpoint: $('settings-endpoint').value.trim(),
      bucket: $('settings-bucket').value.trim(),
      public_base_url: $('settings-public-url').value.trim(),
      access_key_id: $('settings-access').value.trim(),
      secret_access_key: $('settings-secret').value.trim(),
      management_token: id === 'r2' ? $('settings-management-token').value.trim() : '',
      quota_gb: Number($('settings-quota').value),
      max_file_gb: Number($('settings-max-file').value),
      priority: Number($('settings-priority').value)
    };
    if (!body.bucket || (id !== 'r2' && !body.public_base_url)) {
      throw new Error(id === 'r2' ? 'أدخل اسم الحاوية.'
        : 'أدخل اسم الحاوية ورابط القراءة العام.');
    }
    const data = await api('POST', '/providers/' + id, body);
    config[id] = data.provider;
    $('settings-access').value = '';
    $('settings-secret').value = '';
    $('settings-management-token').value = '';
    feedback(id === 'r2'
      ? 'تم حفظ مفاتيح S3 ورمز Cloudflare مشفّرين. يمكنك اختيار إعداد R2 تلقائيًا، أو تهيئة CORS يدويًا ثم فحص المركز.'
      : 'تم تشفير المفاتيح وحفظ الإعدادات. اضغط تهيئة الحاوية/CORS ثم فحص الاتصال وتفعيل المركز.', true);
    reloadUpload();
  }));

  $('verify-management-token').addEventListener('click',
    () => action('verify-management-token', async () => {
      const status = await api('GET', '/providers/r2/token-test');
      feedback(status.message, status.ok === true);
    }));

  $('auto-setup-r2').addEventListener('click',
    () => action('auto-setup-r2', async () => {
      if (selected !== 'r2') return;
      const publish = $('publish-r2-dev').checked;
      if (!window.confirm('سيتم إنشاء حاوية R2 إذا لم تكن موجودة وضبط CORS.' +
        (publish ? ' وسيُفعّل رابط r2.dev العام للتجربة.' : '') +
        ' هل توافق؟')) return;
      const result = await api('POST', '/providers/r2/auto-setup', {
        publish_dev: publish
      });
      await loadSettings();
      feedback(result.message, true);
      reloadUpload();
    }));

  $('setup-provider').addEventListener('click', () => action('setup-provider', async () => {
    const createBucket = $('create-bucket').checked;
    if (!window.confirm('سيتم ضبط CORS لهذا الموقع' +
      (createBucket ? ' وإنشاء الحاوية إن لم تكن موجودة' : '') +
      '. هل تريد تنفيذ التهيئة؟')) return;
    const result = await api('POST', '/providers/' + selected + '/setup', {
      create_bucket: createBucket
    });
    feedback(result.message, true);
  }));

  $('test-provider').addEventListener('click', () => action('test-provider', async () => {
    const result = await api('POST', '/providers/' + selected + '/test');
    feedback(result.message, !!result.ok && !!result.cors_ready);
    await loadSettings();
    reloadUpload();
  }));

  $('enable-provider').addEventListener('click', () => action('enable-provider', async () => {
    const previous = config[selected] || {};
    const enabled = !previous.enabled;
    await api('POST', '/providers/' + selected + '/enable', {enabled});
    await loadSettings();
    feedback(enabled
      ? 'تم تفعيل ' + NAMES[selected] + ' ضمن التوزيع التلقائي. يمكنك رفع الفيديوهات الكبيرة الآن.'
      : 'تم تعطيل المركز للرفع الجديد. ملفات الفيديو الموجودة لم تُحذف.', true);
    reloadUpload();
  }));

  $('disconnect-provider').addEventListener('click', () => action('disconnect-provider', async () => {
    if (!window.confirm('سيتم حذف مفاتيح الربط المشفرة من الداتا. لن تُحذف ملفات الفيديو الموجودة في المركز. هل تريد المتابعة؟')) {
      return;
    }
    await api('POST', '/providers/' + selected + '/disconnect');
    await loadSettings();
    feedback('تم حذف إعدادات الربط. الروابط الحالية لم تتغير.', true);
    reloadUpload();
  }));

  $('copy-cors').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('cors-policy').textContent);
      feedback('تم نسخ إعدادات CORS. ألصقها في إعدادات الحاوية.', true);
    } catch (_) { feedback('لم يتم النسخ تلقائيًا. يمكنك تحديد سياسة CORS أعلاه ونسخها يدويًا.'); }
  });

  window.AlEzzStorage = {open: openPanel};
  loadSettings();
})();
