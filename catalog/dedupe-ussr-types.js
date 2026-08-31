/**
 * Слияние советских типов, описывающих ОДНУ монету.
 *
 * Каталог СССР собран из двух источников: имена из описаний аукциона (`auction_ussr`) и имена из
 * погодовки (`fcoins_ussr`). Одна и та же монета попала в оба, но названа по-разному —
 * «70 лет Октябрьской революции» и «70 лет Великой Октябрьской социалистической революции».
 * Матчер такую пару различить не может и честно воздерживается, а лоты оседают на тиражном типе.
 *
 * Признак дубля строгий: тот же номинал и год, и слова КОРОТКОГО имени целиком содержатся в
 * длинном. Этого мало для памятных серий ЦБ («Эмблема» против «Талисманы и эмблема» — разные
 * монеты), поэтому правило применяется ТОЛЬКО к эре СССР и только к типам без каталожного номера
 * ЦБ: там номер сам по себе различает монеты, и сливать их нельзя.
 *
 * Разновидности (новодел, стародел, копия, перечекан) не сливаются никогда.
 *
 *   node catalog/dedupe-ussr-types.js [--apply]
 */
const { pool } = require("./db");

const VARIETY = /(?<![а-яё])(новодел|стародел|копи[ияй]|реплик|муляж|подделк|перечекан|рестрайк|restrike|пробн|брак|ошибк|перепутк)/i;
// Уточнение ШТЕМПЕЛЯ, а не сюжета: «Цифры даты тонкие», «Вторые колосья с остями», «Буква Л»,
// «Эталон П-1», «Заготовка». Такие записи — разные монеты по цене, сливать их нельзя, и первый
// же сухой прогон показал, что без этой оговорки правило тащит их в тиражный тип.
const DIE = /(цифр|колось|колось|ост[еий]|герб|букв|эталон|заготовк|сторона|штемпел|(?<![а-яё])шт' + B + '.|вариант|узелк|разновидност|гребенк|лини|уступ|приподн|приспущ|расставл|широк|тонк|узк)/i;
// Часть имени после первой точки: у тиражного типа её нет вовсе.
// Двор в имени — это РАЗНЫЕ монеты: московский и ленинградский чеканы одной олимпийской монеты
// стоят по-разному, и сливать их нельзя (отдельный вопрос модели каталога, а не дублей).
const MINT_IN_NAME = /(?<![А-Яа-яЁё])(ММД|ЛМД|СПМД|без обозначения)/i;
const qual = (n) => { const i = String(n || "").indexOf(". "); return i < 0 ? "" : String(n).slice(i + 2).trim(); };
const words = (s) => [...new Set(String(s || "").toLowerCase().replace(/[^а-яёa-z0-9]+/g, " ")
  .split(" ").filter((w) => w.length >= 4))];
const subset = (a, b) => a.length && a.every((w) => b.some((x) => x.startsWith(w.slice(0, 5))));

(async () => {
  const apply = process.argv.includes("--apply");
  // Год позволяет применить слияние ТОЧЕЧНО: список пар просматривается глазами, и подтверждённые
  // случаи применяются по одному году, а не всем скопом.
  const yi = process.argv.indexOf("--year");
  const onlyYear = yi > -1 ? parseInt(process.argv[yi + 1], 10) : null;
  console.log((apply ? "(APPLY)" : "(сухой прогон)") + (onlyYear ? ` только год ${onlyYear}` : ""));
  const rows = (await pool.query(
    `SELECT id, name_full, denomination_value dv, year, source, cbr_cat_num,
            (SELECT count(*)::int FROM lot_type_link l WHERE l.type_id=coin_type.id) links
       FROM coin_type WHERE era='ussr' AND denomination_value IS NOT NULL AND year IS NOT NULL
         AND cbr_cat_num IS NULL ORDER BY id`)).rows;
  const groups = new Map();
  for (const r of rows) {
    if (VARIETY.test(String(r.name_full || ""))) continue;
    if (onlyYear && r.year !== onlyYear) continue;
    const k = `${r.dv}|${r.year}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  let merged = 0, moved = 0, pairs = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // Пары «короткое имя вложено в длинное». Побеждает тип с бОльшим числом проходов — то же
    // правило, что и при любой другой ничьей: иначе проходы одной монеты растащены по двум карточкам.
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j];
        if (!a.alive && a.alive !== undefined) continue;
        const qa = qual(a.name_full), qb = qual(b.name_full);
        // Сливаем только ИМЕНОВАННЫЕ типы: тиражный тип («20 копеек») не дубль разновидности.
        if (!qa || !qb || DIE.test(qa) || DIE.test(qb)) continue;
        if (MINT_IN_NAME.test(qa) || MINT_IN_NAME.test(qb)) continue;
        const wa = words(qa), wb = words(qb);
        if (!(subset(wa, wb) || subset(wb, wa))) continue;
        const [keep, lose] = a.links >= b.links ? [a, b] : [b, a];
        if (lose.gone || keep.gone) continue;
        pairs++;
        console.log(`  «${keep.name_full}» (${keep.links}) ← «${lose.name_full}» (${lose.links})`);
        if (apply) {
          const r = await pool.query(
            `UPDATE lot_type_link l SET type_id=$2 WHERE l.type_id=$1
               AND NOT EXISTS (SELECT 1 FROM lot_type_link x WHERE x.lot_id=l.lot_id AND x.type_id=$2)`,
            [lose.id, keep.id]);
          moved += r.rowCount;
          await pool.query("DELETE FROM lot_type_link WHERE type_id=$1", [lose.id]);
          await pool.query(
            `UPDATE coin_type k SET metal=COALESCE(k.metal, l.metal), theme_ru=COALESCE(NULLIF(k.theme_ru,''), l.theme_ru),
                    image_url=COALESCE(k.image_url, l.image_url), updated_at=now()
               FROM coin_type l WHERE k.id=$2 AND l.id=$1`, [lose.id, keep.id]);
          await pool.query("DELETE FROM coin_type WHERE id=$1", [lose.id]);
        } else moved += lose.links;
        lose.gone = true;
        keep.links += lose.links;
        merged++;
      }
    }
  }
  console.log(`\nпар ${pairs} · ${apply ? "слито" : "к слиянию"} типов ${merged} · связей ${apply ? "перенесено" : "затронуто"} ${moved}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
