const { Client } = require('pg');
const config = require('./config');
const { resolveCurrentAuctionNumber } = require('./utils/current-auction');

class ImprovedPredictionsGenerator {
    constructor({ metalsPriceService = null } = {}) {
        this.dbClient = null;
        this.ownsDbClient = false;
        if (metalsPriceService) {
            this.metalsPriceService = metalsPriceService;
        } else {
            const MetalsPriceService = require('./metals-price-service');
            this.metalsPriceService = new MetalsPriceService();
        }
        
        // Fallback цены (используются если не удается получить актуальные)
        this.fallbackMetalPrices = {
            'Au': 7500, // Золото за грамм
            'Ag': 100,  // Серебро за грамм
            'Pt': 3000, // Платина за грамм
            'Pd': 2000  // Палладий за грамм
        };
        
        this.metalPurities = {
            'Au': 0.9,  // 90% для золотых монет
            'Ag': 0.9,  // 90% для серебряных монет
            'Pt': 0.95, // 95% для платиновых монет
            'Pd': 0.95  // 95% для палладиевых монет
        };
        
        // Кэш для актуальных цен металлов
        this.metalsPriceCache = new Map();
        this.cacheTimeout = 60 * 60 * 1000; // 1 час

        // Кэш цен металлов по дате (ISO 'YYYY-MM-DD') — для оценки металла на дату продажи
        this.metalsByDateCache = new Map();

        // Период полураспада веса для recency-weighted медианы (мес.). Свежая продажа
        // весит вдвое больше, чем продажа `halflife` месяцев назад. 6 мес. — устойчивый
        // компромисс (бэктест 1001/1002: MdAPE 14.3→12.5, хвосты >50%/>100% тоже ниже).
        this.recencyHalflifeMonths = parseFloat(process.env.RECENCY_HALFLIFE_MONTHS || '6');
    }

    async init() {
        this.dbClient = new Client(config.dbConfig);
        await this.dbClient.connect();
        this.ownsDbClient = true;
        console.log('🔗 Подключение к базе данных установлено');
    }

    async close() {
        if (this.dbClient && this.ownsDbClient) {
            await this.dbClient.end();
            console.log('🧹 Ресурсы освобождены');
        }
        if (this.metalsPriceService) {
            await this.metalsPriceService.close();
        }
    }

    // Получение актуальных цен металлов с ЦБ РФ
    async getCurrentMetalPrices() {
        try {
            const cacheKey = 'current_metals_prices';
            const now = Date.now();
            
            // Проверяем кэш
            if (this.metalsPriceCache.has(cacheKey)) {
                const cached = this.metalsPriceCache.get(cacheKey);
                if (now - cached.timestamp < this.cacheTimeout) {
                    console.log('💰 Используем кэшированные цены металлов');
                    return cached.prices;
                }
            }
            
            console.log('🔄 Получаем актуальные цены металлов с ЦБ РФ...');
            
            // Получаем данные за сегодня
            const today = new Date();
            const priceData = await this.metalsPriceService.getPriceData(today);
            
            if (priceData && priceData.metals) {
                // Конвертируем цены в формат, ожидаемый системой
                const currentPrices = {
                    'Au': priceData.metals.gold || this.fallbackMetalPrices.Au,
                    'Ag': priceData.metals.silver || this.fallbackMetalPrices.Ag,
                    'Pt': priceData.metals.platinum || this.fallbackMetalPrices.Pt,
                    'Pd': priceData.metals.palladium || this.fallbackMetalPrices.Pd
                };
                
                // Кэшируем результат
                this.metalsPriceCache.set(cacheKey, {
                    prices: currentPrices,
                    timestamp: now
                });
                
                console.log('✅ Актуальные цены металлов получены:', currentPrices);
                return currentPrices;
            } else {
                console.error('🚨 ВНИМАНИЕ: ЦБ РФ не вернул цены металлов — используются РЕЗЕРВНЫЕ (хардкод) цены. Прогнозы по драгметаллам НЕДОСТОВЕРНЫ:', this.fallbackMetalPrices);
                return this.fallbackMetalPrices;
            }

        } catch (error) {
            console.error('❌ Ошибка получения цен металлов:', error.message);
            console.error('🚨 ВНИМАНИЕ: используются РЕЗЕРВНЫЕ (хардкод) цены металлов. Прогнозы по драгметаллам НЕДОСТОВЕРНЫ:', this.fallbackMetalPrices);
            return this.fallbackMetalPrices;
        }
    }

    // Поиск аналогичных лотов.
    //
    // Сохранность (грейд) — ОБЯЗАТЕЛЬНОЕ строгое измерение: разница в цене между
    // грейдами одной и той же монеты бывает в разы (PF70 vs UNC и т.п.), поэтому
    // НЕЛЬЗЯ смешивать грейды в одну выборку. Раньше для современных монет (год≥2020)
    // и платины грейды пулялись (condition IN (...)), что искажало медиану — убрано.
    //
    // Тир 1: тот же металл + год + ТОЧНО тот же грейд + тип монеты (название/номинал).
    // Тир 2 (только для покрытия): если в тире 1 < 2 аналогов, снимаем фильтр по типу,
    //        НО металл+год+грейд остаются строгими.
    async findSimilarLots(lot) {
        const { condition, metal, year, coin_description, auction_number } = lot;
        console.log(`🔍 Поиск аналогов для лота ${lot.lot_number} (аукцион ${auction_number}, грейд ${condition})`);

        const { extractDenominationAndCurrency, createDenominationSQLCondition } = require('./utils/denomination-extractor');
        const coinNameMatch = coin_description ? coin_description.match(/^(.+?)(?=\s*\d{4}г)/) : null;
        const coinName = coinNameMatch ? coinNameMatch[1].trim() : null;
        const denominationData = coinName ? null : extractDenominationAndCurrency(coin_description);

        // РАЗНОВИДНОСТЬ внутри одного номинала+года — это РАЗНЫЕ монеты с РАЗНОЙ ценой.
        // Пример: «10 копеек 1825 СПБ ПД» (рядовая, ~1900₽) и «10 копеек 1825 СПБ НГ R1»
        // (редкая разновидность, ~13000₽) имеют одинаковые номинал/год/металл/грейд, но это
        // не аналоги. Чтобы рядовую монету не оценивали по редкой (и наоборот), добавляем
        // два доп. фильтра тира 1 — каждый применяется ТОЛЬКО когда извлекается у лота:
        //   • знак двора/минцмейстера — токен между годом и металлом, напр. «СПБ ПД», «ЕМ»;
        //   • флаг редкости (RR/R1/RRR/«редкость») — рядовая и редкая разновидности
        //     разводятся (рядовая ↮ редкая).
        let mintMatch = coin_description
            ? coin_description.match(/\d{4}\s*г\.?\s*([^.|]{1,14}?)\.?\s*(?:Ag|Au|Pt|Pd|Cu|Ni|Fe|Zn)\b/i)
            : null;
        let mint = mintMatch ? mintMatch[1].trim() : null;
        // отбрасываем мусорные/неинформативные токены (металл, цифры, не-аббревиатуры)
        if (mint && (!/^[А-ЯЁA-Z][А-ЯЁA-Z0-9\s\/-]*$/.test(mint) || mint.length < 2)) mint = null;
        const rareRe = "(RRR|RR|R1|R2|R3|редкост)";
        const isRare = !!(coin_description && new RegExp(rareRe, 'i').test(coin_description));

        // Раньше metal и year навешивались как ЖЁСТКОЕ равенство всегда. Но если у самого
        // лота поле NULL (боны — нет металла; антика/допетровские — нет 4-значного года),
        // условие `metal = NULL` / `year = NULL` не матчит НИЧЕГО → лот гарантированно падал
        // в no_similar_lots. Теперь каждый ключ навешивается только если он у лота есть:
        //   • металл есть  → AND metal = ... (как раньше, монеты);
        //   • металла нет  → партиционируем по КАТЕГОРИИ (боны матчатся только с бонами,
        //                    чтобы «10 рублей» бона не смешалась с «10 рублей» монетой);
        //   • год есть      → AND year = ...
        // Тип (название/номинал) — отдельный фильтр (тир 1).
        const hasMetal = metal != null && String(metal).trim() !== '';
        const hasYear  = year != null && String(year).toString().trim() !== '';
        const hasType  = !!(coinName || denominationData);

        // Нужен хотя бы один сильный признак идентичности помимо грейда, иначе матч
        // получается слишком грубым (категория+грейд) — лучше честно не прогнозировать.
        if (!hasYear && !hasType) {
            this._lastMatchRelaxed = false;
            console.log(`🔍 Нет ни года, ни типа — аналоги не ищем (грейд ${condition})`);
            return [];
        }

        const runQuery = async (withTypeFilter) => {
            const params = [lot.id, lot.auction_number, condition];
            let query = `
                SELECT id, lot_number, auction_number, winning_bid, metal, weight,
                       fineness, pure_metal_weight, coin_description, auction_end_date
                FROM auction_lots
                WHERE winning_bid IS NOT NULL AND winning_bid > 0
                    AND id != $1 AND auction_number != $2
                    AND condition = $3
                    AND (auction_end_date IS NULL OR auction_end_date < now())`;
            if (hasMetal) {
                params.push(metal);
                query += ` AND metal = $${params.length}`;
            } else {
                params.push(lot.category);
                query += ` AND category = $${params.length}`;
            }
            if (hasYear) {
                params.push(year);
                query += ` AND year = $${params.length}`;
            }
            if (withTypeFilter) {
                if (coinName) {
                    // ЯКОРИМ по началу описания: coinName — это ведущий номинал лота
                    // («5 копеек»). Раньше был '%coinName%', и подстрока «5 копеек»
                    // ловила «15 копеек», «25 копеек», «45 копеек» — РАЗНЫЕ монеты с
                    // другой ценой попадали в аналоги (5 коп 1891 → прогноз 184500 по
                    // 25-копеечникам). Префиксный матч этого не допускает.
                    params.push(`${coinName}%`);
                    query += ` AND coin_description ILIKE $${params.length}`;
                } else if (denominationData) {
                    query += createDenominationSQLCondition(denominationData, params);
                }
                // знак двора/минцмейстера (разновидность) — если извлёкся у лота
                if (mint) {
                    params.push(`%${mint}%`);
                    query += ` AND coin_description ILIKE $${params.length}`;
                }
                // редкость: рядовую монету не мешаем с редкой разновидностью и наоборот
                params.push(rareRe);
                query += isRare
                    ? ` AND coin_description ~* $${params.length}`
                    : ` AND coin_description !~* $${params.length}`;
            }
            query += ` ORDER BY auction_end_date DESC`;
            const r = await this.dbClient.query(query, params);
            return r.rows;
        };

        // ТОЛЬКО строгий матч по типу монеты (название/номинал) + металл/категория +
        // год + грейд. Раньше существовал «тир 2», который при <2 аналогах СБРАСЫВАЛ
        // фильтр по типу ради покрытия — и смешивал РАЗНЫЕ монеты с одинаковыми
        // металлом/годом/грейдом (1 рупия Брит. Индия ↔ 1 рубль 1862 СПБ ↔ двойной
        // талер), выдавая медиану-бред (рупия за 600k при реальных 20k). Это убрано:
        // лучше честно отдать 1 аналог (single_similar_lot) или no_similar_lots, чем
        // выдумать цену из чужих монет.
        const rows = await runQuery(true);
        this._lastMatchRelaxed = false;
        console.log(`🔍 Найдено ${rows.length} аналогов (грейд ${condition})`);
        return rows;
    }

    /**
     * Canonical comparable lookup for a catalog-linked coin.
     *
     * Identity is never widened beyond type_id. Grade remains exact when it is
     * known. Slab evidence is an additional comparable dimension: the lookup
     * starts with the narrowest supported slice and widens only inside the
     * same catalog type and grade.
     */
    async findSimilarLotsByType(lot) {
        const typeId = Number(lot.type_id ?? lot.typeId);
        if (!Number.isSafeInteger(typeId) || typeId <= 0) return [];

        // type_id narrows identity but does not discard the qualifiers that made
        // the established predictor safe for catalog types containing several
        // mints/varieties. The type filter and the old strong qualifiers are an
        // intersection, never alternative fallbacks.
        const { extractDenominationAndCurrency, createDenominationSQLCondition } = require('./utils/denomination-extractor');
        const coinNameMatch = lot.coin_description
            ? lot.coin_description.match(/^(.+?)(?=\s*\d{4}г)/)
            : null;
        const coinName = coinNameMatch ? coinNameMatch[1].trim() : null;
        const denominationData = coinName ? null : extractDenominationAndCurrency(lot.coin_description);
        const mintMatch = lot.coin_description
            ? lot.coin_description.match(/\d{4}\s*г\.?\s*([^.|]{1,14}?)\.?\s*(?:Ag|Au|Pt|Pd|Cu|Ni|Fe|Zn)\b/i)
            : null;
        let mint = mintMatch ? mintMatch[1].trim() : null;
        if (mint && (!/^[А-ЯЁA-Z][А-ЯЁA-Z0-9\s\/-]*$/.test(mint) || mint.length < 2)) mint = null;
        const rareRe = '(RRR|RR|R1|R2|R3|редкост)';
        const isRare = !!(lot.coin_description && new RegExp(rareRe, 'i').test(lot.coin_description));
        const hasMetal = lot.metal != null && String(lot.metal).trim() !== '';
        const hasYear = lot.year != null && String(lot.year).trim() !== '';

        const grade = lot.slab_grade_code || lot.link_grade || lot.condition || null;
        const slabStatus = ['slabbed', 'raw'].includes(lot.slab_status)
            ? lot.slab_status
            : 'unknown';
        const company = slabStatus === 'slabbed'
            ? (lot.grading_company_code || null)
            : null;

        const plans = [];
        if (slabStatus === 'slabbed' && company) {
            plans.push({ basis: 'type_grade_slab_company', slabStatus: 'slabbed', company, expanded: false });
            plans.push({ basis: 'type_grade_slabbed', slabStatus: 'slabbed', company: null, expanded: true });
            plans.push({ basis: 'type_grade_all_slabs', slabStatus: null, company: null, expanded: true });
        } else if (slabStatus !== 'unknown') {
            plans.push({ basis: `type_grade_${slabStatus}`, slabStatus, company: null, expanded: false });
            plans.push({ basis: 'type_grade_all_slabs', slabStatus: null, company: null, expanded: true });
        } else {
            plans.push({ basis: grade ? 'type_grade_unknown_slab' : 'type_unknown_grade_and_slab', slabStatus: null, company: null, expanded: !grade });
        }

        for (const plan of plans) {
            const params = [typeId];
            const filters = [
                'ltl.type_id = $1',
                'al.winning_bid IS NOT NULL',
                'al.winning_bid > 0',
                "al.lot_status IS DISTINCT FROM 'active'",
                '(al.auction_end_date IS NULL OR al.auction_end_date < now())',
            ];
            const lotId = Number(lot.id);
            if (Number.isSafeInteger(lotId) && lotId > 0) {
                params.push(lotId);
                filters.push(`al.id <> $${params.length}`);
            }
            if (lot.auction_number != null && String(lot.auction_number).trim()) {
                params.push(String(lot.auction_number));
                filters.push(`al.auction_number IS DISTINCT FROM $${params.length}`);
            }
            if (grade) {
                params.push(grade);
                filters.push(`collection_normalize_grade(COALESCE(
                    NULLIF(al.slab_grade_code, ''), NULLIF(ltl.grade, ''), NULLIF(al.condition, '')
                )) = collection_normalize_grade($${params.length})`);
            }
            if (hasMetal) {
                params.push(lot.metal);
                filters.push(`al.metal = $${params.length}`);
            } else if (lot.category != null && String(lot.category).trim()) {
                params.push(lot.category);
                filters.push(`al.category = $${params.length}`);
            }
            if (hasYear) {
                params.push(lot.year);
                filters.push(`al.year = $${params.length}`);
            }
            if (coinName) {
                params.push(`${coinName}%`);
                filters.push(`al.coin_description ILIKE $${params.length}`);
            } else if (denominationData) {
                const denominationFilter = createDenominationSQLCondition(denominationData, params)
                    .replace(/^\s*AND\s+/i, '')
                    .replace(/\bcoin_description\b/g, 'al.coin_description');
                filters.push(denominationFilter);
            }
            if (mint) {
                params.push(`%${mint}%`);
                filters.push(`al.coin_description ILIKE $${params.length}`);
            }
            params.push(rareRe);
            filters.push(isRare
                ? `al.coin_description ~* $${params.length}`
                : `al.coin_description !~* $${params.length}`);
            if (plan.slabStatus) {
                params.push(plan.slabStatus);
                filters.push(`al.slab_status = $${params.length}`);
            }
            if (plan.company) {
                params.push(plan.company);
                filters.push(`al.grading_company_code = $${params.length}`);
            }

            const result = await this.dbClient.query(
                `SELECT al.id, al.lot_number, al.auction_number, al.winning_bid,
                        al.metal, al.weight, al.fineness, al.pure_metal_weight,
                        al.coin_description, al.auction_end_date,
                        al.slab_status, al.grading_company_code, al.slab_grade_code
                 FROM lot_type_link ltl
                 JOIN auction_lots al ON al.id = ltl.lot_id
                 LEFT JOIN lot_type_link_quality lq
                   ON lq.lot_id = ltl.lot_id
                  AND lq.type_id = ltl.type_id
                  AND lq.audit_version = 'hard-consistency-v1'
                 WHERE ${filters.join('\n                   AND ')}
                   AND COALESCE(lq.status, 'unverified') <> 'conflict'
                 ORDER BY al.auction_end_date DESC NULLS LAST, al.id DESC`,
                params,
            );
            if (plans.indexOf(plan) === 0) this._lastExactComparableCount = result.rows.length;
            if (result.rows.length) {
                this._lastMatchBasis = plan.basis;
                this._lastMatchExpanded = plan.expanded;
                return result.rows;
            }
        }

        this._lastMatchBasis = plans.at(-1)?.basis || 'type_id';
        this._lastMatchExpanded = plans.at(-1)?.expanded || false;
        this._lastExactComparableCount ??= 0;
        return [];
    }

    // Поиск аналогичных лотов с точным совпадением описания (для исключенных категорий)
    async findSimilarLotsExactMatch(lot) {
        const { coin_description, auction_number } = lot;
        
        console.log(`🔍 Поиск лотов с точным совпадением описания для лота ${lot.lot_number} (категория: ${lot.category})`);
        
        // Нормализуем описание: убираем лишние пробелы, приводим к нижнему регистру для сравнения
        const normalizedDescription = coin_description.trim().toLowerCase();
        
        // Ищем лоты с точно таким же описанием (с учетом возможных вариаций пробелов)
        let query = `
            SELECT
                id,
                lot_number,
                auction_number,
                winning_bid,
                metal,
                weight,
                fineness,
                pure_metal_weight,
                coin_description,
                auction_end_date
            FROM auction_lots
            WHERE LOWER(TRIM(coin_description)) = $1
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND id != $2
                AND auction_number != $3
            ORDER BY auction_end_date DESC
            LIMIT 20
        `;
        
        const params = [normalizedDescription, lot.id, lot.auction_number];
        
        console.log(`🔍 SQL запрос (точное совпадение): ${query}`);
        console.log(`🔍 Параметры: [${params.join(', ')}]`);
        
        const result = await this.dbClient.query(query, params);
        
        console.log(`🔍 Найдено ${result.rows.length} лотов с точным совпадением описания`);
        if (result.rows.length > 0) {
            console.log(`🔍 Первые 3 лота:`);
            result.rows.slice(0, 3).forEach((row, index) => {
                console.log(`   ${index + 1}. Лот ${row.lot_number}, Аукцион ${row.auction_number}, Цена: ${row.winning_bid}₽`);
            });
        }
        
        return result.rows;
    }

    // Цены металлов (₽/г) на конкретную дату из metals_prices.
    // Берём ближайшую запись с date <= нужной даты; если таких нет (дата раньше
    // начала истории) — самую раннюю. Без даты → текущие цены ЦБ.
    async getMetalPricesAtDate(date) {
        if (!date) return await this.getCurrentMetalPrices();
        const iso = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
        if (this.metalsByDateCache.has(iso)) return this.metalsByDateCache.get(iso);

        let prices = this.fallbackMetalPrices;
        try {
            let r = await this.dbClient.query(
                `SELECT gold_price, silver_price, platinum_price, palladium_price
                 FROM metals_prices WHERE date <= $1 ORDER BY date DESC LIMIT 1`, [iso]);
            if (!r.rows.length) {
                r = await this.dbClient.query(
                    `SELECT gold_price, silver_price, platinum_price, palladium_price
                     FROM metals_prices ORDER BY date ASC LIMIT 1`);
            }
            if (r.rows.length) {
                const x = r.rows[0];
                prices = {
                    Au: parseFloat(x.gold_price) || this.fallbackMetalPrices.Au,
                    Ag: parseFloat(x.silver_price) || this.fallbackMetalPrices.Ag,
                    Pt: parseFloat(x.platinum_price) || this.fallbackMetalPrices.Pt,
                    Pd: parseFloat(x.palladium_price) || this.fallbackMetalPrices.Pd,
                };
            }
        } catch (e) {
            console.error('⚠️ getMetalPricesAtDate — откат на резервные цены:', e.message);
        }
        this.metalsByDateCache.set(iso, prices);
        return prices;
    }

    /**
     * Стоимость металла лота (₽).
     * opts.pureWeight  — вес чистого металла (г), из каталога/текста (приоритет);
     * opts.fineness    — проба (доли 1000), если pureWeight нет;
     * opts.date        — дата продажи: цена металла берётся на эту дату (для аналогов).
     * Если ни pureWeight, ни fineness нет — запасное допущение по metalPurities.
     */
    async calculateMetalValue(metal, weight, opts = {}) {
        const { date = null, pureWeight = null, fineness = null } = opts;

        let effPure = null;
        if (pureWeight != null && pureWeight > 0) {
            effPure = pureWeight;                                   // вес×проба уже посчитан
        } else if (weight > 0 && fineness != null && fineness > 0) {
            effPure = weight * fineness / 1000;                     // есть проба
        } else if (weight > 0) {
            effPure = weight * (this.metalPurities[metal] || 1);    // запасное допущение
        }
        if (!effPure || effPure <= 0) return 0;

        const prices = date ? await this.getMetalPricesAtDate(date) : await this.getCurrentMetalPrices();
        const pricePerGram = prices[metal];
        if (!pricePerGram) return 0;

        return pricePerGram * effPure;
    }

    /**
     * Recency-weighted медиана: свежие продажи весят больше старых.
     * w_i = 0.5^(ageMonths / halflife) по auction_end_date относительно refDate (по
     * умолчанию — «сейчас», т.к. прогноз для текущего/будущего лота). Берём медиану
     * (а не среднее) → устойчивость к выбросам; вес лишь смещает оценку к свежим ценам,
     * чтобы прогноз шёл за текущим рынком, а не тянулся вниз старыми дешёвыми проходами.
     * Старые дешёвые проходы из «осени 2025» получают меньший вес — ровно то, что нужно
     * для драгмета, где металл стабилен, а нумизматическая премия дрейфует во времени.
     */
    recencyWeightedQuantile(rows, fraction, refDate = new Date(), halflifeMonths = this.recencyHalflifeMonths) {
        if (!(fraction >= 0 && fraction <= 1)) throw new RangeError('fraction must be between 0 and 1');
        const MS_MONTH = 2629746000; // средний месяц в мс
        const ref = (refDate instanceof Date ? refDate : new Date(refDate)).getTime();
        const items = rows
            .filter(r => r && r.winning_bid != null)
            .map(r => {
                const t = r.auction_end_date ? new Date(r.auction_end_date).getTime() : ref;
                const ageMonths = Math.max(0, (ref - t) / MS_MONTH);
                return { v: Number(r.winning_bid), w: Math.pow(0.5, ageMonths / halflifeMonths) };
            })
            .sort((a, b) => a.v - b.v);
        if (!items.length) return null;
        const total = items.reduce((s, x) => s + x.w, 0);
        if (!(total > 0) || !isFinite(total)) return items[Math.floor(items.length / 2)].v;
        const threshold = total * fraction;
        let cum = 0;
        for (const it of items) { cum += it.w; if (cum >= threshold) return it.v; }
        return items[items.length - 1].v;
    }

    recencyWeightedMedian(rows, refDate = new Date(), halflifeMonths = this.recencyHalflifeMonths) {
        return this.recencyWeightedQuantile(rows, 0.5, refDate, halflifeMonths);
    }

    /** Удобная обёртка: melt-стоимость строки-лота (на её дату продажи, по её пробе). */
    async meltValue(row, metalOverride = null) {
        return this.calculateMetalValue(
            metalOverride || row.metal,
            row.weight != null ? parseFloat(row.weight) : null,
            {
                date: row.auction_end_date || null,
                pureWeight: row.pure_metal_weight != null ? parseFloat(row.pure_metal_weight) : null,
                fineness: row.fineness != null ? parseInt(row.fineness, 10) : null,
            }
        );
    }

    // Основная функция прогнозирования
    async predictPrice(lot) {
        // Проверяем, можно ли рассчитать прогноз для данной категории
        const { canCalculatePricePrediction, requiresExactDescriptionMatch } = require('./utils/category-exclusions');
        if (!canCalculatePricePrediction(lot.category)) {
            console.log(`⚠️ Лот ${lot.lot_number}: категория "${lot.category}" исключена из расчета прогнозной цены`);
            const metalValue = await this.meltValue(lot);
            return {
                predicted_price: null,
                metal_value: metalValue,
                numismatic_premium: null,
                confidence_score: 0,
                prediction_method: 'category_excluded',
                sample_size: 0
            };
        }
        
        // НАБОРЫ монет — комплектность бывает разной, аналоговая медиана по «номиналу»
        // даёт бред («Комплект 100 рублей из 6 монет Au» оценивался как одна монета).
        // Их нельзя сравнивать по аналогам — только СТРОГОЕ совпадение описания (тот же
        // набор продавался ранее), без расширения/фолбэка. Иначе ничего не выдаём.
        const isCoinSet = !!(lot.coin_description &&
            /(^|\s)(комплект|набор)\b|из\s+\d+\s+монет|погодовк/i.test(lot.coin_description));

        // Для категорий-исключений (одноэкземплярные предметы) и наборов — только
        // точное совпадение описания. Никакого аналогового матчинга, fallback и фантазий.
        const needsExactMatch = requiresExactDescriptionMatch(lot.category) || isCoinSet;
        const typeId = Number(lot.type_id ?? lot.typeId);
        const reliableTypeId = Number.isSafeInteger(typeId)
            && typeId > 0
            && lot.link_quality_status !== 'conflict';
        this._lastMatchBasis = null;
        this._lastMatchExpanded = false;
        this._lastExactComparableCount = null;
        const similarLots = needsExactMatch
            ? await this.findSimilarLotsExactMatch(lot)
            : (reliableTypeId
                ? await this.findSimilarLotsByType(lot)
                : await this.findSimilarLots(lot));
        
        console.log(`🔍 Лот ${lot.lot_number}: найдено ${similarLots.length} аналогичных лотов`);
        
        // Случай 1: Аналогичные лоты не найдены
        if (similarLots.length === 0) {
            console.log(`   ❌ Аналоги не найдены - прогноз не генерируется`);
            const metalValue = await this.meltValue(lot);
            return {
                predicted_price: null,
                metal_value: metalValue,
                numismatic_premium: null,
                confidence_score: 0,
                prediction_method: 'no_similar_lots',
                sample_size: 0,
                comparable_basis: this._lastMatchBasis,
                exact_comparable_count: this._lastExactComparableCount ?? 0,
                comparable_lot_ids: [],
            };
        }
        
        // Случай 2: Найден только один аналогичный лот
        if (similarLots.length === 1) {
            const similarLot = similarLots[0];
            const currentMetalValue = await this.meltValue(lot);
            const similarMetalValue = await this.meltValue(similarLot, lot.metal);
            
            // Корректируем цену на разницу в стоимости металла
            let predictedPrice = similarLot.winning_bid;
            if (currentMetalValue > 0 && similarMetalValue > 0) {
                const metalValueDifference = currentMetalValue - similarMetalValue;
                predictedPrice = similarLot.winning_bid + metalValueDifference;
                
                // Проверяем на NaN и исправляем
                if (isNaN(predictedPrice) || !isFinite(predictedPrice)) {
                    predictedPrice = similarLot.winning_bid; // Используем цену аналога без корректировки
                    console.log(`   ⚠️ Корректировка металла привела к NaN, используем цену аналога: ${similarLot.winning_bid}`);
                } else {
                    console.log(`   📊 Один аналог: ${similarLot.winning_bid} → ${predictedPrice} (корректировка металла: ${metalValueDifference.toFixed(0)})`);
                }
            } else {
                console.log(`   📊 Один аналог: ${similarLot.winning_bid} → ${predictedPrice} (без корректировки металла)`);
            }
            
            const prediction = {
                predicted_price: Math.round(predictedPrice),
                low_price: Math.round(predictedPrice),
                high_price: Math.round(predictedPrice),
                metal_value: currentMetalValue,
                numismatic_premium: Math.round(predictedPrice - currentMetalValue),
                confidence_score: 0.6, // Средняя уверенность для одного аналога
                prediction_method: 'single_similar_lot',
                sample_size: 1,
                comparable_basis: this._lastMatchBasis,
                exact_comparable_count: this._lastExactComparableCount ?? 1,
                comparable_lot_ids: [Number(similarLot.id)].filter(Number.isSafeInteger),
            };
            if (this._lastMatchExpanded) prediction.confidence_score *= 0.8;
            return prediction;
        }
        
        // Случай 3: Найдено два и более аналогичных лотов
        console.log(`   📈 Множественные аналоги (${similarLots.length}) - применяем статистическую модель`);
        
        // Рассчитываем статистики
        const prices = similarLots.map(lot => lot.winning_bid);
        const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        // Точечная оценка — RECENCY-WEIGHTED медиана (свежие проходы весомее старых),
        // чтобы прогноз следовал за текущим рынком. Раньше была простая медиана, и пачка
        // старых дешёвых продаж (напр. «осень 2025») тянула оценку драгмета вниз.
        const median = this.recencyWeightedMedian(similarLots);
        const broadRange = this._lastMatchExpanded
            || !(lot.slab_grade_code || lot.link_grade || lot.condition);
        const lowQuantile = broadRange ? 0.10 : 0.25;
        const highQuantile = broadRange ? 0.90 : 0.75;
        let lowPrice = this.recencyWeightedQuantile(similarLots, lowQuantile);
        let highPrice = this.recencyWeightedQuantile(similarLots, highQuantile);

        // Используем медиану как более устойчивую к выбросам
        let predictedPrice = median;
        
        // Корректировка на стоимость металла: melt целевого лота (на его дату) минус
        // средний melt аналогов (каждый — на СВОЮ дату продажи). Так учитывается дрейф
        // цены металла между прошлыми продажами и текущим моментом.
        const currentMetalValue = await this.meltValue(lot);
        if (currentMetalValue > 0) {
            let totalSimilarMetalValue = 0;
            for (const similarLot of similarLots) {
                totalSimilarMetalValue += await this.meltValue(similarLot, lot.metal);
            }
            const avgSimilarMetalValue = totalSimilarMetalValue / similarLots.length;

            const metalValueDifference = currentMetalValue - avgSimilarMetalValue;
            predictedPrice = median + metalValueDifference;
            lowPrice += metalValueDifference;
            highPrice += metalValueDifference;

            // Проверяем на NaN и исправляем
            if (isNaN(predictedPrice) || !isFinite(predictedPrice)) {
                predictedPrice = median; // Используем медиану без корректировки
                console.log(`   ⚠️ Корректировка металла привела к NaN, используем медиану: ${median}`);
            } else {
                console.log(`   🔧 Корректировка металла (по датам продаж): ${metalValueDifference.toFixed(0)}`);
            }
        }
        
        // Рассчитываем уверенность на основе размера выборки и разброса цен
        const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
        const coefficientOfVariation = Math.sqrt(variance) / mean;
        
        let confidence = Math.min(0.95, 0.5 + (similarLots.length / 20)); // Базовая уверенность
        if (coefficientOfVariation > 0.5) {
            confidence *= 0.8; // Снижаем уверенность при большом разбросе
        }
        
        console.log(`   📊 Медиана: ${median}, Корректированная: ${predictedPrice}, Уверенность: ${(confidence * 100).toFixed(1)}%`);
        
        const finalMetalValue = await this.meltValue(lot);
        const numismaticPremium = Math.round(predictedPrice - finalMetalValue);
        
        const prediction = {
            predicted_price: Math.round(predictedPrice),
            low_price: Math.max(1, Math.round(lowPrice)),
            high_price: Math.max(1, Math.round(highPrice)),
            metal_value: finalMetalValue,
            numismatic_premium: numismaticPremium,
            confidence_score: confidence,
            prediction_method: 'statistical_model',
            sample_size: similarLots.length,
            comparable_basis: this._lastMatchBasis,
            exact_comparable_count: this._lastExactComparableCount ?? similarLots.length,
            comparable_lot_ids: similarLots.map((row) => Number(row.id)).filter(Number.isSafeInteger),
        };
        if (this._lastMatchExpanded) prediction.confidence_score *= 0.8;
        return prediction;
    }

    // Генерация прогнозов для аукциона
    async generatePredictionsForAuction(auctionNumber) {
        console.log(`\n🏆 Генерируем улучшенные прогнозы для аукциона ${auctionNumber}:`);
        console.log(`🔍 Тип auctionNumber: ${typeof auctionNumber}, значение: ${auctionNumber}`);
        
        // Получаем все лоты аукциона
        const lotsResult = await this.dbClient.query(`
            SELECT al.id, al.lot_number, al.condition, al.metal, al.weight,
                   al.fineness, al.pure_metal_weight, al.year, al.letters,
                   al.winning_bid, al.coin_description, al.auction_number,
                   al.category, al.auction_end_date, al.slab_status,
                   al.grading_company_code, al.slab_grade_code, al.grade_source,
                   linked.type_id, linked.grade AS link_grade,
                   linked.link_quality_status
            FROM auction_lots al
            LEFT JOIN LATERAL (
                SELECT ltl.type_id, ltl.grade, lq.status AS link_quality_status
                FROM lot_type_link ltl
                LEFT JOIN lot_type_link_quality lq
                  ON lq.lot_id = ltl.lot_id
                 AND lq.type_id = ltl.type_id
                 AND lq.audit_version = 'hard-consistency-v1'
                WHERE ltl.lot_id = al.id
                ORDER BY CASE lq.status
                    WHEN 'consistent' THEN 0
                    WHEN 'unverified' THEN 1
                    WHEN 'conflict' THEN 2
                    ELSE 1
                END, ltl.id
                LIMIT 1
            ) linked ON true
            WHERE al.auction_number = $1
            ORDER BY al.lot_number
        `, [auctionNumber]);
        
        const lots = lotsResult.rows;
        console.log(`📋 Найдено ${lots.length} лотов для прогнозирования`);
        
        const predictions = [];
        let processedCount = 0;
        
        for (const lot of lots) {
            try {
                const prediction = await this.predictPrice(lot);
                predictions.push({
                    lot_id: lot.id,
                    ...prediction
                });
                
                processedCount++;
                if (processedCount % 10 === 0) {
                    console.log(`   ⏳ Обработано ${processedCount}/${lots.length} лотов`);
                }
            } catch (error) {
                console.error(`❌ Ошибка прогнозирования для лота ${lot.lot_number}:`, error.message);
            }
        }
        
        console.log(`\n💾 Сохранение ${predictions.length} прогнозов в базу данных...`);
        
        // Сохраняем прогнозы
        for (const prediction of predictions) {
            try {
                await this.dbClient.query(`
                    INSERT INTO lot_price_predictions (lot_id, predicted_price, metal_value, numismatic_premium, confidence_score, prediction_method, sample_size)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (lot_id) DO UPDATE SET
                        predicted_price = EXCLUDED.predicted_price,
                        metal_value = EXCLUDED.metal_value,
                        numismatic_premium = EXCLUDED.numismatic_premium,
                        confidence_score = EXCLUDED.confidence_score,
                        prediction_method = EXCLUDED.prediction_method,
                        sample_size = EXCLUDED.sample_size,
                        created_at = NOW();
                `, [
                    prediction.lot_id,
                    prediction.predicted_price,
                    prediction.metal_value,
                    prediction.numismatic_premium,
                    prediction.confidence_score,
                    prediction.prediction_method,
                    prediction.sample_size
                ]);
            } catch (error) {
                console.error(`❌ Ошибка сохранения прогноза для лота ${prediction.lot_id}:`, error.message);
            }
        }
        
        // Статистика
        const withPredictions = predictions.filter(p => p.predicted_price !== null).length;
        const withoutPredictions = predictions.filter(p => p.predicted_price === null).length;
        
        console.log(`✅ Сохранено ${predictions.length} прогнозов для аукциона ${auctionNumber}`);
        console.log(`   📊 С прогнозами: ${withPredictions}, Без прогнозов: ${withoutPredictions}`);
    }

    // Сохранение одного прогноза (upsert)
    async savePrediction(lotId, prediction) {
        await this.dbClient.query(`
            INSERT INTO lot_price_predictions (lot_id, predicted_price, metal_value, numismatic_premium, confidence_score, prediction_method, sample_size)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (lot_id) DO UPDATE SET
                predicted_price = EXCLUDED.predicted_price,
                metal_value = EXCLUDED.metal_value,
                numismatic_premium = EXCLUDED.numismatic_premium,
                confidence_score = EXCLUDED.confidence_score,
                prediction_method = EXCLUDED.prediction_method,
                sample_size = EXCLUDED.sample_size,
                created_at = NOW();
        `, [
            lotId,
            prediction.predicted_price,
            prediction.metal_value,
            prediction.numismatic_premium,
            prediction.confidence_score,
            prediction.prediction_method,
            prediction.sample_size
        ]);
    }

    // Генерация прогнозов для конкретного списка лотов (по их ID) — режим "избранного"
    async generatePredictionsForLots(lotIds) {
        console.log(`\n🎯 Генерируем прогнозы для ${lotIds.length} выбранных лотов (избранное)`);

        const lotsResult = await this.dbClient.query(`
            SELECT al.id, al.lot_number, al.condition, al.metal, al.weight,
                   al.fineness, al.pure_metal_weight, al.year, al.letters,
                   al.winning_bid, al.coin_description, al.auction_number,
                   al.category, al.auction_end_date, al.slab_status,
                   al.grading_company_code, al.slab_grade_code, al.grade_source,
                   linked.type_id, linked.grade AS link_grade,
                   linked.link_quality_status
            FROM auction_lots al
            LEFT JOIN LATERAL (
                SELECT ltl.type_id, ltl.grade, lq.status AS link_quality_status
                FROM lot_type_link ltl
                LEFT JOIN lot_type_link_quality lq
                  ON lq.lot_id = ltl.lot_id
                 AND lq.type_id = ltl.type_id
                 AND lq.audit_version = 'hard-consistency-v1'
                WHERE ltl.lot_id = al.id
                ORDER BY CASE lq.status
                    WHEN 'consistent' THEN 0
                    WHEN 'unverified' THEN 1
                    WHEN 'conflict' THEN 2
                    ELSE 1
                END, ltl.id
                LIMIT 1
            ) linked ON true
            WHERE al.id = ANY($1)
            ORDER BY al.lot_number
        `, [lotIds]);

        const lots = lotsResult.rows;
        console.log(`📋 Найдено ${lots.length} лотов для прогнозирования`);

        let savedCount = 0;
        for (const lot of lots) {
            try {
                const prediction = await this.predictPrice(lot);
                await this.savePrediction(lot.id, prediction);
                savedCount++;
                console.log(`✅ Прогноз для лота ${lot.lot_number}: ${prediction.predicted_price}₽ (${prediction.prediction_method})`);
            } catch (error) {
                console.error(`❌ Ошибка прогнозирования для лота ${lot.lot_number}:`, error.message);
            }
        }

        console.log(`✅ Сохранено ${savedCount} из ${lots.length} прогнозов`);
        return savedCount;
    }

    // Основная функция
    async generatePredictions() {
        console.log('🔮 ГЕНЕРАЦИЯ УЛУЧШЕННЫХ ПРОГНОЗОВ');
        
        // Текущий аукцион — через общий хелпер. Раньше здесь было
        // `ORDER BY auction_number DESC LIMIT 1` по varchar: после появления
        // numismat-номеров с префиксом ('n1056') это давало 'n99', а не 1015.
        const auctionNumber = await resolveCurrentAuctionNumber(this.dbClient);

        if (!auctionNumber) {
            console.log('❌ Активных аукционов не найдено');
            return;
        }

        console.log(`📊 Генерируем прогнозы только для текущего аукциона ${auctionNumber}`);

        await this.generatePredictionsForAuction(auctionNumber);
        
        console.log('\n🎉 Генерация улучшенных прогнозов завершена!');
    }
}

// Запуск
async function main() {
    const generator = new ImprovedPredictionsGenerator();
    try {
        await generator.init();
        
        // Проверяем аргументы командной строки
        const args = process.argv.slice(2);
        const watchlistIndex = args.indexOf('--watchlist');

        if (watchlistIndex !== -1 && args[watchlistIndex + 1]) {
            // Режим пересчета для конкретных лотов из избранного
            const lotIds = args[watchlistIndex + 1]
                .split(',')
                .map(id => parseInt(id.trim()))
                .filter(id => !isNaN(id));
            console.log(`🎯 Пересчет прогнозов для лотов из избранного: ${lotIds.join(', ')}`);
            await generator.generatePredictionsForLots(lotIds);
        } else if (args.length > 0) {
            const auctionNumber = args[0];
            console.log(`🎯 Генерируем прогнозы для указанного аукциона ${auctionNumber}`);
            await generator.generatePredictionsForAuction(auctionNumber);
        } else {
            await generator.generatePredictions();
        }
    } catch (error) {
        console.error('❌ Ошибка генерации прогнозов:', error);
    } finally {
        await generator.close();
    }
}

if (require.main === module) {
    main();
}

module.exports = ImprovedPredictionsGenerator;
