// Единое определение «текущего аукциона» для всех потребителей (витрина, генератор
// прогнозов, Temporal-воркфлоу).
//
// ⚠️ ГЛАВНАЯ ГОЧА: таблица auction_lots давно перестала быть «только wolmar».
//   • numismat.ru пишет номера с namespace-префиксом ('n1056') — коллизия констрейнта;
//   • маркетплейсы (meshok.net, auction.ru) кладут лоты вообще БЕЗ номера аукциона
//     (auction_number IS NULL), причём с ЖИВЫМИ auction_end_date в будущем.
// Из-за этого наивные запросы ломались молча:
//   • `WHERE auction_end_date > NOW() ORDER BY auction_end_date ASC` возвращал
//     meshok-лот → auction_number = NULL → генератор прогнозов резолвил "null"
//     и обрабатывал 0 лотов (workflow завершался мгновенно, «не запускается»);
//   • `ORDER BY auction_number DESC` по varchar давал 'n99' > '997' > '1015'.
// Поэтому здесь: только wolmar, только чисто числовой номер, сортировка ЧИСЛОМ.
'use strict';

const WOLMAR_AUCTION_SQL = `source_site = 'wolmar.ru' AND auction_number ~ '^[0-9]+$'`;

// db — что угодно с .query() (pg Pool или Client).
// inputNumber — явно запрошенный номер; если у него есть лоты, отдаём его как есть.
async function resolveCurrentAuctionNumber(db, inputNumber = null) {
    if (inputNumber !== null && inputNumber !== undefined && String(inputNumber).trim() !== '') {
        const r = await db.query(
            `SELECT COUNT(*)::int AS c FROM auction_lots WHERE auction_number = $1`,
            [String(inputNumber)]
        );
        if (r.rows[0].c > 0) return String(inputNumber);
    }

    // 1. Идущий аукцион — ближайший по дате окончания из ещё не закрытых.
    const active = await db.query(
        `SELECT auction_number FROM auction_lots
         WHERE ${WOLMAR_AUCTION_SQL} AND auction_end_date > NOW()
         ORDER BY auction_end_date ASC LIMIT 1`
    );
    if (active.rows.length) return String(active.rows[0].auction_number);

    // 2. Идущих нет — берём самый свежий по НОМЕРУ (числовая сортировка).
    const last = await db.query(
        `SELECT auction_number FROM auction_lots
         WHERE ${WOLMAR_AUCTION_SQL}
         ORDER BY auction_number::int DESC LIMIT 1`
    );
    if (last.rows.length) return String(last.rows[0].auction_number);

    return null;
}

module.exports = { resolveCurrentAuctionNumber, WOLMAR_AUCTION_SQL };
