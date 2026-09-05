'use strict';
const { createShopIngester, fetchText } = require('./shop-source-ingester');
const { ORIGIN, SOURCE_KEY, parseIndex, parseProduct, parseProducts, usable } = require('./numiscollect-catalog');
async function discoverProducts(fetchImpl = fetch) { const index = await fetchText(`${ORIGIN}/sitemap_index.xml`, fetchImpl); const maps = parseIndex(index); if (maps.length < 5) throw new Error(`NumisCollect: найдено ${maps.length} product sitemap`); const items = new Map(); for (const url of maps) for (const x of parseProducts(await fetchText(url, fetchImpl))) items.set(x.sourceItemKey, x); if (items.size < 1000) throw new Error(`NumisCollect: найдено ${items.size} карточек`); return { maps: maps.length, items: [...items.values()] }; }
const ingester = createShopIngester({ sourceKey: SOURCE_KEY, matchMethod: 'numiscollect-dealer', discoverProducts, parseProduct, isUsableProduct: usable });
if (require.main === module) { const args = process.argv.slice(2); const db = args.includes('--dry-run') ? null : require('./db').pool; ingester.run(args, db).catch((e) => { console.error('FATAL', e.message); process.exitCode = 1; }).finally(() => db && db.end()); }
module.exports = { ...ingester, discoverProducts };
