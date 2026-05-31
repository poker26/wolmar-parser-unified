const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

// ─── Нормализованный suspicious_score (0..100) ───────────────────────────────
// ЕДИНЫЙ источник правды формулы — обязан совпадать с suspiciousScoreSql()
// в analytics-service/analytics-service.js. core = специфичные манипуляции,
// act = активностные сигналы (лишь корроборатор ≤20; при core==0 итог = 0, F2).
const CORE_SIGNALS = [
    ['linked_accounts_score', 1.5, 50],
    ['carousel_score', 1.5, 50],
    ['self_boost_score', 1.5, 40],
    ['pricing_strategies_score', 1.2, 40],
    ['circular_buyers_score', 1.2, 40],
    ['decoy_tactics_score', 1.2, 40],
];
const ACT_SIGNALS = [
    ['fast_bids_score', 1.0, 50],
    ['autobid_traps_score', 1.0, 50],
    ['abandonment_score', 1.0, 30],
    ['technical_bidders_score', 0.8, 20],
];
const CORE_WSUM = CORE_SIGNALS.reduce((a, [, w]) => a + w, 0); // 8.1
const ACT_WSUM = ACT_SIGNALS.reduce((a, [, w]) => a + w, 0);   // 3.8

function groupWeightedSql(signals, prefix, overrides) {
    return signals.map(([col, w, mx]) => {
        const v = (overrides && overrides[col] !== undefined) ? overrides[col] : `COALESCE(${prefix}${col}, 0)`;
        return `LEAST(${w}, (${v})::numeric / ${mx} * ${w})`;
    }).join(' + ');
}

function suspiciousScoreSql(prefix = '', overrides = {}) {
    const coreSum = groupWeightedSql(CORE_SIGNALS, prefix, overrides);
    const actSum = groupWeightedSql(ACT_SIGNALS, prefix, overrides);
    return `CASE WHEN (${coreSum}) > 0
        THEN LEAST(100, ROUND(
            ((${coreSum}) / ${CORE_WSUM} * 100) * 0.85
            + LEAST(20, (${actSum}) / ${ACT_WSUM} * 100 * 0.2)
        ))
        ELSE 0 END`;
}

async function addRiskManagementScores() {
    try {
        console.log('🚀 Добавление полей для системы риск-менеджмента...');
        
        // Критичные (коэффициент 1.5, макс 50 баллов)
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS linked_accounts_score INTEGER DEFAULT 0;`);
        console.log('✅ Добавлено поле: linked_accounts_score');
        
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS carousel_score INTEGER DEFAULT 0;`);
        console.log('✅ Добавлено поле: carousel_score');
        
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS self_boost_score INTEGER DEFAULT 0;`);
        console.log('✅ Добавлено поле: self_boost_score');
        
        // Высокие (коэффициент 1.2, макс 40 баллов)
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS decoy_tactics_score INTEGER DEFAULT 0;`);
        console.log('✅ Добавлено поле: decoy_tactics_score');
        
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS pricing_strategies_score INTEGER DEFAULT 0;`);
        console.log('✅ Добавлено поле: pricing_strategies_score');
        
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS circular_buyers_score INTEGER DEFAULT 0;`);
        console.log('✅ Добавлено поле: circular_buyers_score');
        
        // Средние (коэффициент 1.0, макс 30 баллов)
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS abandonment_score INTEGER DEFAULT 0;`);
        console.log('✅ Добавлено поле: abandonment_score');
        
        // Низкие (коэффициент 0.8, макс 20 баллов)
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS technical_bidders_score INTEGER DEFAULT 0;`);
        console.log('✅ Добавлено поле: technical_bidders_score');
        
        // Создаем функцию для пересчета suspicious_score
        console.log('📊 Создание функции для пересчета suspicious_score...');
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_suspicious_score()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.suspicious_score = ${suspiciousScoreSql('NEW.')};
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Функция update_suspicious_score создана');
        
        // Создаем триггер для автоматического пересчета
        await pool.query(`
            DROP TRIGGER IF EXISTS trigger_update_suspicious_score ON winner_ratings;
            CREATE TRIGGER trigger_update_suspicious_score
            BEFORE INSERT OR UPDATE ON winner_ratings
            FOR EACH ROW
            EXECUTE FUNCTION update_suspicious_score();
        `);
        console.log('✅ Триггер для автоматического пересчета создан');
        
        // Пересчитываем suspicious_score для всех существующих записей
        console.log('🔄 Пересчет suspicious_score для всех существующих записей...');
        const updateResult = await pool.query(`
            UPDATE winner_ratings
            SET suspicious_score = ${suspiciousScoreSql()};
        `);
        console.log(`✅ Обновлено ${updateResult.rowCount} записей`);
        
        console.log('\n✅ Миграция завершена успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка миграции:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Запуск
if (require.main === module) {
    addRiskManagementScores()
        .then(() => {
            console.log('✅ Скрипт выполнен успешно');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Ошибка выполнения скрипта:', error);
            process.exit(1);
        });
}

module.exports = { addRiskManagementScores };

