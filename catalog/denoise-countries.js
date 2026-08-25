// Финальная дедупликация/денойз стран foreign (после classify_countries).
// Курированная карта высокой уверенности: варианты-дубли → канон, OCR-битьё → правильное, явный мусор → Other.
// Детерминированно, идемпотентно. Запуск последним в цепочке пересборки foreign.
const { pool } = require("./db");

const OVERRIDES = {
  // Турция (6 написаний)
  "Turkiye": "Turkey", "Türkiye": "Turkey", "Turkiye Cumhur": "Turkey",
  "Turkiye Cumhuriyeti": "Turkey", "Türkiye Cumhuriyeti": "Turkey",
  // Чехия / Чехословакия
  "Ceska Republika": "Czech Republic", "Česká Republika": "Czech Republic",
  "Czech Slovak Federal Republic": "Czech and Slovak Federal Republic",
  "Československá Socialistická Republika": "Czechoslovakia",
  // Тёркс и Кайкос (4)
  "Turks and Caicos": "Turks and Caicos Islands", "Turks & Caicos": "Turks and Caicos Islands",
  "Turks & Caicos Islands": "Turks and Caicos Islands",
  // Тринидад
  "Trinidad & Tobago": "Trinidad and Tobago", "Trinidad": "Trinidad and Tobago",
  // прочие дубли-варианты
  "Curacao": "Curaçao",
  "Cocos Islands": "Cocos (Keeling) Islands",
  "St. Helena": "Saint Helena", "St. Helena Dependency": "St. Helena Dependencies",
  "St. Vincent": "Saint Vincent and the Grenadines",
  "Straits Settlement": "Straits Settlements",
  "Tokelau Islands": "Tokelau", "Tokelau Territory": "Tokelau",
  "China / Peoples Republic": "China",
  "The Republic of China": "Republic of China", "China, Republic of": "Republic of China",
  "Congo Republic": "Republic of the Congo", "Congo, Republic of": "Republic of the Congo",
  "Congo, Democratic Republic": "Democratic Republic of the Congo",
  "Bayern": "Bavaria",
  "Axe-Meiningen": "Saxe-Meiningen",
  "United Arab Emirate": "United Arab Emirates",
  "Tunisie": "Tunisia", "Togolaise": "Togo", "Surinam": "Suriname",
  "Suid-Afrika": "South Africa", "Cabo Verde": "Cape Verde",
  "The Hashemite Kingdom of Jordan": "Jordan",
  "The Bahamas": "Bahamas", "Commonwealth of the Bahamas": "Bahamas",
  "The Gambia": "Gambia", "Cote D'ivoire": "Ivory Coast",
  "Syrian Arab Republic": "Syria", "Commonwealth of Australia": "Australia",
  "Westphalen Fr.Pr.": "Westphalia",
  "British Empire": "United Kingdom", "England": "United Kingdom",
  // город/номинал/администрация → страна
  "Tehran": "Iran", "Budapest": "Hungary", "Greek Administration": "Greece", "Tugrik": "Mongolia",
  // явный мусор (мята/генерик/OCR) → Other
  "British Royal Mint": "Other", "British Overseas Territory": "Other", "British Protectorate": "Other",
  "Central Asia": "Other", "City State": "Other", "Commonwealth": "Other",
  "Commonwealth of Nations": "Other", "Calv": "Other", "Tala": "Other",
};

(async () => {
  const before = (await pool.query("SELECT count(DISTINCT country) c FROM coin_type WHERE era='foreign'")).rows[0].c;
  let moved = 0, hit = 0;
  for (const [from, to] of Object.entries(OVERRIDES)) {
    const r = await pool.query("UPDATE coin_type SET country=$1 WHERE era='foreign' AND country=$2", [to, from]);
    if (r.rowCount) { moved += r.rowCount; hit++; }
  }
  const after = (await pool.query("SELECT count(DISTINCT country) c FROM coin_type WHERE era='foreign'")).rows[0].c;
  console.log(`denoise-стран: применено правил ${hit}/${Object.keys(OVERRIDES).length} | перемещено строк ${moved} | стран ${before} → ${after}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
