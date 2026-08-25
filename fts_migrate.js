const { dbConfig } = require('./config');
const { Client } = require('pg');
(async () => {
  const c = new Client(dbConfig); await c.connect();
  // 1) убедимся, что русский конфиг есть и токенизация работает
  const t = await c.query("SELECT to_tsvector('russian','25 рублей Верди 1999г Au') AS v, websearch_to_tsquery('russian','верди 25 рублей') AS q");
  console.log('tsv  :', t.rows[0].v);
  console.log('query:', t.rows[0].q);
  // 2) функциональный GIN-индекс (без переписывания таблицы, без долгой блокировки)
  console.log('Создаю индекс CONCURRENTLY (может занять 10-40с)…');
  const t0 = Date.now();
  await c.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auction_lots_tsv_ru
                 ON auction_lots USING gin (to_tsvector('russian', coalesce(coin_description,'')))`);
  console.log('Индекс готов за', ((Date.now()-t0)/1000).toFixed(1), 'с');
  await c.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
