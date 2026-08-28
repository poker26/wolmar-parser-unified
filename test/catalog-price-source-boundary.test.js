const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('catalog UI never presents fcoins values as prices', () => {
  const html = read('public/catalog-coins.html');

  assert.doesNotMatch(html, /Каталог fcoins/i);
  assert.doesNotMatch(html, /type\.ref_prices/);
  assert.match(html, /Каталог Краузе — справочные значения/);
});

test('public catalog API treats fcoins as classification-only', () => {
  const api = read('catalog/api.js');
  const bothFilter = api.match(/if \(req\.query\.both === "1"\).*$/m)?.[0] || '';

  assert.match(bothFilter, /ct\.ref_issues IS NOT NULL/);
  assert.doesNotMatch(bothFilter, /ref_prices/);
  assert.match(api, /delete typeRow\.ref_prices/);
  assert.match(api, /delete typeRow\.fcoins_price/);
});

test('fcoins importers persist type metadata, not source prices', () => {
  const modern = read('catalog/build-skeleton.js');
  const ussr = read('catalog/build-ussr-circ.js');

  assert.doesNotMatch(modern, /fcoins_price\s*:/);
  assert.doesNotMatch(modern, /fcoins_passes\s*:/);
  assert.doesNotMatch(ussr, /ref_prices,ref_source/);
  assert.doesNotMatch(ussr, /Цена:\\s\*/);
});
