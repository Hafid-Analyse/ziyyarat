  // ============ أيقونات SVG موحّدة (بدل الإيموجي) ============
  function ic(name) {
    return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }

  // ============ إعدادات قابلة للتعديل ============
  var BALANCE_ALERT_THRESHOLD = 50000; // فوق هذا الرقم يُبرز الرصيد باللون الأحمر
  var SESSION_KEY = 'zc_rep_session';
  var OFFLINE_QUEUE_KEY = 'zc_offline_queue';

  // ============ الحالة العامة ============
  var state = {
    repName: null,
    region: null, // تُحدَّد تلقائياً من أول منطقة مسموحة للمندوب بعد الدخول
    search: '',
    statusFilter: null, // null = عرض الكل، أو إحدى حالات الزيارة الثلاث
    customers: [], // زبائن المنطقة الحالية (قبل تطبيق فلتر البحث)
    byCode: {},    // كود الزبون → بياناته (للوصول السريع من المستمع الموحّد)
    regionCache: {}, // اسم المنطقة → قائمة زبائنها (لتبديل فوري بين المناطق)
    allowedRegions: [], // كل المناطق المسموحة لهذا المندوب
    regionColors: {} // اسم المنطقة → كود لونها من ورقة Regions
  };

  function indexCustomers(list) {
    var map = {};
    list.forEach(function (c) { map[c.code] = c; });
    state.byCode = map;
  }

  // يتذكّر آخر سطر (رقم الصف في CustomerLog) سجّله المندوب لكل زبون خلال هذه
  // الجلسة فقط — يُستعمل لتصحيح زيارة بالخطأ بدون إضافة سطر جديد في الشيت.
  var lastLoggedRow = {}; // { code: { row: N, repName: '...' } }

  var searchDebounce = null;
  var activeCustomerForModal = null;

  // ============ عناصر DOM ============
  var el = {
    loginScreen: document.getElementById('loginScreen'),
    appScreen: document.getElementById('appScreen'),
    repSelect: document.getElementById('repSelect'),
    pinInput: document.getElementById('pinInput'),
    loginBtn: document.getElementById('loginBtn'),
    loginError: document.getElementById('loginError'),
    repNameLabel: document.getElementById('repNameLabel'),
    logoutBtn: document.getElementById('logoutBtn'),
    themeBtn: document.getElementById('themeBtn'),
    soundBtn: document.getElementById('soundBtn'),
    pendingStrip: document.getElementById('pendingStrip'),
    pendingBadge: document.getElementById('pendingBadge'),
    regionScroll: document.getElementById('regionScroll'),
    statusScroll: document.getElementById('statusScroll'),
    statusCounter: document.getElementById('statusCounter'),
    searchFab: document.getElementById('searchFab'),
    searchOverlay: document.getElementById('searchOverlay'),
    searchCloseBtn: document.getElementById('searchCloseBtn'),
    searchInput: document.getElementById('searchInput'),
    nameSuggestions: document.getElementById('customerNamesList'),
    customerList: document.getElementById('customerList'),
    visitModal: document.getElementById('visitModal'),
    modalCustomerName: document.getElementById('modalCustomerName'),
    modalCancel: document.getElementById('modalCancel'),
    detailsModal: document.getElementById('detailsModal'),
    detailsCustomerName: document.getElementById('detailsCustomerName'),
    detailsBody: document.getElementById('detailsBody'),
    detailsClose: document.getElementById('detailsClose'),
    toast: document.getElementById('toast')
  };

  // ============ الوضع الليلي ============
  var THEME_KEY = 'zc_theme';

  function applyTheme(isDark) {
    document.body.classList.toggle('dark', isDark);
    if (el.themeBtn) {
      // الأيقونة تُظهر الوضع الذي سينتقل إليه عند الضغط
      el.themeBtn.innerHTML = ic(isDark ? 'sun' : 'moon');
      el.themeBtn.setAttribute('aria-label', isDark ? 'الوضع النهاري' : 'الوضع الليلي');
    }
    // لون زر تسجيل الزيارة يعتمد على خلفية البطاقة، وهي تختلف بين الوضعين —
    // فنُعيد حسابه عند كل تبديل حتى يبقى واضحاً في الحالتين
    if (typeof applyRegionColor === 'function' && state && state.regionColors) {
      applyRegionColor();
    }
  }

  // نطبّقه فوراً قبل رسم الشاشة حتى لا يومض التطبيق أبيض ثم يصير داكناً
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* تجاهل */ }
    // إن لم يختر المندوب شيئاً، نتبع إعداد هاتفه تلقائياً
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved ? saved === 'dark' : !!prefersDark);
  })();

  if (el.themeBtn) {
    el.themeBtn.addEventListener('click', function () {
      var nowDark = !document.body.classList.contains('dark');
      applyTheme(nowDark);
      try { localStorage.setItem(THEME_KEY, nowDark ? 'dark' : 'light'); } catch (e) { /* تجاهل */ }
    });
  }

  // ============ الاهتزاز والأصوات ============
  // الاهتزاز إجباري دائماً — هو التأكيد الذي يصل المندوب وهو واقف أمام الزبون
  // بلا أن ينظر للشاشة أو يسمعه أحد. الأصوات وحدها قابلة للكتم.
  // النغمات مولَّدة داخل التطبيق (بلا ملفات صوتية) فلا تُثقل التحميل.
  var SOUND_KEY = 'zc_sound';
  var soundEnabled = true;
  var audioCtx = null;

  function getAudioCtx() {
    if (audioCtx) return audioCtx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    } catch (e) { return null; }
    return audioCtx;
  }

  function playTone(steps) {
    if (!soundEnabled) return;
    var ctx = getAudioCtx();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      var t0 = ctx.currentTime;
      steps.forEach(function (s) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        var start = t0 + s.at;
        osc.frequency.setValueAtTime(s.f, start);
        if (s.to) osc.frequency.linearRampToValueAtTime(s.to, start + s.dur);
        // تدرّج ناعم في الدخول والخروج حتى لا تُسمع طقطقة
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.16, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + s.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + s.dur + 0.03);
      });
    } catch (e) { /* الصوت كماليّ — لا يُعطّل شيئاً إن فشل */ }
  }

  // كلها أقصر من ثلث ثانية عمداً — الصوت الطويل يُحرج أمام الزبون
  var FEEDBACK = {
    'تمت الزيارة':    { vib: [35],         tone: [{ f: 660, to: 990, at: 0, dur: 0.15 }] },
    'لم تتم الزيارة': { vib: [22],         tone: [{ f: 520, at: 0, dur: 0.09 }] },
    'لم أجده':        { vib: [25, 55, 25], tone: [{ f: 560, to: 380, at: 0, dur: 0.17 }] },
    'error':          { vib: [60, 70, 60], tone: [{ f: 330, at: 0, dur: 0.08 },
                                                  { f: 330, at: 0.13, dur: 0.08 }] }
  };

  function feedback(kind) {
    var f = FEEDBACK[kind];
    if (!f) return;
    // الاهتزاز أولاً ودائماً (غير متأثر بالكتم)
    try { if (navigator.vibrate) navigator.vibrate(f.vib); } catch (e) { /* تجاهل */ }
    playTone(f.tone);
  }

  function applySoundSetting(enabled) {
    soundEnabled = enabled;
    if (el.soundBtn) {
      el.soundBtn.innerHTML = ic(enabled ? 'volume' : 'volume-off');
      el.soundBtn.setAttribute('aria-label', enabled ? 'كتم الأصوات' : 'تشغيل الأصوات');
    }
  }

  (function initSound() {
    var saved = null;
    try { saved = localStorage.getItem(SOUND_KEY); } catch (e) { /* تجاهل */ }
    applySoundSetting(saved !== 'off'); // الأصوات مفعّلة افتراضياً
  })();

  if (el.soundBtn) {
    el.soundBtn.addEventListener('click', function () {
      applySoundSetting(!soundEnabled);
      try { localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off'); } catch (e) { /* تجاهل */ }
      if (soundEnabled) feedback('تمت الزيارة'); // عيّنة ليسمع مستوى الصوت
      showToast(soundEnabled ? 'الأصوات مفعّلة' : 'تم كتم الأصوات — الاهتزاز يبقى يعمل');
    });
  }

  // ============ التشغيل الأولي ============
  document.addEventListener('DOMContentLoaded', function () {
    google.script.run.withSuccessHandler(populateReps).getActiveReps();
    updateQueueBadge();

    var saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        var session = JSON.parse(saved);
        if (session && session.repName) {
          enterApp(session.repName);
        }
      } catch (e) { /* تجاهل جلسة تالفة */ }
    }

    if (navigator.onLine) flushQueue();
  });

  window.addEventListener('online', function () {
    showToast('عاد الاتصال بالإنترنت — جاري إرسال الزيارات المحفوظة...');
    flushQueue();
  });

  function populateReps(reps) {
    el.repSelect.innerHTML = '';
    reps.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      el.repSelect.appendChild(opt);
    });
  }

  // ============ تسجيل الدخول ============
  el.loginBtn.addEventListener('click', function () {
    var repName = el.repSelect.value;
    var pin = el.pinInput.value;
    if (!repName || !pin) {
      el.loginError.textContent = 'الرجاء اختيار الاسم وإدخال الرمز السري.';
      return;
    }
    el.loginBtn.disabled = true;
    el.loginBtn.textContent = 'جاري التحقق...';

    google.script.run
      .withSuccessHandler(function (res) {
        el.loginBtn.disabled = false;
        el.loginBtn.textContent = 'دخول';
        if (res.success) {
          localStorage.setItem(SESSION_KEY, JSON.stringify({ repName: res.repName }));
          enterApp(res.repName);
        } else {
          el.loginError.textContent = res.message;
        }
      })
      .withFailureHandler(function () {
        el.loginBtn.disabled = false;
        el.loginBtn.textContent = 'دخول';
        el.loginError.textContent = 'لا يوجد اتصال بالإنترنت، الدخول لأول مرة يحتاج اتصالاً.';
      })
      .login(repName, pin);
  });

  el.logoutBtn.addEventListener('click', function () {
    localStorage.removeItem(SESSION_KEY);
    try { localStorage.removeItem('zc_token'); } catch (e) {}
    clearRegionDisk(); // مهم: لا يرى المندوب التالي بيانات من سبقه
    state.repName = null;
    state.region = null;
    state.regionCache = {};
    lastLoggedRow = {};
    stopPolling();
    el.appScreen.style.display = 'none';
    el.loginScreen.style.display = 'flex';
    el.pinInput.value = '';
    el.loginError.textContent = '';
  });

  var FILTERS_KEY = 'zc_last_filters';

  function saveFilters() {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify({
        region: state.region,
        search: state.search,
        statusFilter: state.statusFilter
      }));
    } catch (e) { /* لا مشكلة إذا تعذّر الحفظ */ }
  }

  function restoreFilters() {
    try {
      var saved = JSON.parse(localStorage.getItem(FILTERS_KEY));
      if (saved) {
        state.region = saved.region || null;
        state.search = saved.search || '';
        state.statusFilter = saved.statusFilter || null;
      }
    } catch (e) { /* لا مشكلة، نبدأ بالإعدادات الافتراضية */ }
  }

  // ============ ألوان المناطق (لون الهيدر حسب المنطقة) ============
  var REGION_COLORS_KEY = 'zc_region_colors';

  function loadRegionColors() {
    // من ذاكرة الهاتف أولاً — فيظهر اللون فوراً بلا انتظار الخادم
    try {
      var saved = JSON.parse(localStorage.getItem(REGION_COLORS_KEY));
      if (saved) { state.regionColors = saved; applyRegionColor(); }
    } catch (e) { /* تجاهل */ }

    google.script.run
      .withSuccessHandler(function (colors) {
        state.regionColors = colors || {};
        try { localStorage.setItem(REGION_COLORS_KEY, JSON.stringify(state.regionColors)); } catch (e) {}
        applyRegionColor();
      })
      .withFailureHandler(function () { /* يبقى اللون الأصلي */ })
      .getRegionColors();
  }

  /** يفتح أو يُغمّق اللون بنسبة — لبناء تدرّج الهيدر من لون واحد */
  function shadeHex(hex, amount) {
    var h = String(hex).replace('#', '');
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    var f = function (v) {
      var out = Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount);
      return Math.max(0, Math.min(255, out));
    };
    var toHex = function (v) { return ('0' + f(v).toString(16)).slice(-2); };
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  /** سطوع اللون النسبي (يُستعمل لحساب التباين) */
  function luminance(hex) {
    var h = String(hex).replace('#', '');
    var r = parseInt(h.substring(0, 2), 16) / 255;
    var g = parseInt(h.substring(2, 4), 16) / 255;
    var b = parseInt(h.substring(4, 6), 16) / 255;
    var adj = function (c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * adj(r) + 0.7152 * adj(g) + 0.0722 * adj(b);
  }

  function contrastWith(hex, other) {
    var a = luminance(hex), b = luminance(other);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  /**
   * يختار لون النص بقياس التباين الفعلي مع كلا الخيارين ويأخذ الأوضح —
   * أدق من الاعتماد على عتبة سطوع ثابتة، فبعض الألوان (كالبرتقالي) تقع
   * في منطقة رمادية تفشل فيها العتبة الثابتة.
   */
  function isLightColor(hex) {
    var DARK = '#2A1823';
    return contrastWith(hex, DARK) >= contrastWith(hex, '#FFFFFF');
  }

  /**
   * يضمن قراءة النص دائماً: بعض الألوان (كالرمادي المتوسط) لا تعطي تبايناً
   * كافياً مع الأبيض ولا مع الداكن. في هذه الحالة النادرة نُعدّل درجة اللون
   * قليلاً جداً حتى يصبح النص مقروءاً — مع الحفاظ على طابع اللون المختار.
   */
  function ensureReadable(hex) {
    var MIN = 4.5;
    var color = hex;
    var light = isLightColor(color);
    var text = light ? '#2A1823' : '#FFFFFF';

    for (var i = 0; i < 10 && contrastWith(color, text) < MIN; i++) {
      // إن كان النص أبيض نُغمّق الخلفية، وإن كان داكناً نُفتّحها
      color = shadeHex(color, light ? 0.07 : -0.07);
    }
    return { bg: color, text: text, light: light };
  }

  /**
   * لون زر "تسجيل زيارة" يحتاج شرطاً إضافياً لا يحتاجه الهيدر:
   * الهيدر يملأ عرض الشاشة فحدوده واضحة دائماً، أما الزر فيقع داخل بطاقة
   * بيضاء (أو داكنة ليلاً) — فلو كانت المنطقة بلون فاتح (كالأصفر) لذاب الزر
   * في البطاقة واختفت حدوده تماماً.
   *
   * لذلك نضبط درجة اللون حتى يفصله عن خلفية البطاقة تباينٌ لا يقل عن 3،
   * مع الحفاظ على طابع اللون نفسه — ثم نختار لون النص بقياس التباين.
   */
  function cardBackground() {
    return document.body.classList.contains('dark') ? '#26161F' : '#FFFFFF';
  }

  /** خلفية الصفحة — عليها تقع أزرار المناطق ودائرة البحث العائمة */
  function pageBackground() {
    return document.body.classList.contains('dark') ? '#170D14' : '#FFF3F8';
  }

  /**
   * يضبط درجة اللون حتى ينفصل عن الخلفية التي سيقع عليها بتباين لا يقل عن 3،
   * ثم يختار لون النص المناسب. الخلفية تُمرَّر كمعامل لأن العناصر تختلف:
   * زر تسجيل الزيارة داخل بطاقة، وأزرار المناطق ودائرة البحث على الصفحة.
   */
  function ensureContrastOn(hex, bg) {
    var bgIsLight = luminance(bg) > 0.5;
    var color = hex;

    for (var i = 0; i < 14 && contrastWith(color, bg) < 3; i++) {
      // نبتعد عن لون الخلفية: نُغمّق فوق الفاتح، ونُفتّح فوق الداكن
      color = shadeHex(color, bgIsLight ? -0.08 : 0.08);
    }

    var safe = ensureReadable(color);
    return { bg: safe.bg, text: safe.text };
  }

  function ensureButtonColor(hex) {
    return ensureContrastOn(hex, cardBackground());
  }

  function setThemeColor(c) {
    var m = document.getElementById('metaTheme');
    if (m) m.setAttribute('content', c);
  }

  function applyRegionColor() {
    var root = document.documentElement;
    var color = state.regionColors && state.regionColors[state.region];

    var clear = function () {
      ['--header-a', '--header-b', '--header-text', '--header-blob', '--header-btn-bg',
       '--header-border', '--accent-a', '--accent-text',
       '--accent-p', '--accent-p-text']
        .forEach(function (p) { root.style.removeProperty(p); });
    };

    if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) { clear(); setThemeColor(document.body.classList.contains('dark') ? '#97123F' : '#C2185B'); return; }

    var safe = ensureReadable(color);
    var light = safe.light;

    root.style.setProperty('--header-a', safe.bg);
    setThemeColor(safe.bg);
    root.style.setProperty('--header-b', shadeHex(safe.bg, -0.28)); // تدرّج أغمق قليلاً
    root.style.setProperty('--header-text', safe.text);
    root.style.setProperty('--header-blob', light ? '#2A1823' : '#FFFFFF');
    root.style.setProperty('--header-btn-bg', light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.16)');
    root.style.setProperty('--header-border', light ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.45)');

    // زر "تسجيل زيارة" — بلون المنطقة أيضاً، بدرجة تضمن وضوحه داخل البطاقة
    var btn = ensureButtonColor(color);
    root.style.setProperty('--accent-a', btn.bg);
    root.style.setProperty('--accent-text', btn.text);

    // أزرار المناطق المفعّلة ودائرة البحث — تقعان على خلفية الصفحة لا البطاقة
    var onPage = ensureContrastOn(color, pageBackground());
    root.style.setProperty('--accent-p', onPage.bg);
    root.style.setProperty('--accent-p-text', onPage.text);
  }

  function enterApp(repName) {
    state.repName = repName;
    el.repNameLabel.textContent = 'مرحباً ' + repName;
    el.loginScreen.style.display = 'none';
    el.appScreen.style.display = 'block';

    restoreFilters(); // يستعيد آخر منطقة/بحث/فلتر حالة كان المندوب قد اختارهم
    el.searchInput.value = state.search || '';
    setFabActive(!!state.search);

    buildStatusFilters();
    loadRegionColors();
    loadRegions(); // سيحمّل الزبائن تلقائياً بعد تحديد المنطقة الافتراضية
    startPolling();
  }

  // ============ تحديث هادئ دوري — لمعرفة زيارات باقي المناديب بسرعة ============
  // يعتمد على نفس الكاش السريع في الخادم (لا يعيد قراءة الشيت بالكامل)، لذلك
  // خفيف جداً على الأداء رغم أنه يعمل كل بضع ثوانٍ.
  var POLL_INTERVAL_MS = 15000; // كل 15 ثانية
  var pollTimer = null;

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (document.visibilityState === 'visible' && state.repName && state.region) {
        silentRefreshCustomers();
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // تحديث فوري بمجرد رجوع المندوب لتبويب/تطبيق كان مغلقاً في الخلفية
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.repName && state.region) {
      silentRefreshCustomers();
    }
  });

  // حارس: يمنع إطلاق طلب جديد بينما هناك طلب لم يرد بعد — بدون هذا الحارس
  // تتراكم الطلبات في طابور الخادم وتُبطئ التطبيق حتى التعليق.
  var refreshInFlight = false;

  // عدّاد الزيارات الجاري إرسالها — أثناء وجودها نوقف كل حركة خلفية
  // (تحديث دوري وتحميل مسبق) حتى لا تصطف الزيارة خلفها فيتأخر تسجيلها.
  var pendingWrites = 0;

  function beginWrite() {
    pendingWrites++;
  }

  function endWrite() {
    pendingWrites = Math.max(0, pendingWrites - 1);
  }

  function silentRefreshCustomers() {
    if (refreshInFlight || pendingWrites > 0) return;
    refreshInFlight = true;
    var requestedRegion = state.region;

    google.script.run
      .withSuccessHandler(function (customers) {
        refreshInFlight = false;
        state.regionCache[requestedRegion] = customers;
        saveRegionToDisk(requestedRegion, customers);
        if (requestedRegion !== state.region) return; // تغيّرت المنطقة أثناء الانتظار

        state.customers = customers;
        indexCustomers(customers);

        // نحافظ على ما عرضه المندوب وعلى موضع تمريره — التحديث في الخلفية
        // يجب أن يكون غير محسوس تماماً
        var keepRendered = renderedCount;
        var scrollY = window.pageYOffset;
        renderFilteredCustomers(keepRendered);
        window.scrollTo(0, scrollY);
      })
      .withFailureHandler(function () {
        refreshInFlight = false;
        // نتجاهل بصمت — سيحاول مجدداً في الدورة القادمة
      })
      .getCustomers(requestedRegion, state.repName);
  }

  // ============ فلتر حالة الزيارة (تمت / لم تتم / لم أجده / لم يسجَّل بعد) ============
  var STATUS_NONE = '__NONE__'; // رمز داخلي يعني "لا توجد زيارة مسجّلة إطلاقاً"

  var STATUS_FILTERS = [
    { value: null, label: 'الكل' },
    { value: 'تمت الزيارة', label: ic('check-circle') + ' تمت' },
    { value: 'لم تتم الزيارة', label: ic('clock') + ' لم تتم' },
    { value: 'لم أجده', label: ic('x-circle') + ' لم يوجد' },
    { value: STATUS_NONE, label: ic('circle-dashed') + ' لم يسجَّل' }
  ];

  function buildStatusFilters() {
    el.statusScroll.innerHTML = '';
    STATUS_FILTERS.forEach(function (item) {
      var pill = document.createElement('button');
      pill.className = 'region-pill' + (state.statusFilter === item.value ? ' active' : '');
      pill.innerHTML = item.label;
      pill.addEventListener('click', function () {
        state.statusFilter = item.value;
        Array.prototype.forEach.call(el.statusScroll.children, function (c) {
          c.classList.remove('active');
        });
        pill.classList.add('active');
        saveFilters();
        renderFilteredCustomers();
      });
      el.statusScroll.appendChild(pill);
    });
  }

  // ============ المناطق (بدون خيار "الكل" — منطقة محددة لكل مندوب) ============
  function loadRegions() {
    google.script.run.withSuccessHandler(function (regions) {
      el.regionScroll.innerHTML = '';

      if (!regions || !regions.length) {
        el.customerList.innerHTML =
          '<div class="empty-state"><span class="big-emoji">' + ic('ban') + '</span>لا توجد منطقة مخصّصة لك بعد — تواصل مع الإدارة.</div>';
        return;
      }

      if (!state.region || regions.indexOf(state.region) === -1) {
        state.region = regions[0]; // اختيار أول منطقة مسموحة تلقائياً
      }

      state.allowedRegions = regions; // نحتفظ بها للتحميل المسبق في الخلفية

      regions.forEach(function (r) {
        var pill = document.createElement('button');
        pill.className = 'region-pill' + (r === state.region ? ' active' : '');
        pill.textContent = r;
        pill.addEventListener('click', function () {
          state.region = r;
          Array.prototype.forEach.call(el.regionScroll.children, function (c) {
            c.classList.remove('active');
          });
          pill.classList.add('active');
          applyRegionColor();
          saveFilters();
          loadCustomers();
        });
        el.regionScroll.appendChild(pill);
      });

      applyRegionColor();
      saveFilters();
      loadCustomers();
      schedulePrefetch();
    }).getRegions(state.repName);
  }

  // ============ خانة البحث: دائرة عائمة قابلة للسحب ============
  var SEARCH_FAB_POS_KEY = 'zc_search_fab_pos';

  function restoreSearchFabPosition() {
    try {
      var saved = JSON.parse(localStorage.getItem(SEARCH_FAB_POS_KEY));
      if (saved && saved.left && saved.top) {
        el.searchFab.style.left = saved.left;
        el.searchFab.style.top = saved.top;
        el.searchFab.style.right = 'auto';
        el.searchFab.style.bottom = 'auto';
        return;
      }
    } catch (e) { /* لا مشكلة، نستعمل الموضع الافتراضي */ }
    el.searchFab.style.right = '20px';
    el.searchFab.style.bottom = 'calc(90px + env(safe-area-inset-bottom, 0px))';
  }
  restoreSearchFabPosition();

  (function enableSearchFabDrag() {
    var dragging = false;
    var moved = false;
    var offsetX = 0;
    var offsetY = 0;

    el.searchFab.addEventListener('pointerdown', function (e) {
      dragging = true;
      moved = false;
      var rect = el.searchFab.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      el.searchFab.setPointerCapture(e.pointerId);
      el.searchFab.classList.add('dragging');
    });

    el.searchFab.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      if (Math.abs(e.movementX) > 2 || Math.abs(e.movementY) > 2) moved = true;
      if (!moved) return;

      var x = e.clientX - offsetX;
      var y = e.clientY - offsetY;
      var maxX = window.innerWidth - el.searchFab.offsetWidth - 6;
      var maxY = window.innerHeight - el.searchFab.offsetHeight - 6;
      x = Math.max(6, Math.min(maxX, x));
      y = Math.max(6, Math.min(maxY, y));

      el.searchFab.style.left = x + 'px';
      el.searchFab.style.top = y + 'px';
      el.searchFab.style.right = 'auto';
      el.searchFab.style.bottom = 'auto';
    });

    el.searchFab.addEventListener('pointerup', function () {
      dragging = false;
      el.searchFab.classList.remove('dragging');
      if (moved) {
        localStorage.setItem(SEARCH_FAB_POS_KEY, JSON.stringify({
          left: el.searchFab.style.left,
          top: el.searchFab.style.top
        }));
      } else if (state.search) {
        clearSearchFilter();
      } else {
        openSearchOverlay();
      }
    });
  })();

  function setFabActive(isActive) {
    el.searchFab.innerHTML = ic(isActive ? 'x' : 'search');
    el.searchFab.classList.toggle('active-filter', isActive);
  }

  function clearSearchFilter() {
    state.search = '';
    el.searchInput.value = '';
    setFabActive(false);
    saveFilters();
    renderFilteredCustomers();
  }

  function commitSearch() {
    var val = el.searchInput.value.trim();
    state.search = val.toLowerCase();
    saveFilters();
    renderFilteredCustomers();
    closeSearchOverlay();
    setFabActive(!!val);
  }

  function positionSearchOverlay() {
    var fabRect = el.searchFab.getBoundingClientRect();
    var panelWidth = Math.min(240, window.innerWidth - fabRect.width - 30);
    var gap = 10;

    var top = fabRect.top + fabRect.height / 2 - 22;
    top = Math.max(8, Math.min(window.innerHeight - 52, top));

    var spaceLeft = fabRect.left;
    var spaceRight = window.innerWidth - fabRect.right;
    var left, origin;

    if (spaceLeft >= spaceRight) {
      left = fabRect.left - panelWidth - gap;
      origin = 'center right';
    } else {
      left = fabRect.right + gap;
      origin = 'center left';
    }
    left = Math.max(8, Math.min(window.innerWidth - panelWidth - 8, left));

    el.searchOverlay.style.width = panelWidth + 'px';
    el.searchOverlay.style.left = left + 'px';
    el.searchOverlay.style.top = top + 'px';
    el.searchOverlay.style.bottom = 'auto';
    el.searchOverlay.style.transformOrigin = origin;
  }

  function openSearchOverlay() {
    positionSearchOverlay();
    el.searchOverlay.classList.add('open');
    el.searchInput.focus();
  }

  function closeSearchOverlay() {
    el.searchOverlay.classList.remove('open');
  }

  el.searchCloseBtn.addEventListener('click', function () {
    closeSearchOverlay();
    el.searchInput.value = '';
    state.search = '';
    setFabActive(false);
    saveFilters();
    renderFilteredCustomers();
  });

  el.searchInput.addEventListener('change', commitSearch);
  el.searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitSearch();
    }
  });

  // ============ البحث (فلترة محلية فقط — بدون طلب جديد للخادم) ============
  el.searchInput.addEventListener('input', function () {
    clearTimeout(searchDebounce);
    var val = el.searchInput.value;
    searchDebounce = setTimeout(function () {
      state.search = val.trim().toLowerCase();
      renderFilteredCustomers();
    }, 120);
  });

  function populateNameSuggestions(customers) {
    if (!el.nameSuggestions) return;
    el.nameSuggestions.innerHTML = '';
    var seen = {};
    customers.forEach(function (c) {
      [c.wilaya, c.city].forEach(function (v) {
        var val = String(v || '').trim();
        if (!val || seen[val]) return;
        seen[val] = true;
        var opt = document.createElement('option');
        opt.value = val;
        el.nameSuggestions.appendChild(opt);
      });
    });
  }

  // ============ تحميل الزبائن ============
  function loadCustomers() {
    var requestedRegion = state.region;

    // نبحث عن نسخة جاهزة: أولاً في ذاكرة الجلسة، ثم في ذاكرة الهاتف الدائمة
    var cached = state.regionCache[requestedRegion] || readRegionFromDisk(requestedRegion);

    if (cached && cached.length) {
      // ✅ عرض فوري بلا أي رسالة تحميل — ثم تحديث صامت في الخلفية
      state.regionCache[requestedRegion] = cached;
      state.customers = cached;
      indexCustomers(cached);
      populateNameSuggestions(cached);
      renderFilteredCustomers();
      silentRefreshCustomers();
      return;
    }

    // لا توجد نسخة محفوظة إطلاقاً (أول استعمال فقط) — هنا وحدها نُظهر التحميل
    el.customerList.innerHTML =
      '<div class="empty-state">جاري تحضير قائمتك لأول مرة<span class="loading-dots"></span></div>';
    refreshInFlight = true;

    google.script.run
      .withSuccessHandler(function (customers) {
        refreshInFlight = false;
        state.regionCache[requestedRegion] = customers;
        saveRegionToDisk(requestedRegion, customers);
        if (requestedRegion !== state.region) return; // بدّل المندوب المنطقة أثناء الانتظار

        state.customers = customers;
        indexCustomers(customers);
        populateNameSuggestions(customers);
        renderFilteredCustomers();
        schedulePrefetch();
      })
      .withFailureHandler(function () {
        refreshInFlight = false;
        if (requestedRegion !== state.region) return;
        el.customerList.innerHTML = '<div class="empty-state">تعذّر تحميل البيانات، تحقّق من الاتصال وحاول مجدداً.</div>';
      })
      .getCustomers(requestedRegion, state.repName);
  }

  /**
   * ============ حفظ المناطق في ذاكرة الهاتف الدائمة ============
   * الفرق الجوهري: ذاكرة الجلسة تُمحى بمجرد إغلاق التطبيق، أما هذه فتبقى.
   * لذلك عند فتح التطبيق في المرة القادمة تظهر القائمة **فوراً** بلا انتظار
   * ولا رسالة تحميل، ثم تُحدَّث بصمت من الشيت خلال ثوانٍ.
   */
  var REGION_DISK_PREFIX = 'zc_region_';

  function saveRegionToDisk(region, customers) {
    try {
      localStorage.setItem(REGION_DISK_PREFIX + region, JSON.stringify(customers));
    } catch (e) {
      // امتلأت ذاكرة الهاتف — نُفرغ نسخ المناطق القديمة ونحاول مرة واحدة
      try {
        clearRegionDisk();
        localStorage.setItem(REGION_DISK_PREFIX + region, JSON.stringify(customers));
      } catch (e2) { /* لا مشكلة — التطبيق يعمل، فقط بلا عرض فوري */ }
    }
  }

  function readRegionFromDisk(region) {
    try {
      var raw = localStorage.getItem(REGION_DISK_PREFIX + region);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearRegionDisk() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(REGION_DISK_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* تجاهل */ }
  }

  /**
   * ============ التحميل المسبق للمناطق (صامت تماماً) ============
   * يبدأ **بعد** أن تكون قائمة المندوب أمامه ومستقرّة، فلا يزاحم عمله ولا
   * يظهر له أي مؤشر. يجلب باقي مناطقه ويحفظها في ذاكرة الهاتف، فتصبح جاهزة
   * للعرض الفوري عند التبديل — الآن وفي كل مرة يفتح فيها التطبيق مستقبلاً.
   *
   * نجلبها بالتتابع (لا دفعة واحدة) عمداً: Apps Script ينفّذ الطلبات واحداً
   * تلو الآخر، فإرسالها كلها معاً يصنع طابوراً يُبطئ كل شيء بدل تسريعه.
   */
  var prefetchRunning = false;
  var prefetchTimer = null;

  // نؤخّر البدء عمداً حتى تستقر الشاشة أمام المندوب أولاً
  function schedulePrefetch() {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(prefetchOtherRegions, 4000);
  }

  function prefetchOtherRegions() {
    if (prefetchRunning) return;
    if (!state.allowedRegions || state.allowedRegions.length < 2) return;

    var pending = state.allowedRegions.filter(function (r) {
      return !state.regionCache[r] && !readRegionFromDisk(r);
    });
    if (!pending.length) return;

    prefetchRunning = true;
    fetchNextRegion(pending, 0);
  }

  function fetchNextRegion(list, i) {
    if (i >= list.length) {
      prefetchRunning = false;
      return;
    }

    // لا نزاحم طلباً جارياً ولا زيارة قيد الإرسال — ننتظر قليلاً ونعيد
    if (refreshInFlight || pendingWrites > 0) {
      setTimeout(function () { fetchNextRegion(list, i); }, 1500);
      return;
    }

    var region = list[i];
    refreshInFlight = true;

    google.script.run
      .withSuccessHandler(function (customers) {
        refreshInFlight = false;
        state.regionCache[region] = customers;
        saveRegionToDisk(region, customers);
        setTimeout(function () { fetchNextRegion(list, i + 1); }, 1000);
      })
      .withFailureHandler(function () {
        refreshInFlight = false;
        setTimeout(function () { fetchNextRegion(list, i + 1); }, 1000);
      })
      .getCustomers(region, state.repName);
  }

  function renderFilteredCustomers(minRender) {
    var term = state.search;

    // القائمة بعد فلترة البحث فقط (بدون فلتر الحالة) — أساس حساب العدّاد العام
    var searchFiltered = state.customers.filter(function (c) {
      if (!term) return true;
      var haystack = [c.wilaya, c.city].join(' ').toString().toLowerCase();
      return haystack.indexOf(term) !== -1;
    });

    var list = searchFiltered.filter(function (c) {
      if (!state.statusFilter) return true;
      var currentStatus = c.lastVisit ? c.lastVisit.status : null;
      if (state.statusFilter === STATUS_NONE) return currentStatus === null;
      return currentStatus === state.statusFilter;
    });

    updateStatusCounter(searchFiltered, list);
    renderList(list, minRender);
  }

  var STATUS_COUNTER_LABELS = {
    'تمت الزيارة': 'تمت زيارتهم',
    'لم تتم الزيارة': 'لم تتم زيارتهم',
    'لم أجده': 'لم يتم إيجادهم'
  };
  STATUS_COUNTER_LABELS[STATUS_NONE] = 'لم يسجَّلوا بعد';

  function updateStatusCounter(baseList, filteredList) {
    if (!el.statusCounter) return;

    if (!state.statusFilter) {
      var registered = baseList.filter(function (c) { return !!c.lastVisit; }).length;
      var notRegistered = baseList.length - registered;
      el.statusCounter.textContent = registered + ' تم تسجيلهم — ' + notRegistered + ' لم يُسجَّلوا بعد';
    } else {
      var label = STATUS_COUNTER_LABELS[state.statusFilter] || '';
      el.statusCounter.textContent = filteredList.length + ' زبوناً ' + label;
    }
  }

  function statusInfo(status) {
    if (status === 'تمت الزيارة') return { cls: 'done', label: ic('check') + ' تمت' };
    if (status === 'لم تتم الزيارة') return { cls: 'pending', label: ic('clock') + ' لم تتم' };
    if (status === 'لم أجده') return { cls: 'missing', label: ic('x') + ' لم يوجد' };
    return { cls: 'none', label: 'لا توجد زيارة' };
  }

  // ============ العرض المتدرّج (أهم تحسين للسرعة) ============
  // بدل بناء كل البطاقات دفعة واحدة (وهو ما كان يُجمّد الشاشة عند تغيير
  // الفلتر أو المنطقة في القوائم الكبيرة)، نبني 30 بطاقة فقط، والباقي
  // يُضاف تلقائياً عند التمرير للأسفل أو بالضغط على "عرض المزيد".
  var PAGE_SIZE = 30;
  var currentList = [];
  var renderedCount = 0;

  function renderList(list, minRender) {
    currentList = list;
    renderedCount = 0;
    el.customerList.innerHTML = '';

    if (!list.length) {
      el.customerList.innerHTML =
        '<div class="empty-state"><span class="big-emoji">' + ic('map') + '</span>لا يوجد زبائن مطابقين لهذا البحث/المنطقة.</div>';
      return;
    }

    // minRender: عدد البطاقات التي كانت معروضة قبل التحديث التلقائي — نعيد
    // عرضها كما كانت حتى لا تنكمش القائمة تحت المندوب أثناء تصفّحه.
    var target = Math.max(PAGE_SIZE, minRender || 0);
    while (renderedCount < list.length && renderedCount < target) {
      appendNextPage();
    }
  }

  function appendNextPage() {
    var oldBtn = document.getElementById('loadMoreBtn');
    if (oldBtn && oldBtn.parentNode) oldBtn.parentNode.removeChild(oldBtn);

    // نبني كل الدفعة في الذاكرة أولاً ثم نُدخلها مرة واحدة — أسرع بكثير
    // من إدخال كل بطاقة على حدة (إعادة رسم واحدة بدل ثلاثين)
    var frag = document.createDocumentFragment();
    var end = Math.min(renderedCount + PAGE_SIZE, currentList.length);
    for (var i = renderedCount; i < end; i++) {
      frag.appendChild(buildTicket(currentList[i]));
    }
    el.customerList.appendChild(frag);
    renderedCount = end;

    if (renderedCount < currentList.length) {
      var btn = document.createElement('button');
      btn.id = 'loadMoreBtn';
      btn.className = 'load-more-btn';
      btn.textContent = 'عرض المزيد (' + (currentList.length - renderedCount) + ' متبقٍ)';
      btn.addEventListener('click', appendNextPage);
      el.customerList.appendChild(btn);
    }
  }

  // تحميل تلقائي عند اقتراب المستخدم من نهاية الصفحة
  var scrollTicking = false;
  window.addEventListener('scroll', function () {
    if (scrollTicking) return;
    scrollTicking = true;
    setTimeout(function () {
      scrollTicking = false;
      if (renderedCount >= currentList.length) return;
      if (window.innerHeight + window.pageYOffset >= document.body.offsetHeight - 400) {
        appendNextPage();
      }
    }, 150);
  });

  // ============ مستمع واحد لكل الأزرار (بدل 4 مستمعين لكل بطاقة) ============
  // مع مئات البطاقات كان هذا يعني آلاف المستمعين — مصدر بطء كبير عند العرض.
  el.customerList.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.action-btn') : null;
    if (!btn) return;

    // أزرار الاتصال والخرائط صارت روابط حقيقية (<a>) — نترك المتصفح يفتحها
    // بنفسه ولا نتدخّل إطلاقاً، لأن فتحها بأمر JavaScript يُحجب داخل إطار
    // تطبيقات Apps Script على الهاتف.
    if (btn.tagName === 'A') return;

    var ticketEl = btn.closest('.ticket');
    if (!ticketEl) return;
    var c = state.byCode[ticketEl.dataset.code];
    if (!c) return;

    if (btn.classList.contains('call-btn')) {
      showToast('لا يوجد رقم هاتف مسجّل لهذا الزبون — أبلغ الإدارة لتحديث البيانات.');
    } else if (btn.classList.contains('maps-btn')) {
      showToast('لا يوجد عنوان مسجّل لهذا الزبون — أبلغ الإدارة لتحديث البيانات.');
    } else if (btn.classList.contains('details-btn')) {
      openDetailsModal(c);
    } else if (btn.classList.contains('visit-btn')) {
      openVisitModal(c, ticketEl);
    }
  });

  function buildTicket(c) {
    var wrap = document.createElement('div');
    wrap.className = 'ticket st-' + statusInfo(c.lastVisit ? c.lastVisit.status : null).cls;
    wrap.dataset.code = c.code;

    var info = statusInfo(c.lastVisit ? c.lastVisit.status : null);
    var balanceHigh = Number(c.balance) > BALANCE_ALERT_THRESHOLD;
    var lastVisitLine = c.lastVisit
      ? ('آخر زيارة: ' + c.lastVisit.date + ' — ' + c.lastVisit.status)
      : '';

    var hasPhone = !!c.phone;
    var hasMaps = !!c.mapsLink;

    wrap.innerHTML =
      '<div class="ticket-head">' +
        '<div>' +
          '<h3>' + escapeHtml(c.name) + '</h3>' +
        '</div>' +
        '<span class="status-chip ' + info.cls + '">' + info.label + '</span>' +
      '</div>' +
      '<div class="ticket-meta">' +
        '<div class="meta-line">' + ic('map-pin') + '<span>' + escapeHtml(c.wilaya || '') + ' — ' + escapeHtml(c.city || '') + '</span></div>' +
        '<div class="balance-row">' + ic('wallet') + '<span>الرصيد:</span> <b class="' + (balanceHigh ? 'balance-high' : '') + '">' +
          formatNumber(c.balance) + '</b></div>' +
        (lastVisitLine ? '<div style="font-size:12px;opacity:0.8;">' + lastVisitLine + '</div>' : '') +
      '</div>' +
      '<div class="ticket-actions">' +
        (hasPhone
          ? '<a class="action-btn call-btn" href="tel:' + escapeHtml(c.phone) + '">' + ic('phone') + '<span>اتصال</span></a>'
          : '<button class="action-btn call-btn missing-data">' + ic('phone') + '<span>لا يوجد رقم</span></button>') +
        (hasMaps
          ? '<a class="action-btn maps-btn" href="' + escapeHtml(c.mapsLink) + '">' + ic('map-pin') + '<span>خرائط</span></a>'
          : '<button class="action-btn maps-btn missing-data">' + ic('map-pin') + '<span>لا يوجد عنوان</span></button>') +
        '<button class="action-btn details-btn">' + ic('info') + '<span>تفاصيل</span></button>' +
      '</div>' +
      '<div class="ticket-actions">' +
        '<button class="action-btn primary visit-btn" style="width:100%">' + ic('check-circle') + '<span>تسجيل زيارة</span></button>' +
      '</div>';

    return wrap;
  }

  // ============ نافذة التفاصيل ============
  function openDetailsModal(c) {
    el.detailsCustomerName.textContent = c.name;
    el.detailsBody.innerHTML =
      detailRow('الهاتف', c.phone || '—') +
      detailRow('العنوان', c.address || '—') +
      detailRow('الرصيد', formatNumber(c.balance)) +
      detailRow('تاريخ آخر دفع', c.lastPayDate || '—') +
      detailRow('قيمة آخر دفع', formatNumber(c.lastPayAmount)) +
      detailRow('تاريخ أول فاتورة غير مسددة', c.firstUnpaidDate || '—');
    el.detailsModal.classList.add('open');
  }

  function detailRow(label, value) {
    return '<div class="detail-row"><span>' + escapeHtml(label) + '</span><b>' + escapeHtml(value) + '</b></div>';
  }

  el.detailsClose.addEventListener('click', function () {
    el.detailsModal.classList.remove('open');
  });
  el.detailsModal.addEventListener('click', function (e) {
    if (e.target === el.detailsModal) el.detailsModal.classList.remove('open');
  });

  // ============ نافذة تسجيل الزيارة ============
  function openVisitModal(customer, ticketEl) {
    activeCustomerForModal = { customer: customer, ticketEl: ticketEl };
    el.modalCustomerName.textContent = customer.name;
    el.visitModal.classList.add('open');
  }

  function closeVisitModal() {
    el.visitModal.classList.remove('open');
    activeCustomerForModal = null;
  }

  el.modalCancel.addEventListener('click', closeVisitModal);
  el.visitModal.addEventListener('click', function (e) {
    if (e.target === el.visitModal) closeVisitModal();
  });

  Array.prototype.forEach.call(document.querySelectorAll('.status-option'), function (btn) {
    btn.addEventListener('click', function () {
      if (!activeCustomerForModal) return;
      var status = btn.dataset.status;
      var customer = activeCustomerForModal.customer;
      var ticketEl = activeCustomerForModal.ticketEl;

      // تحديث فوري في الواجهة، بدون انتظار رد الخادم
      markTicketDone(ticketEl, status);
      updateLocalVisit(customer, status);
      feedback(status); // اهتزاز + نغمة فوراً، فيعرف المندوب أن الضغطة سُجّلت بلا نظر
      closeVisitModal();

      var previous = lastLoggedRow[customer.code];
      var isCorrection = previous && previous.repName === state.repName;

      if (!navigator.onLine) {
        // بدون اتصال: نضيف دائماً سطراً جديداً (لا نخاطر بمحاولة تصحيح صف
        // محدد بينما لا نستطيع التأكد من حالته الحالية على الخادم)
        queueVisit({
          code: customer.code,
          name: customer.name,
          region: customer.region,
          status: status,
          repName: state.repName
        });
        feedback('error');
        showToast('لا يوجد اتصال — تم حفظ الزيارة، ستُرسل تلقائياً عند عودة النت.');
        return;
      }

      beginWrite();

      if (isCorrection) {
        // تصحيح: نعدّل نفس السطر بدل إضافة سطر جديد
        google.script.run
          .withSuccessHandler(function (res) {
            endWrite();
            showToast('تم تصحيح الزيارة إلى: ' + status);
          })
          .withFailureHandler(function () {
            endWrite();
            feedback('error');
            showToast('تعذّر التصحيح، حاول مجدداً.');
          })
          .correctVisit(previous.row, customer.code, customer.name, customer.region, status, state.repName);
      } else {
        google.script.run
          .withSuccessHandler(function (res) {
            endWrite();
            lastLoggedRow[customer.code] = { row: res.row, repName: state.repName };
            showToast('تم تسجيل: ' + status + ' — ' + customer.name);
          })
          .withFailureHandler(function () {
            endWrite();
            queueVisit({
              code: customer.code,
              name: customer.name,
              region: customer.region,
              status: status,
              repName: state.repName
            });
            feedback('error');
            showToast('تعذّر الإرسال الآن — تم حفظها وستُرسل تلقائياً لاحقاً.');
          })
          .logVisit(customer.code, customer.name, customer.region, status, state.repName);
      }
    });
  });

  function markTicketDone(ticketEl, status) {
    var chip = ticketEl.querySelector('.status-chip');
    var info = statusInfo(status);
    chip.className = 'status-chip ' + info.cls;
    chip.innerHTML = info.label;
    ticketEl.className = ticketEl.className.replace(/\bst-\w+/g, '').trim() + ' st-' + info.cls;
  }

  /**
   * يُحدّث بيانات الزبون محلياً فور تسجيل الزيارة، حتى يعكس العدّاد الحالة
   * الجديدة مباشرة دون انتظار الخادم. لا نُعيد بناء القائمة كاملة عمداً حتى
   * لا تختفي البطاقة من تحت إصبع المندوب أثناء عمله (خصوصاً في فلتر
   * "لم يسجَّل") — القائمة تنضبط تلقائياً في التحديث الدوري التالي.
   */
  function updateLocalVisit(customer, status) {
    var today = new Date();
    var dd = ('0' + today.getDate()).slice(-2);
    var mm = ('0' + (today.getMonth() + 1)).slice(-2);

    customer.lastVisit = {
      rawDate: today.getTime(),
      date: dd + '/' + mm + '/' + today.getFullYear(),
      status: status,
      rep: state.repName
    };

    // تحديث العدّاد فقط (بدون إعادة رسم البطاقات)
    var term = state.search;
    var searchFiltered = state.customers.filter(function (c) {
      if (!term) return true;
      var haystack = [c.wilaya, c.city].join(' ').toString().toLowerCase();
      return haystack.indexOf(term) !== -1;
    });
    var filtered = searchFiltered.filter(function (c) {
      if (!state.statusFilter) return true;
      var s = c.lastVisit ? c.lastVisit.status : null;
      if (state.statusFilter === STATUS_NONE) return s === null;
      return s === state.statusFilter;
    });
    updateStatusCounter(searchFiltered, filtered);
  }

  // ============ قائمة الانتظار عند انقطاع النت ============
  function getQueue() {
    try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY)) || []; }
    catch (e) { return []; }
  }

  function saveQueue(q) {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
    updateQueueBadge();
  }

  function queueVisit(payload) {
    var q = getQueue();
    q.push(payload);
    saveQueue(q);
  }

  function updateQueueBadge() {
    if (!el.pendingBadge || !el.pendingStrip) return;
    var count = getQueue().length;
    if (count > 0) {
      el.pendingStrip.style.display = 'flex';
      el.pendingBadge.innerHTML = ic('refresh') + ' ' + count + ' بانتظار الإرسال';
    } else {
      el.pendingStrip.style.display = 'none';
    }
  }

  function flushQueue() {
    var q = getQueue();
    if (!q.length) return;

    var remaining = [];
    processQueueItem(q, 0, remaining);
  }

  function processQueueItem(q, i, remaining) {
    if (i >= q.length) {
      saveQueue(remaining);
      if (remaining.length === 0) showToast('تم إرسال جميع الزيارات المحفوظة');
      return;
    }
    var item = q[i];
    google.script.run
      .withSuccessHandler(function (res) {
        processQueueItem(q, i + 1, remaining);
      })
      .withFailureHandler(function () {
        remaining.push(item);
        processQueueItem(q, i + 1, remaining);
      })
      .logVisit(item.code, item.name, item.region, item.status, item.repName);
  }

  // ============ Toast ============
  var toastTimer = null;
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove('show');
    }, 3200);
  }

  // ============ أدوات مساعدة ============
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatNumber(n) {
    if (n === null || n === undefined || n === '') return '0';
    var num = Number(n);
    if (isNaN(num)) return String(n);
    return num.toLocaleString('en-US');
  }
