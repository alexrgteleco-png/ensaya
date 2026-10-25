'use strict';

// Almacenamiento de archivos (audios, partituras...).
// - Cloudflare R2 (o cualquier S3) si hay credenciales: firma AWS SigV4 propia, sin SDK.
// - Disco local en otro caso (desarrollo). En Render gratuito el disco se borra en cada despliegue.

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const S3_ENDPOINT = (process.env.S3_ENDPOINT || (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '')).replace(/\/$/, '');
const S3_BUCKET = process.env.R2_BUCKET || process.env.S3_BUCKET || '';
const S3_KEY = process.env.R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || '';
const S3_SECRET = process.env.R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || '';
const S3_REGION = process.env.S3_REGION || 'auto';
const LOCAL_DIR = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, '..', 'data', 'uploads'));

const useS3 = Boolean(S3_ENDPOINT && S3_BUCKET && S3_KEY && S3_SECRET);

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function encodeKey(key) {
  return key
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

// Firma AWS Signature V4 (cabecera Authorization). Función pura para poder probarla
// con los ejemplos oficiales de AWS.
function signV4({ method, path: canonicalUri, headers: rawHeaders, payloadHash, now, region, accessKey, secretKey }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const headers = {
    ...Object.fromEntries(Object.entries(rawHeaders).map(([k, v]) => [k.toLowerCase(), String(v)])),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, signature };
}

// Construye una petición firmada (SigV4, path-style).
function signedRequest(method, key, extraHeaders = {}) {
  const endpoint = new URL(S3_ENDPOINT);
  const canonicalUri = `${endpoint.pathname.replace(/\/$/, '')}/${S3_BUCKET}/${encodeKey(key)}`;
  const { headers } = signV4({
    method,
    path: canonicalUri,
    headers: { host: endpoint.host, ...extraHeaders },
    payloadHash: 'UNSIGNED-PAYLOAD',
    now: new Date(),
    region: S3_REGION,
    accessKey: S3_KEY,
    secretKey: S3_SECRET,
  });
  const lib = endpoint.protocol === 'http:' ? http : https;
  return { lib, options: { method, hostname: endpoint.hostname, port: endpoint.port || undefined, path: canonicalUri, headers } };
}

function s3Call(method, key, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const { lib, options } = signedRequest(method, key, headers);
    const req = lib.request(options, (res) => resolve(res));
    req.on('error', reject);
    if (body && typeof body.pipe === 'function') {
      body.on('error', (err) => req.destroy(err));
      body.pipe(req);
    } else {
      req.end(body);
    }
  });
}

async function drain(res) {
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// Sube un stream de tamaño conocido.
async function put(key, stream, size, contentType) {
  if (useS3) {
    const res = await s3Call('PUT', key, {
      headers: { 'content-length': size, 'content-type': contentType || 'application/octet-stream' },
      body: stream,
    });
    const text = await drain(res);
    if (res.statusCode >= 300) throw new Error(`Error al subir a R2 (HTTP ${res.statusCode}): ${text.slice(0, 200)}`);
    return;
  }
  const file = path.join(LOCAL_DIR, key);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  await pipeline(stream, fs.createWriteStream(tmp));
  const stat = await fs.promises.stat(tmp);
  if (stat.size !== size) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw new Error('La subida se cortó antes de terminar.');
  }
  await fs.promises.rename(tmp, file);
}

// Devuelve { status, headers, stream } con soporte de Range (para audio y PDF).
async function get(key, range) {
  if (useS3) {
    const res = await s3Call('GET', key, { headers: range ? { range } : {} });
    if (res.statusCode === 404) {
      res.resume();
      return null;
    }
    if (res.statusCode >= 300) {
      const text = await drain(res);
      throw new Error(`Error al leer de R2 (HTTP ${res.statusCode}): ${text.slice(0, 200)}`);
    }
    const headers = {};
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      if (res.headers[h]) headers[h] = res.headers[h];
    }
    headers['accept-ranges'] = 'bytes';
    return { status: res.statusCode, headers, stream: res };
  }
  const file = path.join(LOCAL_DIR, key);
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return null;
  }
  const size = stat.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return { status: 416, headers: { 'content-range': `bytes */${size}` }, stream: null };
    }
    return {
      status: 206,
      headers: { 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' },
      stream: fs.createReadStream(file, { start, end }),
    };
  }
  return { status: 200, headers: { 'content-length': size, 'accept-ranges': 'bytes' }, stream: fs.createReadStream(file) };
}

async function remove(key) {
  if (useS3) {
    const res = await s3Call('DELETE', key);
    await drain(res);
    return;
  }
  await fs.promises.unlink(path.join(LOCAL_DIR, key)).catch(() => {});
}

function newKey(groupId, filename) {
  const ext = (path.extname(filename || '').toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0];
  return `g${groupId}/${crypto.randomBytes(16).toString('hex')}${ext}`;
}

module.exports = { put, get, remove, newKey, signV4, driver: useS3 ? 'r2' : 'local' };
