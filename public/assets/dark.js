/* ===== Begemot Numismatics — shared dark theme JS =====
   Load AFTER the Tailwind Play CDN <script> and AFTER lucide.
   Exposes window.DARK with helpers + mountHeader(). */
(function () {
  // --- Tailwind config (Play CDN reads window.tailwind.config) ---
  if (window.tailwind) {
    window.tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace'],
          },
          colors: {
            ink: {
              950: '#070a12', 900: '#0c111d', 850: '#111726', 800: '#161d2e',
              700: '#1f2940', 600: '#2b3650', 500: '#3a4666',
            },
            gold: { 300: '#f6d98a', 400: '#eec05a', 500: '#e0a92e', 600: '#c2891b' },
          },
          boxShadow: { glow: '0 0 0 1px rgba(238,192,90,.12), 0 12px 40px -12px rgba(0,0,0,.7)' },
        },
      },
    };
  }

  // --- Metal & method dictionaries ---
  const METAL = {
    Au:    { label: 'Золото',   dot: 'bg-amber-400',  badge: 'bg-amber-400/15 text-amber-300 border-amber-400/25' },
    Ag:    { label: 'Серебро',  dot: 'bg-slate-300',  badge: 'bg-slate-300/15 text-slate-200 border-slate-300/25' },
    Pd:    { label: 'Палладий', dot: 'bg-sky-300',    badge: 'bg-sky-300/15 text-sky-200 border-sky-300/25' },
    Pt:    { label: 'Платина',  dot: 'bg-teal-200',   badge: 'bg-teal-200/15 text-teal-100 border-teal-200/25' },
    Cu:    { label: 'Медь',     dot: 'bg-orange-400', badge: 'bg-orange-400/15 text-orange-300 border-orange-400/25' },
    Other: { label: 'Другой',   dot: 'bg-slate-500',  badge: 'bg-slate-500/15 text-slate-300 border-slate-500/25' },
  };
  const METHOD = {
    statistical_model: 'Модель',
    statistical_model_relaxed: 'Модель · расшир.',
    single_analog: '1 аналог',
    no_similar: 'Нет аналогов',
  };

  function normMetal(m) {
    if (!m) return 'Other';
    const s = String(m).trim().toLowerCase();
    if (['au', 'золото', 'gold'].includes(s)) return 'Au';
    if (['ag', 'серебро', 'silver'].includes(s)) return 'Ag';
    if (['pd', 'палладий', 'palladium'].includes(s)) return 'Pd';
    if (['pt', 'платина', 'platinum'].includes(s)) return 'Pt';
    if (['cu', 'медь', 'copper', 'бронза', 'bronze', 'латунь'].includes(s)) return 'Cu';
    return 'Other';
  }
  function confTone(c) {
    if (c >= 0.8) return { bar: 'bg-emerald-400', txt: 'text-emerald-300', lbl: 'Высокая' };
    if (c >= 0.6) return { bar: 'bg-amber-400',   txt: 'text-amber-300',  lbl: 'Средняя' };
    return { bar: 'bg-rose-400', txt: 'text-rose-300', lbl: 'Низкая' };
  }

  const _rub = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => (n == null || isNaN(n)) ? '—' : _rub.format(Math.round(n)) + ' ₽';
  const fmtNum = (n) => (n == null || isNaN(n)) ? '—' : _rub.format(Math.round(n));
  function fmtDate(d) {
    if (!d) return '—';
    const x = new Date(d);
    if (isNaN(x)) return '—';
    return x.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // --- Shared sticky header ---
  function mountHeader(activeKey, subtitle) {
    const el = document.getElementById('site-header');
    if (!el) return;
    const links = [
      { key: 'auctions',   href: '/auctions.html',  label: 'Аукционы' },
      { key: 'catalog',    href: '/catalog-coins.html', label: 'Каталог' },
      { key: 'current',    href: '/current.html',   label: 'Текущий' },
      { key: 'search',     href: '/search.html',    label: 'Поиск' },
      { key: 'watchlist',  href: '/watchlist',      label: 'Избранное' },
      { key: 'collection', href: '/collection',     label: 'Коллекция' },
      { key: 'analytics',  href: '/analytics',      label: 'Аналитика' },
    ];
    const nav = links.map((l) => {
      const on = l.key === activeKey;
      return `<a href="${l.href}" class="px-3 py-1.5 rounded-lg ${on ? 'bg-ink-700/70 text-white' : 'text-slate-300 hover:text-white hover:bg-ink-700/60'}">${l.label}</a>`;
    }).join('');
    // мобильное меню: те же ссылки, но блоками во всю ширину (показывается по бургеру ниже md)
    const navMobile = links.map((l) => {
      const on = l.key === activeKey;
      return `<a href="${l.href}" class="block px-3 py-2.5 rounded-lg ${on ? 'bg-ink-700/70 text-white' : 'text-slate-300 hover:text-white hover:bg-ink-700/60'}">${l.label}</a>`;
    }).join('');
    el.className = 'glass sticky top-0 z-30 border-b border-ink-700/70';
    el.innerHTML = `
      <div class="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
        <a href="/auctions.html" class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 grid place-items-center shadow-glow">
            <i data-lucide="coins" class="w-5 h-5 text-ink-950"></i>
          </div>
          <div class="leading-tight">
            <div class="font-extrabold tracking-tight text-white">Begemot<span class="text-gold-400">·</span>Numismatics</div>
            <div class="text-[11px] text-slate-400 -mt-0.5">${subtitle || 'прогноз цен'}</div>
          </div>
        </a>
        <nav class="hidden md:flex items-center gap-1 text-sm">${nav}</nav>
        <div class="flex items-center gap-2">
          <div class="relative hidden sm:block">
            <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"></i>
            <input id="globalSearch" placeholder="Поиск лота…" class="bg-ink-850 border border-ink-700 rounded-lg pl-9 pr-3 py-1.5 text-sm w-44 focus:outline-none focus:border-gold-500/60">
          </div>
          <a href="/admin.html" title="Админка" aria-label="Админка" class="grid place-items-center w-9 h-9 rounded-lg text-slate-500 hover:text-gold-300 hover:bg-ink-700/60 transition-colors">
            <i data-lucide="settings" class="w-4 h-4"></i>
          </a>
          <button id="dhBurger" aria-label="Меню" class="md:hidden grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:text-white hover:bg-ink-700/60 transition-colors">
            <i data-lucide="menu" class="w-5 h-5"></i>
          </button>
        </div>
      </div>
      <nav id="dhMobileNav" class="hidden md:hidden border-t border-ink-700/70 px-3 py-2 flex-col gap-1 text-sm">${navMobile}</nav>`;
    if (window.lucide) window.lucide.createIcons();
    // бургер: показать/скрыть мобильное меню (flex включаем вместо hidden, чтобы flex-col сработал)
    const burger = document.getElementById('dhBurger');
    const mnav = document.getElementById('dhMobileNav');
    if (burger && mnav) burger.addEventListener('click', () => {
      const open = !mnav.classList.contains('hidden');
      mnav.classList.toggle('hidden', open);
      mnav.classList.toggle('flex', !open);
    });
    // Header search → global search page
    const gs = document.getElementById('globalSearch');
    if (gs) gs.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = gs.value.trim();
        window.location.assign('/search.html' + (q ? '?q=' + encodeURIComponent(q) : ''));
      }
    });
  }

  // --- Clickable username → opponent profile ---
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function userLink(login, extraClass) {
    if (!login) return '<span class="text-slate-500">—</span>';
    return `<a href="/user.html?login=${encodeURIComponent(login)}" class="text-gold-300 hover:text-gold-200 hover:underline decoration-dotted underline-offset-2 ${extraClass || ''}">${escHtml(login)}</a>`;
  }

  // --- Risk level → visual tone ---
  function riskTone(level) {
    switch (level) {
      case 'КРИТИЧЕСКИЙ РИСК':
      case 'КРИТИЧЕСКИЙ':     return { txt: 'text-rose-300',    badge: 'bg-rose-500/15 text-rose-300 border-rose-400/30',    dot: 'bg-rose-400' };
      case 'ВЫСОКИЙ РИСК':
      case 'ВЫСОКИЙ':         return { txt: 'text-orange-300',  badge: 'bg-orange-500/15 text-orange-300 border-orange-400/30', dot: 'bg-orange-400' };
      case 'СРЕДНИЙ РИСК':
      case 'ПОДОЗРИТЕЛЬНО':    return { txt: 'text-amber-300',   badge: 'bg-amber-500/15 text-amber-300 border-amber-400/30',  dot: 'bg-amber-400' };
      case 'НИЗКИЙ РИСК':
      case 'ВНИМАНИЕ':         return { txt: 'text-sky-300',     badge: 'bg-sky-500/15 text-sky-300 border-sky-400/30',        dot: 'bg-sky-400' };
      default:                 return { txt: 'text-emerald-300', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30', dot: 'bg-emerald-400' };
    }
  }
  // Короткая подпись уровня риска лота (для компактных бейджей).
  function riskShort(level) {
    return ({ 'КРИТИЧЕСКИЙ РИСК': 'Накрутчик', 'ВЫСОКИЙ РИСК': 'Высокий риск', 'СРЕДНИЙ РИСК': 'Средний риск',
      'НИЗКИЙ РИСК': 'Низкий риск', 'НОРМА': 'Чисто' })[level] || level;
  }

  // --- Watchlist (★ Избранное) -------------------------------------------
  // Один раз грузим весь список избранного в Set, дальше звёзды рисуем по членству.
  const WATCH_SET = new Set();
  let WATCH_READY = false;
  async function loadWatchlistSet() {
    try {
      const r = await fetch('/api/watchlist');
      if (r.ok) { const d = await r.json(); (d.lots || []).forEach((l) => WATCH_SET.add(String(l.id))); }
    } catch (_) { /* избранное опционально */ }
    WATCH_READY = true;
    return WATCH_SET;
  }
  function isWatched(id) { return WATCH_SET.has(String(id)); }
  function starBtnHtml(id) {
    const on = isWatched(id);
    return `<button onclick="DARK.toggleWatch(event, ${id})" data-star="${id}" title="${on ? 'В избранном' : 'В избранное'}"
        class="absolute top-2 right-2 z-10 grid place-items-center w-7 h-7 rounded-lg bg-ink-950/70 border ${on ? 'border-gold-400/50 text-gold-300' : 'border-ink-600 text-slate-400'} hover:text-gold-200 hover:border-gold-400/60 transition">
        <i data-lucide="star" class="w-3.5 h-3.5" ${on ? 'fill="currentColor"' : ''}></i>
      </button>`;
  }
  function refreshStar(id) {
    const btn = document.querySelector(`[data-star="${id}"]`);
    if (!btn) return;
    const on = isWatched(id);
    btn.className = `absolute top-2 right-2 z-10 grid place-items-center w-7 h-7 rounded-lg bg-ink-950/70 border ${on ? 'border-gold-400/50 text-gold-300' : 'border-ink-600 text-slate-400'} hover:text-gold-200 hover:border-gold-400/60 transition`;
    btn.title = on ? 'В избранном' : 'В избранное';
    btn.innerHTML = `<i data-lucide="star" class="w-3.5 h-3.5" ${on ? 'fill="currentColor"' : ''}></i>`;
    if (window.lucide) window.lucide.createIcons();
  }
  async function toggleWatch(ev, id) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    const key = String(id), on = WATCH_SET.has(key);
    if (on) WATCH_SET.delete(key); else WATCH_SET.add(key);   // оптимистично
    refreshStar(id);
    try {
      if (on) await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      else await fetch('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lotId: id }) });
    } catch (_) {
      if (on) WATCH_SET.add(key); else WATCH_SET.delete(key);  // откат
      refreshStar(id);
    }
    document.dispatchEvent(new CustomEvent('watchlist:changed', { detail: { id, watched: !on } }));
  }

  // --- Риск-бейдж рядом с логином (везде во всех формах) ----------------------
  // suspicious_score нормирован 0..100 (F2-модель). Уровень считаем по тем же
  // порогам, что и лот-риск/аналитика: ≥50 крит · ≥35 высокий · ≥20 подозр · >0 внимание.
  function riskLevelFromScore(s) {
    s = Number(s) || 0;
    if (s >= 50) return 'КРИТИЧЕСКИЙ';
    if (s >= 35) return 'ВЫСОКИЙ';
    if (s >= 20) return 'ПОДОЗРИТЕЛЬНО';
    if (s > 0)   return 'ВНИМАНИЕ';
    return 'НОРМА';
  }
  const _RISK_MINI = {
    'КРИТИЧЕСКИЙ':   { cls: 'bg-rose-500/15 text-rose-300 border-rose-400/30' },
    'ВЫСОКИЙ':       { cls: 'bg-orange-500/15 text-orange-300 border-orange-400/30' },
    'ПОДОЗРИТЕЛЬНО': { cls: 'bg-amber-500/15 text-amber-300 border-amber-400/30' },
    'ВНИМАНИЕ':      { cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30' },
    'НОРМА':         { cls: 'bg-emerald-500/10 text-emerald-300/70 border-emerald-400/20' },
  };
  // Минималистичный бейдж: только цвет + число (балл риска). Уровень — в подсказке.
  function riskBadgeHtml(score) {
    const sc = Math.round(Number(score) || 0);
    const lvl = riskLevelFromScore(sc);
    const m = _RISK_MINI[lvl] || _RISK_MINI['НОРМА'];
    return `<span class="risk-badge inline-flex items-center align-middle ml-1 px-1.5 py-px rounded text-[10px] font-semibold border ${m.cls}" title="Риск-балл: ${sc} · ${lvl}">${sc}</span>`;
  }

  // Автогидрация: для КАЖДОЙ ссылки на /user.html?login=… дорисовываем бейдж риска.
  // Покрывает и userLink(), и прямые <a> в любых формах — на всех страницах с dark.js.
  const _RISK_CACHE = new Map();      // login → score
  const _riskQueue = new Set();       // логины, ждущие запроса
  let _riskFlushTimer = null;
  let _riskObsTimer = null;

  function _loginFromAnchor(a) {
    try {
      const u = new URL(a.getAttribute('href'), window.location.origin);
      if (!/\/user\.html$/.test(u.pathname)) return null;
      return u.searchParams.get('login');
    } catch (_) { return null; }
  }
  function _applyBadge(a, score) {
    if (a.dataset.riskDone) return;
    a.dataset.riskDone = '1';
    a.insertAdjacentHTML('afterend', riskBadgeHtml(score));
  }
  function _flushRiskQueue() {
    _riskFlushTimer = null;
    const need = [..._riskQueue].filter((l) => !_RISK_CACHE.has(l));
    _riskQueue.clear();
    if (need.length === 0) { scanUserRiskAnchors(); return; }
    const batches = [];
    for (let i = 0; i < need.length; i += 200) batches.push(need.slice(i, i + 200));
    Promise.all(batches.map((b) =>
      fetch('/api/users-risk-badges?logins=' + encodeURIComponent(b.join(',')))
        .then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    )).then((results) => {
      for (const res of results) for (const k in res) _RISK_CACHE.set(k, res[k]);
      for (const l of need) if (!_RISK_CACHE.has(l)) _RISK_CACHE.set(l, 0); // не найден → чисто
      scanUserRiskAnchors();
    });
  }
  function scanUserRiskAnchors(root) {
    root = root || document.body;
    if (!root) return;
    const anchors = root.querySelectorAll('a[href*="/user.html?login="]:not([data-risk-done])');
    let scheduled = false;
    anchors.forEach((a) => {
      const login = _loginFromAnchor(a);
      if (!login) { a.dataset.riskDone = '1'; return; }
      if (_RISK_CACHE.has(login)) { _applyBadge(a, _RISK_CACHE.get(login)); }
      else { _riskQueue.add(login); scheduled = true; }
    });
    if (scheduled && !_riskFlushTimer) _riskFlushTimer = setTimeout(_flushRiskQueue, 60);
  }
  const _riskObserver = new MutationObserver(() => {
    if (_riskObsTimer) return;
    _riskObsTimer = setTimeout(() => { _riskObsTimer = null; scanUserRiskAnchors(); }, 120);
  });
  function startUserRiskBadges() {
    if (!document.body) return;
    scanUserRiskAnchors();
    _riskObserver.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startUserRiskBadges);
  else startUserRiskBadges();

  window.DARK = { METAL, METHOD, normMetal, confTone, fmt, fmtNum, fmtDate, mountHeader, userLink, escHtml, riskTone, riskShort,
    loadWatchlistSet, isWatched, starBtnHtml, refreshStar, toggleWatch, WATCH_SET,
    riskLevelFromScore, riskBadgeHtml, scanUserRiskAnchors, startUserRiskBadges };
})();
