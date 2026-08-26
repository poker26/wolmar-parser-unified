'use strict';

const { Pool } = require('pg');
const config = require('../config');

function safeWindowHours(value) {
    const hours = Number(value || 24);
    if (!Number.isSafeInteger(hours) || hours < 1 || hours > 24 * 30) {
        throw new Error('SECURITY_REPORT_HOURS must be an integer from 1 to 720');
    }
    return hours;
}

async function report(pool, windowHours) {
    const [audit, limits] = await Promise.all([
        pool.query(
            `SELECT action, outcome, COALESCE(reason_code, 'none') reason_code,
                    count(*)::int events
             FROM security_audit_event
             WHERE occurred_at >= now() - ($1::text || ' hours')::interval
             GROUP BY action, outcome, reason_code
             ORDER BY action, outcome, reason_code`,
            [windowHours],
        ),
        pool.query(
            `SELECT action, count(*)::int active_buckets,
                    sum(request_count)::int requests,
                    max(request_count)::int peak_bucket
             FROM security_rate_limit
             WHERE expires_at > now()
             GROUP BY action ORDER BY action`,
        ),
    ]);
    return {
        generatedAt: new Date().toISOString(),
        windowHours,
        audit: audit.rows,
        activeRateLimits: limits.rows,
    };
}

async function main() {
    const pool = new Pool({ ...config.dbConfig, max: 2 });
    try {
        console.log(JSON.stringify(await report(pool, safeWindowHours(process.env.SECURITY_REPORT_HOURS)), null, 2));
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`security report failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { report, safeWindowHours };
