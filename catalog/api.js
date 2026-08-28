/**
 * Каталог монет — API роутер. Подключение в server.js одной строкой:
 *   require('./catalog/api')(app);
 * Префикс /api/coincat/* (НЕ /api/catalog — там битый легаси). Доступ гейтит nginx mTLS.
 */
const { pool } = require("./db");
const fs = require("fs");

// Дефолтный пользователь коллекции (как resolveCollectionUser в server.js при отсутствии JWT).
const DEFAULT_USER = parseInt(process.env.COLLECTION_DEFAULT_USER_ID || "4", 10);

// MinIO (фото офферов auction.ru в bucket coin-photos/<offer_id>/N.jpg). Креды — общая инфра в /opt/numismatics/.env.
let _mc = null;
function minioClient() {
  if (_mc) return _mc;
  const Minio = require("minio");
  const env = Object.fromEntries(fs.readFileSync("/opt/numismatics/.env", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/\r$/, "").replace(/^["']|["']$/g, "")]; }));
  _mc = new Minio.Client({ endPoint: env.MINIO_ENDPOINT, port: 443, useSSL: true, accessKey: env.MINIO_ACCESS_KEY, secretKey: env.MINIO_SECRET_KEY });
  return _mc;
}

// Официальное фото ЦБ выводится из каталожного номера (проверено: 200, без хотлинка).
const cbrImg = (catNum, rev) => catNum ? `https://www.cbr.ru/legacy/PhotoStore/img/${catNum}${rev ? "r" : ""}.jpg` : null;

// Source-aware: «ценовая» медиана = АУКЦИОННЫЕ дома (wolmar/numismat). Маркетплейсы (auction.ru/meshok) —
// иной уровень цен, НЕ пулим в эту медиану, показываем отдельным срезом. (meshok-харвест не должен сдвигать value.)
const auctionSrc = (a = "al") => `${a}.source_site IN ('wolmar.ru','numismat.ru')`;
const marketSrc = (a = "al") => `${a}.source_site IN ('auction.ru','meshok.net')`;

// Миграция: коллекция должна уметь хранить ТИПЫ каталога (в т.ч. 0-проходные, без лота).
async function ensureCollectionSchema() {
  await pool.query(`ALTER TABLE user_collections ADD COLUMN IF NOT EXISTS type_id INTEGER`);
  await pool.query(`ALTER TABLE user_collections ALTER COLUMN coin_id DROP NOT NULL`).catch(() => {});
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uc_user_type ON user_collections(user_id, type_id) WHERE type_id IS NOT NULL`);
}

// Кэш live-поиска: храним ДОРОГУЮ часть (внешний фетч провайдера) по нормализованному запросу с TTL.
// Матчинг/медиана/дил-сигнал НЕ кэшируем — считаем свежими на каждом запросе.
async function ensureLiveCacheSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS live_search_cache (
    source text NOT NULL, query_norm text NOT NULL, payload jsonb NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (source, query_norm))`);
}
const normQ = (q) => String(q || "").trim().toLowerCase().replace(/\s+/g, " ");
async function getCached(source, q, ttlSec) {
  const r = await pool.query(
    `SELECT payload, extract(epoch from now()-fetched_at)::int age FROM live_search_cache
     WHERE source=$1 AND query_norm=$2 AND fetched_at > now() - ($3||' seconds')::interval`,
    [source, normQ(q), String(ttlSec)]);
  return r.rows[0] || null;
}
async function putCached(source, q, payload) {
  await pool.query(
    `INSERT INTO live_search_cache (source, query_norm, payload, fetched_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (source, query_norm) DO UPDATE SET payload=EXCLUDED.payload, fetched_at=now()`,
    [source, normQ(q), JSON.stringify(payload)]);
}
// Вернуть из кэша (age сек) или сходить fetchFn() и закэшировать. fresh=true обходит кэш. Ошибки НЕ кэшируем.
async function cachedFetch(source, q, ttlSec, fresh, fetchFn) {
  if (!fresh) { const c = await getCached(source, q, ttlSec); if (c) return { data: c.payload, age: c.age }; }
  const data = await fetchFn();
  putCached(source, q, data).catch(() => {});
  return { data, age: 0 };
}

module.exports = function registerCatalog(app) {
  ensureCollectionSchema().catch((e) => console.error("[catalog] ensureCollectionSchema:", e.message));
  ensureLiveCacheSchema().catch((e) => console.error("[catalog] ensureLiveCacheSchema:", e.message));

  // Добавить ТИП каталога в коллекцию (с выбранной сохранностью). Работает и для 0-проходных.
  app.post("/api/coincat/collection/add", async (req, res) => {
    try {
      const typeId = parseInt((req.body && req.body.type_id) || req.query.type_id, 10);
      const condition = ((req.body && req.body.condition) || req.query.condition || "").toString().trim() || null;
      const notes = ((req.body && req.body.notes) || "").toString().trim() || null;
      if (!typeId) return res.status(400).json({ error: "type_id required" });
      const t = await pool.query("SELECT id, name_full FROM coin_type WHERE id = $1", [typeId]);
      if (!t.rows.length) return res.status(404).json({ error: "type not found" });
      await pool.query(
        `INSERT INTO user_collections (user_id, type_id, condition, notes, added_at)
         VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (user_id, type_id) WHERE type_id IS NOT NULL
         DO UPDATE SET condition = EXCLUDED.condition, notes = EXCLUDED.notes`,
        [DEFAULT_USER, typeId, condition, notes]
      );
      res.json({ ok: true, type: t.rows[0].name_full, condition });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Тип-записи коллекции пользователя (для отображения на странице коллекции).
  app.get("/api/coincat/collection", async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT uc.id collection_id, uc.condition, uc.notes, uc.added_at,
               uc.predicted_price, uc.prediction_method, uc.confidence_score,
               ct.id type_id, ct.name_full, ct.year, ct.mint, ct.metal, ct.era, ct.cbr_cat_num,
               (SELECT count(*) FROM lot_type_link l WHERE l.type_id = ct.id) passes,
               (SELECT count(*) FROM lot_type_link l JOIN auction_lots al ON al.id=l.lot_id
                  WHERE l.type_id = ct.id AND al.winning_bid > 0 AND al.condition = uc.condition) passes_grade,
               (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY al.winning_bid))
                  FROM lot_type_link l JOIN auction_lots al ON al.id = l.lot_id
                  WHERE l.type_id = ct.id AND al.winning_bid > 0 AND al.condition = uc.condition) median_grade,
               (SELECT al.avers_image_url FROM lot_type_link l JOIN auction_lots al ON al.id = l.lot_id
                  WHERE l.type_id = ct.id AND al.avers_image_url IS NOT NULL
                  ORDER BY al.auction_end_date DESC NULLS LAST LIMIT 1) sample_av
        FROM user_collections uc JOIN coin_type ct ON ct.id = uc.type_id
        WHERE uc.user_id = $1 AND uc.type_id IS NOT NULL
        ORDER BY uc.added_at DESC`, [DEFAULT_USER]);
      res.json(r.rows.map(x => ({
        ...x,
        median_price: x.median_grade != null ? x.median_grade : null,
        median_basis: x.median_grade != null ? "grade" : "none",
        image: cbrImg(x.cbr_cat_num, true) || x.sample_av || null,
      })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Удалить тип из коллекции.
  app.delete("/api/coincat/collection/:typeId", async (req, res) => {
    try {
      await pool.query("DELETE FROM user_collections WHERE user_id = $1 AND type_id = $2", [DEFAULT_USER, parseInt(req.params.typeId, 10)]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Пересчёт прогноза для ТИП-записей коллекции — тем же движком, что «Избранное»/лоты.
  // Для типа берём представительный реальный проход (лот) + грейд юзера → predictPrice.
  // 0-проходные типы пропускаем (аналогов нет — прогноз не считается, как и просил юзер).
  app.post("/api/coincat/collection/recalc", async (req, res) => {
    const Gen = require("../improved-predictions-generator");
    const gen = new Gen();
    const stat = { updated: 0, skipped_nopass: 0, abstained: 0, errors: 0 };
    try {
      await gen.init();
      const rows = (await pool.query(
        `SELECT uc.id uc_id, uc.type_id, uc.condition FROM user_collections uc
         WHERE uc.user_id = $1 AND uc.type_id IS NOT NULL`, [DEFAULT_USER])).rows;
      for (const e of rows) {
        try {
          const rep = await pool.query(
            `SELECT al.* FROM lot_type_link l JOIN auction_lots al ON al.id = l.lot_id
             WHERE l.type_id = $1 AND al.winning_bid > 0
             ORDER BY al.auction_end_date DESC NULLS LAST LIMIT 1`, [e.type_id]);
          if (!rep.rows.length) { stat.skipped_nopass++; continue; }
          const lot = rep.rows[0];
          if (e.condition) lot.condition = e.condition; // грейд из коллекции
          const p = await gen.predictPrice(lot);
          if (p && p.predicted_price > 0) {
            await pool.query(
              `UPDATE user_collections SET predicted_price=$1, prediction_method=$2, confidence_score=$3, price_calculation_date=now()
               WHERE id=$4`, [p.predicted_price, p.prediction_method, p.confidence_score, e.uc_id]);
            stat.updated++;
          } else { stat.abstained++; }
        } catch (err) { stat.errors++; }
      }
    } catch (e) { return res.status(500).json({ error: e.message }); }
    finally { try { await gen.close(); } catch (_) {} }
    res.json(stat);
  });

  // Общий билдер фильтров для /types и /facets.
  function buildFilters(req) {
    const params = []; const where = [];
    const q = (req.query.q || "").trim();
    if (q) { params.push(`%${q}%`); const p = `$${params.length}`;
      where.push(`(ct.name_full ILIKE ${p} OR ct.cbr_cat_num ILIKE ${p} OR ct.km_number ILIKE ${p} OR ct.theme_ru ILIKE ${p} OR ct.bitkin_number ILIKE ${p} OR ct.uzdenikov_number ILIKE ${p})`); }
    const era = (req.query.era || "").trim();
    if (era === "imperial") where.push("ct.era = 'imperial'");
    else if (era === "foreign") where.push("ct.era = 'foreign'");
    else if (era === "ussr") where.push("ct.era = 'ussr'");
    else if (era === "modern") where.push("ct.era IS DISTINCT FROM 'imperial' AND ct.era IS DISTINCT FROM 'foreign' AND ct.era IS DISTINCT FROM 'ussr'");
    const country = (req.query.country || "").trim();
    if (country) { params.push(country); where.push(`ct.country = $${params.length}`); }
    const metal = (req.query.metal || "").trim();
    if (metal) { params.push(metal); where.push(`ct.metal = $${params.length}`); }
    const yf = parseInt(req.query.year_from, 10), yt = parseInt(req.query.year_to, 10);
    if (yf) { params.push(yf); where.push(`COALESCE(ct.year, ct.year_end) >= $${params.length}`); }
    if (yt) { params.push(yt); where.push(`COALESCE(ct.year, ct.year_start) <= $${params.length}`); }
    if (req.query.theme_only === "1") where.push("ct.theme_ru IS NOT NULL");
    if (req.query.has_passes === "1") where.push("EXISTS (SELECT 1 FROM lot_type_link l WHERE l.type_id = ct.id)");
    if (req.query.both === "1") where.push("ct.ref_issues IS NOT NULL AND EXISTS (SELECT 1 FROM lot_type_link l WHERE l.type_id = ct.id)");
    if (req.query.in_collection === "1") where.push(`EXISTS (SELECT 1 FROM user_collections uc WHERE uc.type_id = ct.id AND uc.user_id = ${DEFAULT_USER})`);
    return { params, clause: where.length ? "WHERE " + where.join(" AND ") : "" };
  }

  // поиск/список типов (фасеты + сортировка + пагинация). Дефолт-сорт: с проходами вперёд.
  app.get("/api/coincat/types", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const { params, clause } = buildFilters(req);
      const SORTS = { passes: "passes DESC, year_start NULLS LAST", year: "COALESCE(year, year_end) DESC NULLS LAST",
                      name: "name_full", price: "COALESCE(auction_med, market_med) DESC NULLS LAST" };
      const order = SORTS[req.query.sort] || SORTS.passes;
      const sql = `
        WITH g AS (
          SELECT ct.id, ct.name_full, ct.year, ct.year_start, ct.year_end, ct.mint, ct.era, ct.cbr_cat_num,
                 ct.country, ct.issuer, ct.metal, ct.km_number, ct.status, ct.theme_ru,
                 ct.denomination_text, ct.rarity, ct.image_url, ct.ref_pdf_src, ct.ref_pdf_page, (ct.ref_issues IS NOT NULL) has_ref,
                 COUNT(l.id)::int passes,
                 (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY al.winning_bid))::int
                    FROM lot_type_link ll JOIN auction_lots al ON al.id = ll.lot_id
                    WHERE ll.type_id = ct.id AND al.winning_bid > 0
                      AND al.lot_status IS DISTINCT FROM 'active' AND ${auctionSrc()}) auction_med,
                 (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY al.winning_bid))::int
                    FROM lot_type_link ll JOIN auction_lots al ON al.id = ll.lot_id
                    WHERE ll.type_id = ct.id AND al.winning_bid > 0
                      AND al.lot_status IS DISTINCT FROM 'active' AND ${marketSrc()}) market_med,
                 (SELECT al.avers_image_url FROM lot_type_link ll JOIN auction_lots al ON al.id = ll.lot_id
                    WHERE ll.type_id = ct.id AND al.avers_image_url IS NOT NULL
                    ORDER BY al.auction_end_date DESC NULLS LAST LIMIT 1) sample_av
          FROM coin_type ct LEFT JOIN lot_type_link l ON l.type_id = ct.id
          ${clause}
          GROUP BY ct.id)
        SELECT *, count(*) OVER()::int total FROM g
        ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
      const r = await pool.query(sql, params);
      res.set("X-Total-Count", String(r.rows.length ? r.rows[0].total : 0));
      const refThumb = (x) => (x.ref_pdf_src && x.ref_pdf_page != null)
        ? `/api/refpage?src=${encodeURIComponent(x.ref_pdf_src)}&page=${x.ref_pdf_page}&dpi=50` : null;
      res.json(r.rows.map(({ total, ...x }) => ({ ...x, thumb: x.sample_av || x.image_url || cbrImg(x.cbr_cat_num, true) || refThumb(x) })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // фасеты под текущий фильтр: металлы(+счётчики) и диапазон годов
  app.get("/api/coincat/facets", async (req, res) => {
    try {
      const { params, clause } = buildFilters(req);
      const metals = await pool.query(
        `SELECT ct.metal, count(*)::int c FROM coin_type ct ${clause} ${clause ? "AND" : "WHERE"} ct.metal IS NOT NULL
         GROUP BY ct.metal ORDER BY c DESC LIMIT 30`, params);
      const yrs = await pool.query(
        `SELECT min(COALESCE(ct.year, ct.year_start))::int ymin, max(COALESCE(ct.year, ct.year_end))::int ymax FROM coin_type ct ${clause}`, params);
      res.json({ metals: metals.rows, years: yrs.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // список стран иностранного раздела (для фильтра на витрине)
  app.get("/api/coincat/countries", async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT ct.country, COUNT(DISTINCT ct.id)::int types, COUNT(l.id)::int passes
        FROM coin_type ct LEFT JOIN lot_type_link l ON l.type_id = ct.id
        WHERE ct.era = 'foreign' AND ct.country IS NOT NULL
        GROUP BY ct.country ORDER BY ct.country`);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // карточка типа: атрибуты + цены по грейдам + последние проходы
  app.get("/api/coincat/type/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const t = await pool.query("SELECT * FROM coin_type WHERE id = $1", [id]);
      if (!t.rows.length) return res.status(404).json({ error: "not found" });
      const gradesSql = (srcPred) => `
        SELECT al.condition grade, COUNT(*)::int n,
               MIN(al.winning_bid)::int lo,
               ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY al.winning_bid))::int med,
               MAX(al.winning_bid)::int hi
        FROM lot_type_link l JOIN auction_lots al ON al.id = l.lot_id
        WHERE l.type_id = $1 AND al.winning_bid > 0 AND al.lot_status IS DISTINCT FROM 'active' AND ${srcPred}
        GROUP BY al.condition ORDER BY med DESC NULLS LAST`;
      const grades = await pool.query(gradesSql(auctionSrc()), [id]);           // аукционные дома (value)
      const marketGrades = await pool.query(gradesSql(marketSrc()), [id]);       // маркетплейсы (отдельно)
      const passes = await pool.query(`
        SELECT al.auction_number, al.lot_number, al.condition, al.winning_bid::int bid, al.source_site,
               al.auction_end_date::date d, al.avers_image_url av, al.revers_image_url rv, al.source_url
        FROM lot_type_link l JOIN auction_lots al ON al.id = l.lot_id
        WHERE l.type_id = $1 AND al.winning_bid > 0 AND al.lot_status IS DISTINCT FROM 'active'
        ORDER BY al.auction_end_date DESC NULLS LAST LIMIT 40`, [id]);
      // «Доступно сейчас» — активные офферы по площадкам (auction.ru/meshok)
      const offers = await pool.query(`
        SELECT al.source_site site, MIN(al.winning_bid)::int price, COUNT(*)::int n,
               (ARRAY_AGG(al.source_url ORDER BY al.winning_bid ASC))[1] url
        FROM lot_type_link l JOIN auction_lots al ON al.id = l.lot_id
        WHERE l.type_id = $1 AND al.lot_status = 'active' AND al.winning_bid > 0
          AND (al.auction_end_date IS NULL OR al.auction_end_date >= now())
        GROUP BY al.source_site ORDER BY price ASC`, [id]);
      const typeRow = { ...t.rows[0] };
      // fcoins is a type/classification source only. Its stale price fields are not public price data.
      delete typeRow.ref_prices;
      delete typeRow.fcoins_price;
      delete typeRow.fcoins_passes;
      typeRow.official_av = cbrImg(typeRow.cbr_cat_num, false) || typeRow.image_url || null;
      typeRow.official_rv = cbrImg(typeRow.cbr_cat_num, true) || typeRow.image_url_rev || null;
      // Каталожная цена Краузе по грейдам (медиана значений по годам) из ref_issues.
      let refByGrade = null;
      const ri = typeRow.ref_issues;
      if (Array.isArray(ri) && ri.length) {
        const byG = {};
        for (const iss of ri) {
          const pr = iss && iss.prices; if (!pr) continue;
          for (const [g, v] of Object.entries(pr)) {
            const num = typeof v === "number" ? v : parseFloat(v);
            if (isFinite(num)) (byG[g] = byG[g] || []).push(num);
          }
        }
        const med = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
        refByGrade = Object.entries(byG).map(([grade, vals]) => ({ grade, usd: Math.round(med(vals) * 100) / 100, n: vals.length }));
      }
      res.json({ type: typeRow, grades: grades.rows, market_grades: marketGrades.rows, passes: passes.rows, ref_by_grade: refByGrade, offers: offers.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // «Где купить / История» (сценарий 2): запрос → типы → активные офферы + история сделок по источникам
  app.get("/api/coincat/where-to-buy", async (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      if (q.length < 3) return res.json({ q, types: [] });
      // Токенизированный матч: каждое значимое слово запроса должно встретиться (name_full|theme_core).
      // Чинит промахи из-за пунктуации/порядка слов («3 рубля луноход» → «3 рубля. Луноход»).
      const toks = q.toLowerCase().split(/[^а-яёa-z0-9]+/i).filter((w) => w.length >= 2).slice(0, 6);
      let types;
      if (toks.length) {
        const cond = toks.map((_, i) => `(name_full ILIKE $${i + 1} OR theme_core ILIKE $${i + 1})`).join(" AND ");
        types = await pool.query(`SELECT id, name_full, country, era, year, image_url FROM coin_type
          WHERE ${cond} ORDER BY length(name_full), id LIMIT 8`, toks.map((w) => `%${w}%`));
      } else {
        types = await pool.query(`SELECT id, name_full, country, era, year, image_url FROM coin_type
          WHERE name_full ILIKE $1 OR theme_core ILIKE $1 ORDER BY length(name_full), id LIMIT 8`, [`%${q}%`]);
      }
      const out = [];
      for (const t of types.rows) {
        const offers = await pool.query(`
          SELECT al.source_site site, MIN(al.winning_bid)::int price, COUNT(*)::int n,
                 (ARRAY_AGG(al.source_url ORDER BY al.winning_bid))[1] url
          FROM lot_type_link l JOIN auction_lots al ON al.id = l.lot_id
          WHERE l.type_id = $1 AND al.lot_status = 'active' AND al.winning_bid > 0
          AND (al.auction_end_date IS NULL OR al.auction_end_date >= now())
          GROUP BY al.source_site ORDER BY price`, [t.id]);
        const passes = await pool.query(`
          SELECT al.source_site site, COUNT(*)::int n,
                 ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY al.winning_bid))::int med,
                 MIN(al.winning_bid)::int lo, MAX(al.winning_bid)::int hi, MAX(al.auction_end_date)::date last
          FROM lot_type_link l JOIN auction_lots al ON al.id = l.lot_id
          WHERE l.type_id = $1 AND al.lot_status IS DISTINCT FROM 'active' AND al.winning_bid > 0
          GROUP BY al.source_site ORDER BY n DESC`, [t.id]);
        out.push({ id: t.id, name_full: t.name_full, country: t.country, era: t.era, year: t.year,
          offers: offers.rows, passes: passes.rows });
      }
      let live = null, liveAge = null;
      if (req.query.live === "1") {
        const port = process.env.LIVE_SEARCH_PORT || "3005";
        const ttl = Math.max(60, parseInt(req.query.ttl, 10) || 1800);
        const fresh = req.query.fresh === "1";
        try {
          const { data, age } = await cachedFetch("auction.ru", q, ttl, fresh, async () => {
            const r = await fetch(`http://127.0.0.1:${port}/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(60000) });
            const d = await r.json();
            if (d.error) throw new Error(d.error);
            return d;
          });
          live = { "auction.ru": data }; liveAge = age;
          // дил-сигнал для auction.ru live (ФИКС-цена → без аукцион-гейта): матч→тип→source-aware медиана→is_deal
          try {
            const { parseTitle, matchType } = require("./coin-matcher");
            for (const o of (data.offers || [])) {
              if (o.price == null) continue;
              const m = await matchType(pool, parseTitle(o.title_ru || o.title || o.slug || ""));
              if (!m) continue;
              o.type_id = m.id;
              const tm = (await pool.query(`SELECT
                (SELECT count(*)::int FROM lot_type_link l JOIN auction_lots al ON al.id=l.lot_id WHERE l.type_id=$1 AND al.winning_bid>0 AND al.lot_status IS DISTINCT FROM 'active' AND ${auctionSrc()}) na,
                (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY al.winning_bid))::int FROM lot_type_link l JOIN auction_lots al ON al.id=l.lot_id WHERE l.type_id=$1 AND al.winning_bid>0 AND al.lot_status IS DISTINCT FROM 'active' AND ${auctionSrc()}) med_a,
                (SELECT count(*)::int FROM lot_type_link l JOIN auction_lots al ON al.id=l.lot_id WHERE l.type_id=$1 AND al.winning_bid>0 AND al.lot_status IS DISTINCT FROM 'active' AND ${marketSrc()}) nm,
                (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY al.winning_bid))::int FROM lot_type_link l JOIN auction_lots al ON al.id=l.lot_id WHERE l.type_id=$1 AND al.winning_bid>0 AND al.lot_status IS DISTINCT FROM 'active' AND ${marketSrc()}) med_m`, [m.id])).rows[0];
              const useA = tm.med_a && tm.na >= 3;
              const med = useA ? tm.med_a : (tm.med_m && tm.nm >= 3 ? tm.med_m : null);
              if (med && o.price > 0) {
                o.ref_median = med; o.ref_passes = useA ? tm.na : tm.nm; o.ref_basis = useA ? "auction" : "market";
                o.ratio = +(med / o.price).toFixed(1);
                o.discount = +(1 - o.price / med).toFixed(3);
                o.is_deal = o.price * 1.4 <= med && o.ratio <= 40;   // фикс-цена → прямой сигнал «дешевле медианы»
              }
            }
          } catch (_) { /* без матча — оффер без сигнала */ }
        } catch (e) { live = { error: "live-search недоступен: " + e.message }; }
      }
      res.json({ q, types: out, live, live_age_sec: liveAge });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Live-поиск meshok.net (отдельной кнопкой — платный Scrapfly). Проксирует к микросервису :3005/msearch.
  // Доп: матчим каждый оффер к каталогу → фото типа (у meshok своих фото нет) + ссылка на карточку.
  app.get("/api/coincat/meshok-search", async (req, res) => {
    const q = (req.query.q || "").trim();
    if (q.length < 2) return res.json({ found: 0, offers: [] });
    const port = process.env.LIVE_SEARCH_PORT || "3005";
    const ttl = Math.max(60, parseInt(req.query.ttl, 10) || 1800);   // кэш TTL по умолчанию 30 мин
    const fresh = req.query.fresh === "1";
    try {
      const { data, age } = await cachedFetch("meshok", q, ttl, fresh, async () => {
        const r = await fetch(`http://127.0.0.1:${port}/msearch?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(75000) });
        const d = await r.json();
        if (d.error) throw new Error(d.error);    // не кэшируем busy/ошибки
        return d;
      });
      const { parseTitle, matchType } = require("./coin-matcher");
      for (const o of (data.offers || [])) {
        try {
          const m = await matchType(pool, parseTitle(o.title || ""));
          if (!m) continue;
          o.type_id = m.id;
          const t = (await pool.query(`SELECT image_url, cbr_cat_num,
            (SELECT s.avers_image_url FROM lot_type_link sll JOIN auction_lots s ON s.id=sll.lot_id
               WHERE sll.type_id=$1 AND s.avers_image_url IS NOT NULL LIMIT 1) sample_av,
            (SELECT count(*)::int FROM lot_type_link l JOIN auction_lots al ON al.id=l.lot_id
               WHERE l.type_id=$1 AND al.winning_bid>0 AND al.lot_status IS DISTINCT FROM 'active' AND ${auctionSrc()}) na,
            (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY al.winning_bid))::int FROM lot_type_link l JOIN auction_lots al ON al.id=l.lot_id
               WHERE l.type_id=$1 AND al.winning_bid>0 AND al.lot_status IS DISTINCT FROM 'active' AND ${auctionSrc()}) med_a,
            (SELECT count(*)::int FROM lot_type_link l JOIN auction_lots al ON al.id=l.lot_id
               WHERE l.type_id=$1 AND al.winning_bid>0 AND al.lot_status IS DISTINCT FROM 'active' AND ${marketSrc()}) nm,
            (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY al.winning_bid))::int FROM lot_type_link l JOIN auction_lots al ON al.id=l.lot_id
               WHERE l.type_id=$1 AND al.winning_bid>0 AND al.lot_status IS DISTINCT FROM 'active' AND ${marketSrc()}) med_m
            FROM coin_type WHERE id=$1`, [m.id])).rows[0];
          if (!t) continue;
          o.photo = t.sample_av || cbrImg(t.cbr_cat_num, true) || t.image_url || null;
          // приоритет аукционного дома (value), маркетплейс — фолбэк (иностранные)
          const useA = t.med_a && t.na >= 3;
          const med = useA ? t.med_a : (t.med_m && t.nm >= 3 ? t.med_m : null);
          const npass = useA ? t.na : t.nm;
          o.ref_basis = useA ? "auction" : "market";
          if (med && o.price > 0) {           // сравнение с медианой проходов (как в deals)
            o.ref_median = med; o.ref_passes = npass;
            o.ratio = +(t.med / o.price).toFixed(1);
            o.discount = +(1 - o.price / t.med).toFixed(3);
            // meshok = аукцион (есть endDate): текущая ставка mid-аукциона ВСЕГДА ниже медианы → не «сделка».
            // Флажим только если аукцион СКОРО закрывается (≤2 дня) и есть реальные ставки; фикс-цена (без end) — сразу.
            o.is_auction = !!o.end;
            let near = true;
            if (o.is_auction) {
              const ms = o.end ? Date.parse(o.end) - Date.now() : Infinity;
              near = ms > 0 && ms < 2 * 86400 * 1000 && (o.bids || 0) >= 2;
            }
            o.is_deal = near && o.price * 1.4 <= med && o.ratio <= 40;
          }
        } catch (_) { /* без матча — без фото/медианы */ }
      }
      res.json({ ...data, cached_age_sec: age });
    } catch (e) { res.status(502).json({ error: "meshok live-поиск недоступен: " + e.message }); }
  });

  // Фото-прокси: стримит coin-photos/<offer>/<idx>.jpg из MinIO (бакет приватный). Только цифры → нет path-traversal.
  app.get("/api/coincat/photo/:offer/:idx", async (req, res) => {
    const offer = String(req.params.offer || "").replace(/[^0-9]/g, "");
    const idx = String(req.params.idx || "0").replace(/[^0-9]/g, "") || "0";
    if (!offer) return res.status(400).end();
    try {
      const stream = await minioClient().getObject("coin-photos", `${offer}/${idx}.jpg`);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=604800");
      stream.on("error", () => { if (!res.headersSent) res.status(404).end(); });
      stream.pipe(res);
    } catch (e) { res.status(404).end(); }
  });

  // Каталожные референс-фото монет (кропы из книг-каталогов, бакет coin-ref-photos, ключ <source>/<name>.jpg).
  // Провенанс: справочное фото тиражной монеты, показывается ФОЛБЭКОМ (аукц.фото приоритетнее). Санитизация обоих сегментов.
  app.get("/api/coincat/refphoto/:src/:name", async (req, res) => {
    const src = String(req.params.src || "").replace(/[^A-Za-z0-9_]/g, "");
    const name = String(req.params.name || "").replace(/[^A-Za-z0-9_.\-]/g, "");
    if (!src || !name) return res.status(400).end();
    try {
      const stream = await minioClient().getObject("coin-ref-photos", `${src}/${name}`);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=604800");
      stream.on("error", () => { if (!res.headersSent) res.status(404).end(); });
      stream.pipe(res);
    } catch (e) { res.status(404).end(); }
  });

  // «Недооценённые сейчас» (комбинированный активный аукцион): активные маркетплейс-офферы (auction.ru/meshok)
  // против медианы состоявшихся сделок. ГЕЙТЫ: только маркетплейс (НЕ wolmar-active = открытые аукционы со
  // старт-ставками); grade-aware (та же condition); кап против абсурдных мисматчей; не-банкнота.
  app.get("/api/coincat/deals", async (req, res) => {
    try {
      const minDisc = Math.max(0, Math.min(0.95, parseFloat(req.query.min_discount) || 0.25));
      const minPasses = Math.max(1, parseInt(req.query.min_passes, 10) || 3);
      const askFloor = Math.max(0, parseInt(req.query.ask_floor, 10) || 200);
      const cap = Math.max(2, parseInt(req.query.cap, 10) || 40);   // ref/ask выше → подозрительный мисматч, не сделка
      const suspect = req.query.suspect === "1";                    // QA-режим: показать ТОЛЬКО подозрительные
      const gradeOnly = req.query.grade_only === "1";               // строго same-grade (без overall-фоллбэка)
      const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 60));
      const { parseTitle } = require("./coin-matcher");

      const rows = (await pool.query(`
        WITH off AS (
          SELECT al.id, al.source_site, al.source_url, al.lot_number, al.winning_bid::int ask,
                 NULLIF(al.condition,'') cond, al.coin_description cd, al.bids_count, al.auction_end_date::date end_date,
                 ar.n_photos, l.type_id, ct.name_full, ct.country, ct.era, ct.year, ct.image_url, ct.cbr_cat_num,
                 (SELECT s.avers_image_url FROM lot_type_link sll JOIN auction_lots s ON s.id = sll.lot_id
                    WHERE sll.type_id = ct.id AND s.avers_image_url IS NOT NULL LIMIT 1) sample_av
          FROM auction_lots al
          JOIN lot_type_link l ON l.lot_id = al.id
          JOIN coin_type ct ON ct.id = l.type_id
          LEFT JOIN auctionru_lots ar ON ar.offer_id::text = al.lot_number
          WHERE al.lot_status='active' AND al.source_site IN ('auction.ru','meshok.net')
            AND (al.auction_end_date IS NULL OR al.auction_end_date >= now())
            AND al.winning_bid >= $1)
        SELECT o.*,
          (SELECT count(*)::int FROM lot_type_link sl JOIN auction_lots s ON s.id=sl.lot_id
             WHERE sl.type_id=o.type_id AND s.lot_status IS DISTINCT FROM 'active' AND s.winning_bid>0 AND ${auctionSrc('s')}) na,
          (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.winning_bid))::int FROM lot_type_link sl JOIN auction_lots s ON s.id=sl.lot_id
             WHERE sl.type_id=o.type_id AND s.lot_status IS DISTINCT FROM 'active' AND s.winning_bid>0 AND ${auctionSrc('s')}) med_a,
          (SELECT count(*)::int FROM lot_type_link sl JOIN auction_lots s ON s.id=sl.lot_id
             WHERE sl.type_id=o.type_id AND s.lot_status IS DISTINCT FROM 'active' AND s.winning_bid>0 AND ${auctionSrc('s')}
               AND upper(replace(s.condition,' ','')) = upper(replace(o.cond,' ',''))) nga,
          (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.winning_bid))::int FROM lot_type_link sl JOIN auction_lots s ON s.id=sl.lot_id
             WHERE sl.type_id=o.type_id AND s.lot_status IS DISTINCT FROM 'active' AND s.winning_bid>0 AND ${auctionSrc('s')}
               AND upper(replace(s.condition,' ','')) = upper(replace(o.cond,' ',''))) med_ga,
          (SELECT count(*)::int FROM lot_type_link sl JOIN auction_lots s ON s.id=sl.lot_id
             WHERE sl.type_id=o.type_id AND s.lot_status IS DISTINCT FROM 'active' AND s.winning_bid>0 AND ${marketSrc('s')}) nm,
          (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.winning_bid))::int FROM lot_type_link sl JOIN auction_lots s ON s.id=sl.lot_id
             WHERE sl.type_id=o.type_id AND s.lot_status IS DISTINCT FROM 'active' AND s.winning_bid>0 AND ${marketSrc('s')}) med_m
        FROM off o`, [askFloor])).rows;

      const deals = [];
      for (const r of rows) {
        if (parseTitle(r.cd || "").isNonCoin) continue;            // не-монета (банкнота и т.п.) — пропуск
        // source-aware приоритет: аукц.дом по грейду → аукц.дом overall → маркетплейс overall (для иностранных, где wolmar пуст)
        let ref = null, npass = 0, basis = null;
        if (r.cond && r.nga >= minPasses && r.med_ga != null) { ref = r.med_ga; npass = r.nga; basis = "grade"; }
        else if (r.na >= minPasses && r.med_a != null) { ref = r.med_a; npass = r.na; basis = "auction"; }
        else if (!gradeOnly && r.nm >= minPasses && r.med_m != null) { ref = r.med_m; npass = r.nm; basis = "market"; }
        if (gradeOnly && basis !== "grade") continue;
        if (!ref || !r.ask) continue;
        const ratio = ref / r.ask;                                  // >1 = ask дешевле медианы
        if (ratio < 1 / (1 - minDisc)) continue;                    // дисконт меньше порога
        const isSuspect = ratio > cap;                              // абсурд → вероятный мисматч/загрязнение медианы
        if (suspect !== isSuspect) continue;                        // обычный режим: только не-suspect; QA: только suspect
        deals.push({
          offer_id: r.id, source: r.source_site, url: r.source_url, ask: r.ask, grade: r.cond,
          type_id: r.type_id, name_full: r.name_full, country: r.country, era: r.era, year: r.year,
          image_url: r.image_url,
          photo: (r.source_site === "auction.ru" && r.n_photos > 0) ? `/api/coincat/photo/${r.lot_number}/0` : null,
          n_photos: r.n_photos > 0 ? r.n_photos : 0, lot_number: r.lot_number,
          // фолбэк-визуал типа (когда у оффера нет фото — напр. meshok): фото прохода wolmar → фото ЦБ → image_url
          type_photo: r.sample_av || cbrImg(r.cbr_cat_num, true) || r.image_url || null,
          description: r.cd,
          ref_median: ref, ref_basis: basis, ref_passes: npass,
          discount: +(1 - r.ask / ref).toFixed(3), ratio: +ratio.toFixed(1),
          // auction.ru active = фикс-аск (купить за ask); meshok active = идущий аукцион (ask = текущая ставка, не фикс-цена)
          kind: r.source_site === "meshok.net" ? "auction" : "ask",
          bids_count: r.bids_count != null ? r.bids_count : null, end_date: r.end_date,
        });
      }
      // фикс-аски (купить сейчас) выше аукционов-в-процессе; внутри — по дисконту
      deals.sort((a, b) => (a.kind === b.kind ? b.discount - a.discount : (a.kind === "ask" ? -1 : 1)));
      res.json({ count: deals.length, params: { minDisc, minPasses, askFloor, cap, suspect, gradeOnly }, deals: deals.slice(0, limit) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
