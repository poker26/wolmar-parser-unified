/** Catalog-only ingestion of old and modern product cards from moneta-mira.ru. */
'use strict';
const {createShopIngester,fetchText}=require('./shop-source-ingester'); const {ORIGIN,SOURCE_KEY,parseCoinUrls,parseProduct,usable}=require('./moneta-mira-catalog');
async function discoverProducts(fetchImpl=fetch){const items=parseCoinUrls(await fetchText(`${ORIGIN}/sitemapyandex.xml`,fetchImpl));if(items.length<2000)throw new Error(`Монета-Мира: найдено только ${items.length} монетных URL`);return{maps:1,items};}
const ingester=createShopIngester({sourceKey:SOURCE_KEY,matchMethod:'moneta-mira-dealer',discoverProducts,parseProduct,isUsableProduct:usable});
if(require.main===module){const args=process.argv.slice(2);const db=args.includes('--dry-run')?null:require('./db').pool;ingester.run(args,db).catch(e=>{console.error('FATAL',e.message);process.exitCode=1;}).finally(()=>db&&db.end());}
module.exports={...ingester,discoverProducts};
