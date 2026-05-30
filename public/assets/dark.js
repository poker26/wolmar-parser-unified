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
      { key: 'auctions',  href: '/auctions.html', label: 'Аукционы' },
      { key: 'current',   href: '/current.html',  label: 'Текущий' },
      { key: 'catalog',   href: '/catalog',       label: 'Каталог' },
      { key: 'analytics', href: '/analytics',     label: 'Аналитика' },
    ];
    const nav = links.map((l) => {
      const on = l.key === activeKey;
      return `<a href="${l.href}" class="px-3 py-1.5 rounded-lg ${on ? 'bg-ink-700/70 text-white' : 'text-slate-300 hover:text-white hover:bg-ink-700/60'}">${l.label}</a>`;
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
        </div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
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
      case 'КРИТИЧЕСКИЙ РИСК': return { txt: 'text-rose-300',    badge: 'bg-rose-500/15 text-rose-300 border-rose-400/30',    dot: 'bg-rose-400' };
      case 'ВЫСОКИЙ РИСК':     return { txt: 'text-orange-300',  badge: 'bg-orange-500/15 text-orange-300 border-orange-400/30', dot: 'bg-orange-400' };
      case 'ПОДОЗРИТЕЛЬНО':    return { txt: 'text-amber-300',   badge: 'bg-amber-500/15 text-amber-300 border-amber-400/30',  dot: 'bg-amber-400' };
      case 'ВНИМАНИЕ':         return { txt: 'text-yellow-300',  badge: 'bg-yellow-500/15 text-yellow-200 border-yellow-400/30', dot: 'bg-yellow-400' };
      default:                 return { txt: 'text-emerald-300', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30', dot: 'bg-emerald-400' };
    }
  }

  window.DARK = { METAL, METHOD, normMetal, confTone, fmt, fmtNum, fmtDate, mountHeader, userLink, escHtml, riskTone };
})();
