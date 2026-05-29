/**
 * Применение каталога монет: импутация веса/пробы для лотов, где в тексте их нет.
 *
 *   node apply-coin-catalog.js --dry-run   # показать покрытие по номиналам, без записи
 *   node apply-coin-catalog.js             # ALTER + бэкфилл weight_source + импутация
 *
 * Берём ТОЛЬКО высоконадёжные записи каталога (n_samples >= MIN_N и weight_cv <= MAX_CV).
 * Лот заполняется, только если по (номинал, металл) каталог даёт ОДНОЗНАЧНый ответ:
 *   - одна запись на (номинал, металл) → берём её;
 *   - несколько записей (периоды стопы) → нужен год, и он должен попасть РОВНО в один
 *     диапазон; иначе пропускаем (ambiguous), чтобы не угадывать стопу.
 *
 * Никогда не трогаем лоты, где weight уже есть (это 'text'-данные из Phase 1).
 * weight_source маркирует происхождение: 'text' (из описания) | 'catalog' (импутация).
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { extractDenomination } = require('./coin-catalog');

const DRY = process.argv.includes('--dry-run');

// Порог доверия к записи каталога для авто-импутации.
const MIN_N = 10;
const MAX_CV = 0.05;

const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

function loadCatalog() {
    const file = path.join(__dirname, 'coin-catalog-data.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Доверенные записи, сгруппированные по (currency|value|metal).
    // seed:true (эталонные стопы) проходят без порога n/cv.
    const byKey = new Map();
    let total = 0, kept = 0, seeds = 0;
    for (const e of data.entries) {
        total++;
        const trusted = e.seed === true || ((e.n_samples || 0) >= MIN_N && !(e.weight_cv != null && e.weight_cv > MAX_CV));
        if (!trusted) continue;
        kept++; if (e.seed === true) seeds++;
        const key = `${e.currency}|${e.denomination_value}|${e.metal}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(e);
    }
    console.log(`Каталог: ${total} записей всего, ${kept} доверенных (n>=${MIN_N}, cv<=${MAX_CV}; +${seeds} seed), ` +
        `${byKey.size} групп (валюта+номинал+металл)\n`);
    return byKey;
}

/** Извлекает год из начала описания (1700..2030). */
function extractYear(d) {
    const m = String(d).slice(0, 60).match(/\b(1[789]\d{2}|20[0-3]\d)\b/);
    return m ? parseInt(m[1], 10) : null;
}

/**
 * Подбирает запись каталога для лота. Возвращает { entry } | { skip: 'reason' }.
 */
function matchEntry(byKey, currency, value, metal, year) {
    const cands = byKey.get(`${currency}|${value}|${metal}`);
    if (!cands || !cands.length) return { skip: 'no_catalog' };
    if (cands.length === 1) return { entry: cands[0] };

    // Несколько периодов стопы → нужен год, попадающий ровно в один диапазон.
    if (year == null) return { skip: 'ambiguous_no_year' };
    const inRange = cands.filter(e =>
        (e.year_from == null || year >= e.year_from) &&
        (e.year_to == null || year <= e.year_to));
    if (inRange.length === 1) return { entry: inRange[0] };
    if (inRange.length === 0) return { skip: 'year_out_of_range' };
    // Несколько перекрывающихся периодов — берём с наибольшим n_samples только
    // если он явно доминирует, иначе пропускаем.
    inRange.sort((a, b) => b.n_samples - a.n_samples);
    if (inRange[0].n_samples >= inRange[1].n_samples * 3) return { entry: inRange[0] };
    return { skip: 'ambiguous_periods' };
}

async function run() {
    const byKey = loadCatalog();
    const c = new Client(config.dbConfig);
    await c.connect();

    const { rows } = await c.query(`
        SELECT id, metal, year, coin_description d, fineness
        FROM auction_lots
        WHERE metal IN ('Au','Ag','Pt','Pd')
          AND weight IS NULL
          AND coin_description IS NOT NULL`);
    console.log(`Лотов без веса (precious, есть описание): ${rows.length}\n`);

    const plan = [];
    const skipStats = new Map();
    const byLabel = new Map();
    for (const r of rows) {
        const den = extractDenomination(r.d);
        if (!den) { skipStats.set('no_denomination', (skipStats.get('no_denomination') || 0) + 1); continue; }
        const year = r.year && r.year > 1500 && r.year <= 2030 ? r.year : extractYear(r.d);
        const m = matchEntry(byKey, den.currency, den.value, r.metal, year);
        if (m.skip) { skipStats.set(m.skip, (skipStats.get(m.skip) || 0) + 1); continue; }

        const e = m.entry;
        const fin = r.fineness ?? e.fineness ?? null;
        const gross = e.gross_weight;
        const pure = fin ? round(gross * fin / 1000) : null;
        plan.push({ id: r.id, gross, fineness: r.fineness != null ? null : e.fineness, pure, label: den.label, metal: r.metal });

        const lk = `${den.label} ${r.metal}`;
        byLabel.set(lk, (byLabel.get(lk) || 0) + 1);
    }

    console.log(`Будет заполнено: ${plan.length} лотов\n`);
    console.log('Покрытие по номиналам (топ-25):');
    [...byLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
        .forEach(([k, n]) => console.log(`  ${k.padEnd(14)} ${n}`));
    console.log('\nПропущено по причинам:');
    [...skipStats.entries()].sort((a, b) => b[1] - a[1])
        .forEach(([k, n]) => console.log(`  ${k.padEnd(20)} ${n}`));

    if (DRY) {
        console.log('\n(dry-run — БД не изменялась)');
        await c.end();
        return;
    }

    // --- реальный прогон ---
    await c.query(`ALTER TABLE auction_lots ADD COLUMN IF NOT EXISTS weight_source TEXT`);
    const tagged = await c.query(
        `UPDATE auction_lots SET weight_source = 'text'
         WHERE weight IS NOT NULL AND weight_source IS NULL`);
    console.log(`\nweight_source='text' проставлен у ${tagged.rowCount} существующих весов`);

    let done = 0;
    for (const p of plan) {
        // fineness ставим только если у лота его ещё нет; pure считаем по факт. пробе.
        await c.query(
            `UPDATE auction_lots
             SET weight = $1,
                 fineness = COALESCE(fineness, $2),
                 pure_metal_weight = CASE WHEN COALESCE(fineness, $2) IS NOT NULL
                     THEN $1 * COALESCE(fineness, $2)::numeric / 1000 ELSE NULL END,
                 weight_source = 'catalog'
             WHERE id = $3 AND weight IS NULL`,
            [p.gross, p.fineness, p.id]
        );
        if (++done % 5000 === 0) console.log(`  ...${done}/${plan.length}`);
    }
    console.log(`\n✅ Импутировано из каталога: ${done} лотов (weight_source='catalog')`);
    await c.end();
}
run().catch(e => { console.error('❌', e.message); process.exit(1); });
