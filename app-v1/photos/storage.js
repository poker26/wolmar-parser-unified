'use strict';

const fs = require('node:fs');
const Minio = require('minio');

const DEFAULT_BUCKET = 'user-coin-photos';
const DEFAULT_ENV_FILE = '/opt/numismatics/.env';

function readEnvFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return {};
    return Object.fromEntries(
        fs.readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#') && line.includes('='))
            .map((line) => {
                const index = line.indexOf('=');
                return [
                    line.slice(0, index).trim(),
                    line.slice(index + 1).trim().replace(/^["']|["']$/g, ''),
                ];
            }),
    );
}

function minioConfig({ env = process.env, envFile = env.MINIO_ENV_FILE || DEFAULT_ENV_FILE } = {}) {
    const values = { ...readEnvFile(envFile), ...env };
    const rawEndpoint = values.MINIO_ENDPOINT;
    if (!rawEndpoint || !values.MINIO_ACCESS_KEY || !values.MINIO_SECRET_KEY) {
        throw new Error('MINIO_ENDPOINT, MINIO_ACCESS_KEY and MINIO_SECRET_KEY are required');
    }
    const endpoint = rawEndpoint.includes('://') ? new URL(rawEndpoint) : null;
    const secure = endpoint
        ? endpoint.protocol === 'https:'
        : String(values.MINIO_SECURE || 'true').toLowerCase() !== 'false';
    return {
        client: {
            endPoint: endpoint ? endpoint.hostname : rawEndpoint,
            port: Number(values.MINIO_PORT || endpoint?.port || (secure ? 443 : 9000)),
            useSSL: secure,
            accessKey: values.MINIO_ACCESS_KEY,
            secretKey: values.MINIO_SECRET_KEY,
        },
        bucket: values.COLLECTION_PHOTO_BUCKET || DEFAULT_BUCKET,
    };
}

class MinioPhotoStorage {
    constructor({ client = null, bucket = null, config = null } = {}) {
        this.client = client;
        this.bucket = bucket;
        this.config = config;
    }

    resolve() {
        if (!this.client) {
            const resolved = this.config || minioConfig();
            this.client = new Minio.Client(resolved.client);
            this.bucket = this.bucket || resolved.bucket;
        }
        this.bucket ||= DEFAULT_BUCKET;
        return this.client;
    }

    async uploadUrl(objectKey, expiresSeconds = 600) {
        return this.resolve().presignedPutObject(this.bucket, objectKey, expiresSeconds);
    }

    async downloadUrl(objectKey, expiresSeconds = 600) {
        return this.resolve().presignedGetObject(this.bucket, objectKey, expiresSeconds);
    }

    async stat(objectKey) {
        const result = await this.resolve().statObject(this.bucket, objectKey);
        return {
            byteSize: Number(result.size),
            mimeType: result.metaData?.['content-type'] || result.metaData?.['Content-Type'] || null,
            etag: result.etag || null,
        };
    }

    async getBuffer(objectKey, maxBytes = 21 * 1024 * 1024) {
        const stream = await this.resolve().getObject(this.bucket, objectKey);
        const chunks = [];
        let total = 0;
        for await (const chunk of stream) {
            total += chunk.length;
            if (total > maxBytes) {
                stream.destroy();
                throw new Error('Photo object exceeds processing limit');
            }
            chunks.push(chunk);
        }
        return Buffer.concat(chunks, total);
    }

    async putBuffer(objectKey, buffer, mimeType) {
        return this.resolve().putObject(
            this.bucket,
            objectKey,
            buffer,
            buffer.length,
            { 'Content-Type': mimeType },
        );
    }

    async remove(objectKey) {
        return this.resolve().removeObject(this.bucket, objectKey);
    }
}

module.exports = {
    DEFAULT_BUCKET,
    MinioPhotoStorage,
    minioConfig,
    readEnvFile,
};
