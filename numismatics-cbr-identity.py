"""Идентичность памятных монет ЦБ, которой нет в тексте каталога.

У ЦБ вся серия носит ОДНО имя: семь городов-героев называются «2 рубля. 55-я годовщина Победы»,
семь министерств — «10 рублей. 200-летие образования в России министерств». Различие есть только
на реверсе. Из-за этого матчер не может выбрать между ними и воздерживается, а лоты с названным
городом остаются без типа.

Читаем различие с изображения реверса (оно у нас зеркалировано, но берём прямо с сайта ЦБ — так
не нужны ключи хранилища) и кладём в theme_ru: это поле участвует в сверке по теме.

  python cbr_identity.py [--limit N]           — сухой прогон
  python cbr_identity.py [--limit N] --apply
"""
import asyncio
import base64
import sys

import httpx
from sqlalchemy import text

from db import async_session
from llm import vl_json

IMG = "https://www.cbr.ru/legacy/PhotoStore/img/{}r.jpg"

# Промпт строго ASCII и без прозы — иначе модель отдаёт пустой ответ (урок Calico и Федорина).
PROMPT = (
    "This is the reverse of a Russian commemorative coin. The whole series shares one catalog name, "
    "so I need the subject of THIS coin: the city, ministry, person, sport or building shown or named "
    "on it. Answer with the russian words as they appear on the coin or with a short russian noun "
    'phrase naming the subject. Return ONLY JSON {"subject":"<short russian phrase>"}. '
    "If nothing identifies it, return an empty string. JSON only."
)


async def read_one(client, cat):
    try:
        r = await client.get(IMG.format(cat), timeout=30)
        if r.status_code != 200 or len(r.content) < 2000:
            return None
    except Exception:
        return None
    b64 = base64.b64encode(r.content).decode()
    msgs = [{"role": "user", "content": [
        {"type": "text", "text": PROMPT},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}]}]
    for _ in range(3):
        try:
            res = await vl_json(msgs, max_tokens=300, temperature=0.1)
        except Exception:
            res = None
        if isinstance(res, dict) and isinstance(res.get("subject"), str):
            return res["subject"].strip()
    return None


async def main(limit, apply):
    async with async_session() as s:
        rows = (await s.execute(text("""
            SELECT id, cbr_cat_num, name_full, year FROM coin_type t
             WHERE source='cbr' AND cbr_cat_num IS NOT NULL
               AND coalesce(theme_ru,'') = ''
               AND EXISTS (SELECT 1 FROM coin_type x WHERE x.source='cbr' AND x.id<>t.id
                            AND x.name_full=t.name_full AND x.year=t.year
                            AND x.denomination_value IS NOT DISTINCT FROM t.denomination_value)
             ORDER BY t.year, t.cbr_cat_num""" + (f" LIMIT {limit}" if limit else "")))).fetchall()
    print(f"типов без различающего сюжета: {len(rows)}", flush=True)

    done = 0
    async with httpx.AsyncClient() as client:
        sem = asyncio.Semaphore(6)

        async def one(r):
            async with sem:
                return r, await read_one(client, r.cbr_cat_num)

        results = []
        for fut in asyncio.as_completed([one(r) for r in rows]):
            r, subj = await fut
            results.append((r, subj))
            done += 1
            if done % 25 == 0:
                print(f"  прочитано {done}/{len(rows)}", flush=True)

    # Ответ, который лишь повторяет имя серии, ничего не различает: у балетной серии монета себя
    # не подписывает, и модель честно читает «Русский балет» — такой сюжет записывать нельзя.
    def informative(row, subj):
        if not subj or len(subj) < 3:
            return False
        name = set(w for w in row.name_full.lower().replace(".", " ").split() if len(w) > 3)
        words = [w for w in subj.lower().replace(".", " ").split() if len(w) > 3]
        return bool(words) and any(w not in name for w in words)

    ok = [(r, s) for r, s in results if informative(r, s)]
    print(f"сюжет прочитан у {len(ok)} из {len(rows)}")
    for r, s in ok[:12]:
        print(f"  {r.cbr_cat_num} {r.year} | {r.name_full[:44]} → «{s}»")
    if not apply:
        print("(сухой прогон; для записи добавьте --apply)")
        return
    async with async_session() as s2:
        for r, subj in ok:
            await s2.execute(text("UPDATE coin_type SET theme_ru=:t, updated_at=now() WHERE id=:id"),
                             {"t": subj[:120], "id": r.id})
        await s2.commit()
    print(f"ЗАПИСАНО: {len(ok)}")


if __name__ == "__main__":
    lim = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0
    asyncio.run(main(lim, "--apply" in sys.argv))
