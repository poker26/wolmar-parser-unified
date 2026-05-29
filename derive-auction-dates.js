/**
 * Восстановление даты окончания аукциона (auction_end_date) для лотов, где её нет.
 *
 * Аукцион Wolmar — однодневное событие: все лоты одного auction_number имеют одну
 * дату (проверено: разброс внутри аукциона = 0 дней). Поэтому определяем ОДНУ дату
 * на номер аукциона из лучшего доступного источника и проставляем её всем лотам
 * этого аукциона, у которых дата пустая (существующие даты не трогаем).
 *
 * Приоритет источников даты аукциона:
 *   1) existing  — уже заполненная auction_end_date (мода/макс внутри аукциона)
 *   2) bids      — МЕДИАНА bid_timestamp из lot_bids (устойчива к редким выбросам)
 *   3) interp    — линейная интерполяция между ближайшими заякоренными аукционами,
 *                  только при адекватном шаге (4..12 дней на номер, разрыв ≤ 3 номера)
 *
 *   node derive-auction-dates.js --dry-run   # показать карту дат и охват, без записи
 *   node derive-auction-dates.js             # проставить даты (только там, где NULL)
 */

const { Client } = require('pg');
const config = require('./config');

const DRY = process.argv.includes('--dry-run');
const END_TIME = 'T10:00:00'; // аукционы Wolmar закрываются ~10:00, как в существующих данных
const fmt = d => d.toISOString().slice(0, 10);

async function run() {
    const client = new Client(config.dbConfig);
    await client.connect();
    await client.query('SET statement_timeout = 180000');

    // 1) existing-дата по аукциону
    const ex = await client.query(`
        SELECT auction_number::int an, MAX(auction_end_date)::date d, COUNT(*) n,
               COUNT(auction_end_date) dated
        FROM auction_lots WHERE auction_number ~ '^[0-9]+$'
        GROUP BY auction_number::int`);

    // 2) медиана bid_timestamp по аукциону
    const bid = await client.query(`
        SELECT auction_number::int an,
               (percentile_disc(0.5) WITHIN GROUP (ORDER BY bid_timestamp))::date d
        FROM lot_bids GROUP BY auction_number::int`);
    const bidMap = new Map(bid.rows.map(r => [r.an, new Date(r.d)]));

    // карта аукционов
    const auctions = new Map(); // an -> { n, existing, bid, date, source }
    for (const r of ex.rows) {
        auctions.set(r.an, {
            an: r.an, n: +r.n,
            existing: r.dated > 0 ? new Date(r.d) : null,
            bid: bidMap.get(r.an) || null,
            date: null, source: null
        });
    }

    // приоритет existing -> bid; валидация расхождений
    const disagreements = [];
    for (const a of auctions.values()) {
        if (a.existing) {
            a.date = a.existing; a.source = 'existing';
            if (a.bid) {
                const diff = Math.abs((a.existing - a.bid) / 86400000);
                if (diff > 3) disagreements.push(`a${a.an}: existing ${fmt(a.existing)} vs bid ${fmt(a.bid)} (Δ${diff.toFixed(0)}d)`);
            }
        } else if (a.bid) {
            a.date = a.bid; a.source = 'bid';
        }
    }

    const sorted = [...auctions.values()].sort((x, y) => x.an - y.an);

    // 2b) коррекция выбросов bid: если дата плотно зажата соседями-якорями
    //     (разрыв ≤ 2 номера с каждой стороны), но выходит за их диапазон —
    //     значит таймстемпы ставок этого аукциона недостоверны → переинтерполируем.
    const anchoredNow = sorted.filter(a => a.date);
    for (const a of sorted) {
        if (a.source !== 'bid') continue;
        const lo = [...anchoredNow].reverse().find(x => x.an < a.an && a.an - x.an <= 2);
        const hi = anchoredNow.find(x => x.an > a.an && x.an - a.an <= 2);
        if (!lo || !hi || !(lo.date < hi.date)) continue;
        const tol = 3 * 86400000;
        if (a.date.getTime() < lo.date.getTime() - tol || a.date.getTime() > hi.date.getTime() + tol) {
            const slopeMs = (hi.date.getTime() - lo.date.getTime()) / (hi.an - lo.an);
            const fixed = new Date(lo.date.getTime() + slopeMs * (a.an - lo.an));
            console.log(`🔧 a${a.an}: bid ${fmt(a.date)} вне [${fmt(lo.date)}..${fmt(hi.date)}] → ${fmt(fixed)}`);
            a.date = fixed; a.source = 'bid-corrected';
        }
    }

    // 3) интерполяция незаякоренных
    const anchored = sorted.filter(a => a.date);
    for (const a of sorted) {
        if (a.date) continue;
        const lo = [...anchored].reverse().find(x => x.an < a.an);
        const hi = anchored.find(x => x.an > a.an);
        if (!lo || !hi) continue;
        const numGap = hi.an - lo.an;
        const dayGap = (hi.date - lo.date) / 86400000;
        const slope = dayGap / numGap; // дней на номер
        if (numGap <= 3 && slope >= 4 && slope <= 12) {
            a.date = new Date(lo.date.getTime() + slope * (a.an - lo.an) * 86400000);
            a.source = 'interp';
        }
    }

    // отчёт + (опц.) запись
    if (disagreements.length) {
        console.log('⚠️ Расхождения existing/bid (>3 дней):');
        disagreements.forEach(s => console.log('   ' + s));
    }

    let willFill = 0, leftNull = 0, auctNull = [];
    const counts = { existing: 0, bid: 0, 'bid-corrected': 0, interp: 0, none: 0 };
    for (const a of sorted) {
        counts[a.source || 'none']++;
        if (!a.date) { leftNull += a.n; auctNull.push(a.an); }
    }

    // точный подсчёт пустых дат на аукцион (для записи) одним запросом
    const nullCounts = await client.query(`
        SELECT auction_number::int an, COUNT(*) c
        FROM auction_lots
        WHERE auction_number ~ '^[0-9]+$' AND auction_end_date IS NULL
        GROUP BY auction_number::int`);
    const nullMap = new Map(nullCounts.rows.map(r => [r.an, +r.c]));

    for (const a of sorted) {
        const toFill = nullMap.get(a.an) || 0;
        const dstr = a.date ? fmt(a.date) : '-';
        console.log(`${a.an} | ${a.n} | ${dstr} | ${a.source || 'NONE'} | ${toFill}`);
        if (a.date && toFill > 0) {
            willFill += toFill;
            if (!DRY) {
                await client.query(
                    `UPDATE auction_lots SET auction_end_date = $1
                     WHERE auction_number = $2 AND auction_end_date IS NULL`,
                    [fmt(a.date) + END_TIME, String(a.an)]
                );
            }
        }
    }

    console.log(`\nИсточники: existing=${counts.existing} bid=${counts.bid} interp=${counts.interp} none=${counts.none}`);
    console.log(`${DRY ? 'Будет заполнено' : 'Заполнено'} дат (строк): ${willFill}`);
    console.log(`Останется без даты: ~${leftNull} лотов в аукционах [${auctNull.join(', ')}]`);

    await client.end();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
