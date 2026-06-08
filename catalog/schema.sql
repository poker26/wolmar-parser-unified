-- Каталог монет — схема (additive, не трогает существующие таблицы)

CREATE TABLE IF NOT EXISTS coin_type (
  id                 SERIAL PRIMARY KEY,
  source             TEXT NOT NULL DEFAULT 'fcoins',
  source_card_id     TEXT,               -- fcoins catalogcbNNNNN
  cbr_cat_num        TEXT,               -- официальный номер ЦБ РФ, напр. 5111-0338
  country            TEXT NOT NULL DEFAULT 'RU',
  name_full          TEXT NOT NULL,      -- «3 рубля. 350-летие основания г. Улан-Удэ»
  theme_core         TEXT NOT NULL,      -- нормализованное ядро темы (ключ матча)
  denomination_text  TEXT,
  denomination_value NUMERIC,            -- в рублях (копейки -> доли)
  year               INT,
  issue_date         DATE,
  mint               TEXT,               -- ММД / СПМД / ЛМД
  quality            TEXT,               -- Proof / UNC / ...
  spec_flag          BOOLEAN NOT NULL DEFAULT false,  -- «в специальном/цветном исполнении»
  type_key           TEXT NOT NULL,      -- denom|year|mint|core|spec
  fcoins_passes      INT,                -- кол-во проходов ПО ВЕРСИИ fcoins (справочно, НЕ наши)
  fcoins_price       BIGINT,             -- цена ПО ВЕРСИИ fcoins (справочно)
  status             TEXT NOT NULL DEFAULT 'draft',   -- draft | confirmed | needs_review
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coin_type_src_cat
  ON coin_type(source, cbr_cat_num) WHERE cbr_cat_num IS NOT NULL;
CREATE INDEX IF NOT EXISTS coin_type_key_idx ON coin_type(type_key);
CREATE INDEX IF NOT EXISTS coin_type_bucket  ON coin_type(denomination_value, year, mint);

CREATE TABLE IF NOT EXISTS lot_type_link (
  id               SERIAL PRIMARY KEY,
  lot_id           INTEGER NOT NULL,     -- auction_lots.id (наш проход)
  type_id          INTEGER NOT NULL REFERENCES coin_type(id) ON DELETE CASCADE,
  grade            TEXT,                 -- грейд лота
  match_method     TEXT,                 -- exact_core | fuzzy | manual
  match_confidence NUMERIC,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lot_id)
);
CREATE INDEX IF NOT EXISTS lot_type_link_type ON lot_type_link(type_id);

CREATE TABLE IF NOT EXISTS review_queue (
  id          SERIAL PRIMARY KEY,
  lot_id      INTEGER,
  type_id     INTEGER,
  our_theme   TEXT,
  bucket      TEXT,                       -- denom|year|mint
  finding     TEXT NOT NULL,              -- no_match | ambiguous | collision
  candidates  JSONB,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_queue_status ON review_queue(status);
