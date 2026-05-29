/**
 * Бэкфилл нумизматических атрибутов (проба, брутто-вес, чистый металл) из
 * уже сохранённых текстовых описаний — БЕЗ повторного парсинга сайта.
 *
 *   node backfill-coin-attributes.js --dry-run [--limit 30]   # показать примеры, ничего не писать
 *   node backfill-coin-attributes.js                          # полный прогон + запись
 *
 * Идемпотентно: колонки создаются через ADD COLUMN IF NOT EXISTS;
 * weight переопределяется как БРУТТО-вес (раньше колонка была неоднозначной).
 */

const { Client } = require('pg');
const config = require('./config');
const { extractCoinAttributes } = require('./coin-attributes');

const DRY = process.argv.includes('--dry-run');
const limArg = process.argv.indexOf('--limit');
const LIMIT = limArg !== -1 ? parseInt(process.argv[limArg + 1], 10) : null;

async function ensureSchema(client) {
    await client.query(`ALTER TABLE auction_lots ADD COLUMN IF NOT EXISTS fineness INTEGER`);
    await client.query(`ALTER TABLE auction_lots ADD COLUMN IF NOT EXISTS pure_metal_weight NUMERIC`);
}

async function run() {
    const client = new Client(config.dbConfig);
    await client.connect();

    if (!DRY) {
        await ensureSchema(client);
        console.log('🧱 Колонки fineness / pure_metal_weight готовы');
    }

    const where = `metal IN ('Au','Ag','Pt','Pd') AND coin_description IS NOT NULL`;
    const limitSql = LIMIT ? `LIMIT ${LIMIT}` : '';
    const { rows } = await client.query(
        `SELECT id, metal, coin_description FROM auction_lots WHERE ${where} ORDER BY id ${limitSql}`
    );
    console.log(`🔎 Лотов к обработке: ${rows.length}${DRY ? ' (dry-run)' : ''}`);

    let updated = 0, gotFineness = 0, gotGross = 0, gotPure = 0, samples = 0;
    for (const r of rows) {
        const a = extractCoinAttributes(r.coin_description, r.metal);
        if (a.fineness != null) gotFineness++;
        if (a.grossWeight != null) gotGross++;
        if (a.pureMetalWeight != null) gotPure++;
        if (a.fineness == null && a.grossWeight == null && a.pureMetalWeight == null) continue;

        if (DRY) {
            if (samples < (LIMIT || 30)) {
                console.log(`\n[id ${r.id} ${r.metal}] проба=${a.fineness} брутто=${a.grossWeight} чистый=${a.pureMetalWeight}`);
                console.log(`   ${r.coin_description.slice(0, 200).replace(/\s+/g, ' ')}`);
                samples++;
            }
            continue;
        }

        await client.query(
            `UPDATE auction_lots SET weight = $1, fineness = $2, pure_metal_weight = $3 WHERE id = $4`,
            [a.grossWeight, a.fineness, a.pureMetalWeight, r.id]
        );
        updated++;
        if (updated % 2000 === 0) console.log(`   ... обновлено ${updated}`);
    }

    console.log(`\n📊 Итог${DRY ? ' (dry-run, без записи)' : ''}:`);
    console.log(`   с пробой:        ${gotFineness}`);
    console.log(`   с брутто-весом:  ${gotGross}`);
    console.log(`   с чистым весом:  ${gotPure}`);
    if (!DRY) console.log(`   обновлено строк: ${updated}`);

    await client.end();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
