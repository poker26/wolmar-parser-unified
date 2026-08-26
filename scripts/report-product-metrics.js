'use strict';

const { Pool } = require('pg');
const config = require('../config');

function safeWindowDays(value) {
    const days = Number(value || 30);
    if (!Number.isSafeInteger(days) || days < 1 || days > 400) {
        throw new Error('METRICS_WINDOW_DAYS must be an integer from 1 to 400');
    }
    return days;
}

async function report(pool, windowDays) {
    const [events, current, retention] = await Promise.all([
        pool.query(
            `SELECT event_name, count(*)::int events,
                    count(DISTINCT user_pseudonym)::int users
             FROM product_event
             WHERE occurred_at >= now() - ($1::text || ' days')::interval
             GROUP BY event_name ORDER BY event_name`,
            [windowDays],
        ),
        pool.query(
            `WITH item_counts AS (
                SELECT user_id, count(*)::int items
                FROM collection_item WHERE deleted_at IS NULL GROUP BY user_id
             ), photo_activation AS (
                SELECT DISTINCT ci.user_id
                FROM collection_item ci
                JOIN collection_item_photo p ON p.item_id = ci.id
                WHERE ci.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'ready'
                GROUP BY ci.user_id, ci.id
                HAVING bool_or(p.side = 'obverse') AND bool_or(p.side = 'reverse')
             ), latest_valuation AS (
                SELECT ci.id, ci.type_id, cv.status
                FROM collection_item ci
                LEFT JOIN LATERAL (
                    SELECT status FROM collection_valuation
                    WHERE item_id = ci.id ORDER BY calculated_at DESC, id DESC LIMIT 1
                ) cv ON true
                WHERE ci.deleted_at IS NULL
             )
             SELECT
                (SELECT count(*)::int FROM app_user WHERE status = 'active') active_accounts,
                (SELECT count(*)::int FROM item_counts WHERE items >= 3) activated_users,
                (SELECT count(*)::int FROM photo_activation) photo_activated_users,
                count(*)::int collection_items,
                count(*) FILTER (WHERE type_id IS NOT NULL)::int linked_items,
                count(*) FILTER (WHERE status = 'ready')::int valued_items
             FROM latest_valuation`,
        ),
        pool.query(
            `WITH signups AS (
                SELECT user_pseudonym, min(occurred_at) signup_at
                FROM product_event WHERE event_name = 'signup_completed'
                GROUP BY user_pseudonym
             )
             SELECT
                count(*) FILTER (WHERE signup_at <= now() - interval '7 days')::int d7_eligible,
                count(*) FILTER (
                    WHERE signup_at <= now() - interval '7 days'
                      AND EXISTS (
                        SELECT 1 FROM product_event e
                        WHERE e.user_pseudonym = signups.user_pseudonym
                          AND e.occurred_at >= signups.signup_at + interval '7 days'
                          AND e.occurred_at < signups.signup_at + interval '8 days'
                      )
                )::int d7_retained,
                count(*) FILTER (WHERE signup_at <= now() - interval '30 days')::int d30_eligible,
                count(*) FILTER (
                    WHERE signup_at <= now() - interval '30 days'
                      AND EXISTS (
                        SELECT 1 FROM product_event e
                        WHERE e.user_pseudonym = signups.user_pseudonym
                          AND e.occurred_at >= signups.signup_at + interval '30 days'
                          AND e.occurred_at < signups.signup_at + interval '31 days'
                      )
                )::int d30_retained
             FROM signups`,
        ),
    ]);
    const state = current.rows[0];
    const cohort = retention.rows[0];
    const ratio = (part, total) => total ? Number((part / total).toFixed(4)) : null;
    return {
        generatedAt: new Date().toISOString(),
        eventWindowDays: windowDays,
        events: events.rows,
        current: {
            activeAccounts: state.active_accounts,
            activatedUsers: state.activated_users,
            photoActivatedUsers: state.photo_activated_users,
            collectionItems: state.collection_items,
            linkedItems: state.linked_items,
            linkedItemShare: ratio(state.linked_items, state.collection_items),
            valuedItems: state.valued_items,
            valuedItemShare: ratio(state.valued_items, state.collection_items),
        },
        retention: {
            d7Eligible: cohort.d7_eligible,
            d7Retained: cohort.d7_retained,
            d7Rate: ratio(cohort.d7_retained, cohort.d7_eligible),
            d30Eligible: cohort.d30_eligible,
            d30Retained: cohort.d30_retained,
            d30Rate: ratio(cohort.d30_retained, cohort.d30_eligible),
        },
    };
}

async function main() {
    const pool = new Pool({ ...config.dbConfig, max: 3 });
    try {
        console.log(JSON.stringify(await report(pool, safeWindowDays(process.env.METRICS_WINDOW_DAYS)), null, 2));
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`product metrics failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { report, safeWindowDays };
