/**
 * Зеркалирование изображений ЦБ в наше хранилище.
 *
 * Карточки модерна показывают снимки прямо с сайта ЦБ: адрес собирается из номера каталога
 * (cbr_cat_num) на лету, в базе ничего не лежит. Работает, но держится на чужом хосте — смена
 * путей или запрет хотлинка разом гасит картинки во всех 1975 карточках, включая мобильное
 * приложение. Копируем к себе в MinIO и проставляем image_url, как у каталожных фотографий.
 *
 * Идемпотентно: уже скачанные объекты пропускаются, image_url пишется только там, где пусто.
 *   node catalog/mirror-cbr-photos.js [--limit N] [--apply]
 */
const fs = require("fs");
const { pool } = require("./db");

const BUCKET = "coin-ref-photos";
const SRC = (num, rev) => `https://www.cbr.ru/legacy/PhotoStore/img/${num}${rev ? "r" : ""}.jpg`;
const KEY = (num, rev) => `cbr/${num}${rev ? "r" : ""}.jpg`;
const CONCURRENCY = 4;                      // к чужому сайту идём аккуратно

let _mc = null;
function minioClient() {
  if (_mc) return _mc;
  const Minio = require("minio");
  const env = Object.fromEntries(fs.readFileSync("/opt/numismatics/.env", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/\r$/, "").replace(/^["']|["']$/g, "")]; }));
  _mc = new Minio.Client({ endPoint: env.MINIO_ENDPOINT, port: 443, useSSL: true, accessKey: env.MINIO_ACCESS_KEY, secretKey: env.MINIO_SECRET_KEY });
  return _mc;
}

async function exists(mc, key) {
  try { await mc.statObject(BUCKET, key); return true; } catch (_) { return false; }
}

async function fetchImage(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  // ЦБ на отсутствующий номер отдаёт заглушку, а не 404, поэтому проверяем сигнатуру. Часть
  // снимков лежит в PNG под расширением .jpg (339 типов) — принимаем оба формата.
  if (buf.length < 2000) return null;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return jpeg || png ? { buf, type: png ? "image/png" : "image/jpeg" } : null;
}

(async () => {
  const apply = process.argv.includes("--apply");
  const li = process.argv.indexOf("--limit");
  const limit = li > -1 ? parseInt(process.argv[li + 1], 10) : 0;

  const rows = (await pool.query(
    `SELECT id, cbr_cat_num FROM coin_type
     WHERE cbr_cat_num IS NOT NULL AND image_url IS NULL
     ORDER BY id ${limit ? "LIMIT " + limit : ""}`)).rows;
  console.log(`типов к зеркалированию: ${rows.length}${apply ? " (APPLY)" : " (сухой прогон)"}`);

  const mc = minioClient();
  let done = 0, saved = 0, missing = 0, skipped = 0;
  const queue = rows.slice();

  const worker = async () => {
    while (queue.length) {
      const r = queue.shift();
      const num = String(r.cbr_cat_num).trim();
      const keys = [KEY(num, false), KEY(num, true)];
      try {
        const have = await Promise.all(keys.map((k) => exists(mc, k)));
        const bufs = [];
        for (const [i, key] of keys.entries()) {
          if (have[i]) { bufs.push(null); continue; }        // уже лежит — не качаем повторно
          bufs.push(await fetchImage(SRC(num, i === 1)));
        }
        if (!have[0] && !bufs[0]) { missing++; continue; }   // аверса нет — тип пропускаем
        if (apply) {
          for (const [i, key] of keys.entries()) {
            if (bufs[i]) await mc.putObject(BUCKET, key, bufs[i].buf, bufs[i].buf.length, { "Content-Type": bufs[i].type });
          }
          const hasRev = have[1] || !!bufs[1];
          await pool.query(
            `UPDATE coin_type SET image_url=$2, image_url_rev=$3, updated_at=now() WHERE id=$1 AND image_url IS NULL`,
            [r.id, `/api/coincat/refphoto/${keys[0]}`, hasRev ? `/api/coincat/refphoto/${keys[1]}` : null]);
        }
        saved++;
      } catch (e) {
        skipped++;
      }
      if (++done % 200 === 0) console.log(`  ${done}/${rows.length} · сохранено ${saved} · без снимка ${missing} · сбоев ${skipped}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`ИТОГ: обработано ${done} · ${apply ? "зеркалировано" : "готово к зеркалированию"} ${saved} · без снимка ${missing} · сбоев ${skipped}`);
  await pool.end();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
