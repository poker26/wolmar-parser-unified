'use strict';
const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path'); const test=require('node:test');
const {parseTitle}=require('../catalog/coin-matcher'); const p=require('../catalog/collectionmarket-catalog');

test('Collection Market sitemap keeps product priorities and excludes sections',()=>{
    const xml='<url><loc>https://collectionmarket.ru/monety-stran-mira/samoa-25-tsentov-2026</loc><priority>0.8</priority></url><url><loc>https://collectionmarket.ru/tsar/5-kopeek-1861</loc><priority>0.5</priority></url><url><loc>https://collectionmarket.ru/monety-stran-mira</loc><priority>1.0</priority></url>';
    assert.equal(p.parseProductUrls(xml).length,2);
});

test('Collection Market reads identity and original photos but no price',()=>{
    const html=`<link rel="canonical" href="https://collectionmarket.ru/monety-stran-mira/samoa-25-tsentov-2026"><div class="product-page__title"><h1>Самоа 25 центов 2026 года Мохноногий сыч</h1></div><div class="product-page__info"><div class="available">В наличии</div></div><div class="mg-product-slides"><div data-url="https://collectionmarket.ru/uploads/a.webp"></div><div data-url="https://collectionmarket.ru/uploads/b.webp"></div></div><div class="label_monet_status">UNC</div><div class="product-page__char"><ul>${[['Год','2026'],['Тип','Монета юбилейная'],['Страна','Самоа'],['Материал','Медь'],['Номинал','25 центов'],['Вес','47 грамм'],['Диаметр','40 мм'],['Тираж','5.000']].map(([k,v])=>`<li class="prop-item"><span class="prop-name__inner">${k}:</span><span class="prop-spec__inner">${v}</span></li>`).join('')}</ul></div><span class="price">2450</span>`;
    const x=p.parseProduct(html); assert.equal(x.year,2026); assert.equal(x.country,'Самоа'); assert.equal(x.denomination,'25 центов'); assert.equal(x.mintage,5000); assert.equal(x.weightG,47); assert.equal(x.condition,'UNC'); assert.equal(x.attributes.price,undefined); assert.equal(p.usable(x,parseTitle(x.matchTitle)),true);
});

test('Collection Market rejects a set and keeps an old single coin',()=>{
    const x={sourceItemKey:'tsar/5-kopeek-1861',title:'Россия 5 копеек 1861 год',country:'Россия',year:1861,denomination:'5 копеек',aversImageUrl:'a',reversImageUrl:'b',attributes:{Тип:'Монета'}};
    assert.equal(p.usable(x,parseTitle(x.title)),true); assert.equal(p.usable({...x,title:'Набор монет России 1861'},parseTitle('Набор монет России 1861')),false);
});

test('Collection Market migration keeps archived catalog evidence and excludes prices',()=>{
    const sql=fs.readFileSync(path.join(__dirname,'..','migrations','sql','202609050018_collectionmarket_source.sql'),'utf8'); assert.match(sql,/complete old and modern product archive/); assert.match(sql,/price_role='none'/); assert.doesNotMatch(sql,/asking_price|sale_price|winning_bid/i);
});
