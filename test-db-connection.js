#!/usr/bin/env node
/**
 * Тест подключения к self-hosted Supabase.
 * Запуск: node test-db-connection.js
 * Или с параметрами: DB_HOST=sup.begemot26.ru DB_PORT=5432 node test-db-connection.js
 */
require('dotenv').config();
const { Client } = require('pg');

const config = {
    user: process.env.DB_USER || 'postgres.your-tenant-id',
    host: process.env.DB_HOST || 'sup.begemot26.ru',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    ssl: false,
    connectionTimeoutMillis: 5000
};

console.log('Параметры подключения:');
console.log('  host:', config.host);
console.log('  port:', config.port);
console.log('  user:', config.user);
console.log('  database:', config.database);
console.log('  password:', config.password ? '***' : '(не задан!)');
console.log('  ssl:', config.ssl);
console.log('');

const client = new Client(config);

client.connect()
    .then(() => client.query('SELECT 1 as test, version()'))
    .then((res) => {
        console.log('✅ Подключение успешно!');
        console.log('   PostgreSQL:', res.rows[0].version);
        return client.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Ошибка:', err.message);
        client.end().catch(() => {});
        process.exit(1);
    });
