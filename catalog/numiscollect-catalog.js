'use strict';
const cheerio = require('cheerio');
const { COUNTRY_RU } = require('./emk-catalog');
const { matcherDenomination } = require('./powercoin-catalog');
const ORIGIN = 'https://shop.numiscollect.eu';
const SOURCE_KEY = 'numiscollect.eu';
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
function absoluteUrl(value, base = ORIGIN) { try { const u = new URL(value, base); if (u.hostname !== 'shop.numiscollect.eu') return null; u.protocol = 'https:'; u.hash = ''; return u.href; } catch (_) { return null; } }
function parseIndex(xml) { return [...String(xml || '').matchAll(/<loc>\s*([^<]+)<\/loc>/gi)].map((m) => absoluteUrl(m[1])).filter((u) => u && /\/product-sitemap\d*\.xml$/.test(new URL(u).pathname)); }
function keyFromUrl(value) { const u = absoluteUrl(value); return u ? new URL(u).pathname.match(/^\/product\/([^/]+)\/$/)?.[1] || null : null; }
function parseProducts(xml) { const out = new Map(); for (const m of String(xml || '').matchAll(/<loc>\s*([^<]+)<\/loc>/gi)) { const sourceUrl = absoluteUrl(m[1]); const sourceItemKey = keyFromUrl(sourceUrl); if (sourceItemKey) out.set(sourceItemKey, { sourceItemKey, sourceUrl }); } return [...out.values()]; }
function table($) { const x = {}; $('#tab-local_1 table tr').each((_, row) => { const c = $(row).children('td'); const k = clean(c.eq(0).text()); const v = clean(c.eq(1).text()); if (k && v && !/price|cost/i.test(k)) x[k] = v; }); return x; }
const numberValue = (v) => { const m = clean(v).replace(',', '.').match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const integerValue = (v) => { const m = clean(v).match(/\d[\d,.\s]*/)?.[0].replace(/[^0-9]/g, ''); return m ? Number(m) : null; };
function parseProduct(html, requestedUrl = ORIGIN) { const $ = cheerio.load(String(html || '')); const sourceUrl = absoluteUrl($('link[rel="canonical"]').attr('href') || requestedUrl); const title = clean($('h1.product_title').first().text()); const a = table($); const country = a['Issuing Country'] || null; const countryRu = COUNTRY_RU.get(country) || country; const denomination = a['Face Value'] || null; const denomRu = matcherDenomination(denomination); const year = /^\d{4}$/.test(a['Year of Issue'] || '') ? Number(a['Year of Issue']) : null; const images = $('.woocommerce-product-gallery__image > a[href]').map((_, e) => absoluteUrl($(e).attr('href'))).get().filter(Boolean); return { sourceKey: SOURCE_KEY, sourceItemKey: keyFromUrl(sourceUrl), sourceUrl, itemStatus: /out-of-stock/i.test($('body').attr('class') || '') ? 'archive' : 'unknown', title, matchTitle: [countryRu, denomRu, year, title].filter(Boolean).join(' '), country, denomination, year, metal: a.Metal || null, weightG: /\bg\b/i.test(a.Weight || '') ? numberValue(a.Weight) : null, diameterMm: numberValue(a.Diameter), mintage: integerValue(a.Mintage), condition: a.Quality || null, themes: [], aversImageUrl: images[0] || null, reversImageUrl: images[1] || null, attributes: { ...a, media_urls: images } }; }
function usable(p, parsed) { return Boolean(p?.sourceItemKey && p?.title && p?.country && p?.year && p?.denomination && p?.aversImageUrl && !parsed.isSet && !parsed.isNonCoin && !/\b(?:medal|bar|banknote|set)\b/i.test(p.title)); }
module.exports = { ORIGIN, SOURCE_KEY, absoluteUrl, keyFromUrl, parseIndex, parseProduct, parseProducts, usable };
