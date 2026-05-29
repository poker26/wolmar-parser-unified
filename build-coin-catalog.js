/**
 * Бутстрап каталога монет из УЖЕ обогащённых лотов (где вес есть из текста).
 *
 *   node build-coin-catalog.js --dry-run   # построить и показать каталог, без записи
 *   node build-coin-catalog.js             # записать в таблицу coin_catalog
 *
 * Группируем precious-монеты по (номинал, металл), внутри группы кластеризуем по
 * весу (кластер = период действия стопы), берём МОДУ веса и пробы и диапазон лет.
 * Записи с малым числом образцов помечаются (n_samples) — на этапе apply к ним
 * доверие ниже.
 */
const { Client } = require('pg');
const config = require('./config');
const { extractDenomination, canonLabel } = require('./coin-catalog');

const DRY = process.argv.includes('--dry-run');

const mode = (arr) => {
    const c = new Map();
    for (const v of arr) if (v != null) c.set(v, (c.get(v) || 0) + 1);
    let best = null, bn = 0;
    for (const [v, n] of c) if (n > bn) { bn = n; best = v; }
    return best;
};
const pct = (arr, p) => {
    const a = arr.filter(x => x != null).sort((x, y) => x - y);
    if (!a.length) return null;
    return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
};
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Кластеризация лотов группы по весу. Возвращает массив кластеров. */
function clusterByWeight(lots) {
    if (lots.length < 8) {
        // мелкая группа — один кластер
        return [makeCluster(lots, mode(lots.map(l => Math.round(l.w * 10) / 10)))];
    }
    const rounded = lots.map(l => Math.round(l.w * 10) / 10);
    const counts = new Map();
    rounded.forEach(w => counts.set(w, (counts.get(w) || 0) + 1));
    const thr = Math.max(4, lots.length * 0.03);
    const peaks = [...counts.entries()].filter(([, n]) => n >= thr).map(([w]) => w).sort((a, b) => a - b);
    if (!peaks.length) return [makeCluster(lots, mode(rounded))];

    // объединяем пики в центры (в пределах 4% относительной разницы)
    const centers = [];
    let span = [peaks[0]];
    for (let i = 1; i < peaks.length; i++) {
        if (Math.abs(peaks[i] - span[span.length - 1]) / span[span.length - 1] <= 0.04) {
            span.push(peaks[i]);
        } else {
            centers.push(pickCenter(span, counts));
            span = [peaks[i]];
        }
    }
    centers.push(pickCenter(span, counts));

    // назначаем каждый лот ближайшему центру (в пределах 8%), иначе — выброс
    const buckets = centers.map(() => []);
    for (const l of lots) {
        let bi = -1, bd = Infinity;
        centers.forEach((c, i) => { const d = Math.abs(l.w - c) / c; if (d < bd) { bd = d; bi = i; } });
        if (bd <= 0.08) buckets[bi].push(l);
    }
    return centers.map((c, i) => makeCluster(buckets[i], c)).filter(Boolean);
}

function pickCenter(span, counts) {
    let best = span[0], bn = 0;
    for (const w of span) { const n = counts.get(w) || 0; if (n > bn) { bn = n; best = w; } }
    return best;
}

function makeCluster(lots, center) {
    if (!lots || !lots.length) return null;
    const years = lots.map(l => l.year).filter(y => y && y > 1500 && y <= 2030);
    const w = mode(lots.map(l => Math.round(l.w * 100) / 100)) ?? center;
    const fineness = mode(lots.map(l => l.fineness));
    const mean = lots.reduce((s, l) => s + l.w, 0) / lots.length;
    const sd = Math.sqrt(lots.reduce((s, l) => s + (l.w - mean) ** 2, 0) / lots.length);
    return {
        gross_weight: w,
        fineness: fineness ?? null,
        pure_weight: fineness ? round(w * fineness / 1000) : null,
        n_samples: lots.length,
        weight_cv: mean ? round(sd / mean, 3) : null,
        year_from: years.length ? pct(years, 0.02) : null,
        year_to: years.length ? pct(years, 0.98) : null,
    };
}

async function run() {
    const c = new Client(config.dbConfig);
    await c.connect();

    const { rows } = await c.query(`
        SELECT metal, year, weight::float w, fineness, coin_description d
        FROM auction_lots
        WHERE metal IN ('Au','Ag','Pt','Pd') AND weight IS NOT NULL AND coin_description IS NOT NULL`);

    // группировка по (currency, value, metal) — currency разделяет рубли и финские марки
    const groups = new Map();
    let skipped = 0;
    for (const r of rows) {
        const den = extractDenomination(r.d);
        if (!den) { skipped++; continue; }
        const key = `${den.currency}|${den.value}|${r.metal}`;
        if (!groups.has(key)) groups.set(key, { value: den.value, currency: den.currency, label: den.label, metal: r.metal, lots: [] });
        groups.get(key).lots.push(r);
    }

    // строим записи каталога
    const entries = [];
    for (const g of groups.values()) {
        for (const cl of clusterByWeight(g.lots)) {
            entries.push({ value: g.value, currency: g.currency, label: g.label, metal: g.metal, ...cl });
        }
    }
    entries.sort((a, b) => b.n_samples - a.n_samples);

    console.log(`Обогащённых лотов: ${rows.length}, без русского номинала (иностр./не монеты): ${skipped}`);
    console.log(`Групп (номинал+металл): ${groups.size}, записей каталога (с учётом периодов стопы): ${entries.length}\n`);
    console.log('номинал | металл | годы | вес(г) | проба | чистый(г) | n | cv');
    for (const e of entries) {
        console.log(
            `${e.label} | ${e.metal} | ${e.year_from ?? '?'}–${e.year_to ?? '?'} | ${e.gross_weight} | ${e.fineness ?? '-'} | ${e.pure_weight ?? '-'} | ${e.n_samples} | ${e.weight_cv ?? '-'}`
        );
    }

    if (DRY) {
        console.log('\n(dry-run — файл каталога не записан)');
        await c.end();
        return;
    }

    // Каталог храним как версионируемый JSON в репозитории: БД-пользователь Supabase
    // не имеет CREATE в схеме public, а файл к тому же удобен для live-парсера и git.
    const fs = require('fs');
    const path = require('path');
    const bootstrapEntries = entries.map(e => ({
        currency: e.currency, denomination_value: e.value, denomination_label: e.label, metal: e.metal,
        year_from: e.year_from, year_to: e.year_to,
        gross_weight: e.gross_weight, fineness: e.fineness, pure_weight: e.pure_weight,
        n_samples: e.n_samples, weight_cv: e.weight_cv, source: 'bootstrap'
    }));

    // Засев эталонных стоп (для типов без текстовых весов — напр. финское серебро).
    // Помечены source:'reference', seed:true → апплай доверяет им без порога n/cv.
    let seedEntries = [];
    const seedFile = path.join(__dirname, 'coin-catalog-seed.json');
    if (fs.existsSync(seedFile)) {
        seedEntries = JSON.parse(fs.readFileSync(seedFile, 'utf8')).entries || [];
        console.log(`Засев из coin-catalog-seed.json: ${seedEntries.length} эталонных записей`);
    }

    const out = {
        generated_at: new Date().toISOString(),
        source: 'bootstrap from auction_lots text-derived weights + reference seed',
        entries: [...bootstrapEntries, ...seedEntries]
    };
    const file = path.join(__dirname, 'coin-catalog-data.json');
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`\n✅ Каталог записан: ${file} (${out.entries.length} записей: ${bootstrapEntries.length} bootstrap + ${seedEntries.length} seed)`);
    await c.end();
}
run().catch(e => { console.error('❌', e.message); process.exit(1); });
