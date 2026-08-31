/**
 * Поиск СМЕШАННЫХ ценовых корзин: тип, к которому привязаны разные монеты.
 *
 * Такой дефект не виден в статистике покрытия — связь есть, она «подтверждена», а монета чужая.
 * Стоит он дорого: на типе «1 рубль 1987» медиана считалась по Циолковскому, и оценка обычной
 * монеты уезжала на 41 %. Нашли тот случай наткнувшись; здесь ищем системно.
 *
 * Признак: в заголовках лотов корзины есть слово, которого НЕТ ни в имени типа, ни в его сюжете,
 * и оно делит корзину на две части с РАЗНОЙ ценой. Слова берём головные (до «|») — это то, как
 * продавец называет монету, а не его проза.
 *
 * Цены сравниваем ВНУТРИ ОДНОГО ГРЕЙДА (директива: кросс-грейд запрещён). Если в одном грейде
 * данных мало, тип пропускаем, а не гадаем.
 *
 *   node catalog/audit-mixed-pools.js [--min-links 6] [--min-ratio 1.5] [--limit N]
 */
const { pool } = require("./db");
const { themeWords, NON_THEME } = require("./coin-matcher");

// Разновидность чекана: другая монета по цене, даже если отдельного типа в каталоге нет.
const VARIETY = /^(новодел|стародел|перечекан|перепутк|копи|реплик|муляж|подделк|пробн|брак|соосност|инкуз|надчекан|рестрайк)/i;

const arg = (name, def) => {
  const i = process.argv.indexOf("--" + name);
  return i > -1 ? Number(process.argv[i + 1]) : def;
};
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

(async () => {
  const MIN_LINKS = arg("min-links", 6);
  const MIN_RATIO = arg("min-ratio", 1.5);
  const LIMIT = arg("limit", 0);
  // Аукционные дома: маркетплейсные цены сюда мешать нельзя (source-aware медианы).
  const ids = (await pool.query(
    `SELECT l.type_id FROM lot_type_link l JOIN auction_lots a ON a.id=l.lot_id
      WHERE a.winning_bid IS NOT NULL AND a.source_site IN ('wolmar.ru','numismat.ru')
        AND a.lot_status <> 'active'
      GROUP BY 1 HAVING count(*) >= $1 ORDER BY count(*) DESC ${LIMIT ? "LIMIT " + LIMIT : ""}`,
    [MIN_LINKS])).rows.map((r) => r.type_id);
  console.log(`типов к проверке: ${ids.length}`);

  const found = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = (await pool.query(
      `SELECT l.type_id, a.coin_description cd, a.winning_bid::float8 price, a.condition,
              c.name_full, coalesce(c.theme_ru,'') th, c.denomination_value dv, c.year, c.era
         FROM lot_type_link l JOIN auction_lots a ON a.id=l.lot_id
         JOIN coin_type c ON c.id=l.type_id
        WHERE l.type_id = ANY($1) AND a.winning_bid IS NOT NULL
          AND a.source_site IN ('wolmar.ru','numismat.ru') AND a.lot_status <> 'active'`,
      [chunk])).rows;
    const byType = new Map();
    for (const r of rows) {
      if (!byType.has(r.type_id)) byType.set(r.type_id, { name: r.name_full, th: r.th, dv: r.dv, year: r.year, era: r.era, lots: [] });
      byType.get(r.type_id).lots.push(r);
    }
    // Слова-соседи: то, чем НАЗЫВАЮТ другие монеты того же номинала и года. Только такое слово
    // опознаёт монету; «в пластиковой капсуле», «лёгкая патина», «близкая к XF» — проза продавца,
    // она тоже коррелирует с ценой, но корзину не смешивает. Перечислять прозу бесполезно —
    // проверяем по самому каталогу.
    const sib = new Map();
    const sibRows = (await pool.query(
      `SELECT c.id, c.denomination_value dv, c.year, c.era, c.name_full, coalesce(c.theme_ru,'') th
         FROM coin_type c
        WHERE (c.denomination_value, c.year, c.era) IN (
          SELECT denomination_value, year, era FROM coin_type WHERE id = ANY($1))
          AND c.denomination_value IS NOT NULL AND c.year IS NOT NULL`, [chunk])).rows;
    for (const r of sibRows) {
      const k = `${r.dv}|${r.year}|${r.era}`;
      if (!sib.has(k)) sib.set(k, []);
      sib.get(k).push(r);
    }
    for (const [tid, t] of byType) {
      // Слова самого типа объяснять не надо.
      const own = new Set(themeWords((t.name || "") + " " + (t.th || "")));
      // Грейд с наибольшим числом проходов: сравнивать цены между грейдами запрещено.
      const byGrade = new Map();
      for (const l of t.lots) {
        const g = String(l.condition || "").trim() || "—";
        if (!byGrade.has(g)) byGrade.set(g, []);
        byGrade.get(g).push(l);
      }
      const [grade, lots] = [...byGrade.entries()].sort((a, b) => b[1].length - a[1].length)[0];
      if (lots.length < 6) continue;
      // Словарь опознающих слов для этой пары номинал+год.
      const self = byType.get(tid);
      const key = `${self.dv}|${self.year}|${self.era}`;
      const ident = new Map();
      for (const r of (sib.get(key) || [])) {
        if (r.id === tid) continue;
        for (const w of themeWords((r.name_full || "") + " " + (r.th || ""))) {
          if (!ident.has(w)) ident.set(w, r);
        }
      }
      const freq = new Map();
      for (const l of lots) {
        const head = String(l.cd || "").split("|")[0];
        for (const w of new Set(themeWords(head))) {
          // Разновидность — тоже другая монета, даже если отдельного типа под неё нет.
          if (own.has(w) || NON_THEME.test(w)) continue;
          if (!ident.has(w) && !VARIETY.test(w)) continue;
          freq.set(w, (freq.get(w) || 0) + 1);
        }
      }
      let worst = null;
      for (const [w, n] of freq) {
        if (n < 3 || n > lots.length - 3) continue;             // делит корзину, а не единичный лот
        const withW = lots.filter((l) => themeWords(String(l.cd).split("|")[0]).includes(w)).map((l) => l.price);
        const without = lots.filter((l) => !themeWords(String(l.cd).split("|")[0]).includes(w)).map((l) => l.price);
        if (withW.length < 3 || without.length < 3) continue;
        const a = median(withW), b = median(without);
        if (!a || !b) continue;
        const ratio = a > b ? a / b : b / a;
        if (ratio < MIN_RATIO) continue;
        const dst = ident.get(w);
        if (!worst || ratio > worst.ratio) worst = { w, ratio, a, b, n: withW.length, m: without.length, dst };
      }
      if (worst) found.push({ tid, name: t.name, grade, lots: lots.length, ...worst });
    }
    if ((i + 200) % 2000 === 0) console.log(`  проверено типов: ${Math.min(i + 200, ids.length)}`);
  }

  found.sort((x, y) => y.ratio * Math.min(y.n, y.m) - x.ratio * Math.min(x.n, x.m));
  console.log(`\nсмешанных корзин: ${found.length}\n`);
  for (const f of found.slice(0, 40)) {
    console.log(`  тип ${String(f.tid).padStart(7)} ${String(f.name).slice(0, 44).padEnd(46)} грейд ${f.grade}`);
    console.log(`      слово «${f.w}»: с ним ${f.n} лотов, медиана ${Math.round(f.a)} ₽ · без него ${f.m}, медиана ${Math.round(f.b)} ₽ · разница ${f.ratio.toFixed(1)}×`);
    console.log(`      опознаёт: ${f.dst ? "тип " + f.dst.id + " «" + String(f.dst.name_full).slice(0, 44) + "»" : "разновидность, отдельного типа нет"}`);
  }
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
