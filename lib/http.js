'use strict';

// Mini framework HTTP sobre el módulo http de Node: rutas con parámetros,
// middleware, cookies, cuerpo urlencoded/JSON y ficheros estáticos.
// Sin dependencias externas.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.txt', '.map']);
const gzipCache = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), keys };
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((pair) => {
      const i = pair.indexOf('=');
      if (i < 0) return;
      const k = pair.slice(0, i).trim();
      if (!k) return;
      try {
        out[k] = decodeURIComponent(pair.slice(i + 1).trim());
      } catch {
        out[k] = pair.slice(i + 1).trim();
      }
    });
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Petición demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseBody(req, limit) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (type !== 'application/x-www-form-urlencoded' && type !== 'application/json') return {};
  const buf = await readBody(req, limit);
  const text = buf.toString('utf8');
  if (type === 'application/json') {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, 'JSON no válido');
    }
  }
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) {
    if (k in out) {
      out[k] = Array.isArray(out[k]) ? [...out[k], v] : [out[k], v];
    } else {
      out[k] = v;
    }
  }
  return out;
}

function acceptsGzip(req) {
  return /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
}

// Envía un cuerpo de texto comprimido con gzip si el navegador lo acepta (ahorra ancho de banda).
function sendBody(req, res, status, type, body) {
  if (res.headersSent) return;
  let buf = Buffer.from(String(body));
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
  if (buf.length > 1024 && acceptsGzip(req)) {
    buf = zlib.gzipSync(buf, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

// Cuenta los bytes que salen hacia el navegador (tráfico de salida de Render).
function countBytes(res, onBytes) {
  const write = res.write.bind(res);
  const end = res.end.bind(res);
  const size = (chunk, enc) => (chunk ? (Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), typeof enc === 'string' ? enc : 'utf8')) : 0);
  res.write = (chunk, enc, cb) => {
    onBytes(size(chunk, enc));
    return write(chunk, enc, cb);
  };
  res.end = (chunk, enc, cb) => {
    onBytes(size(chunk, enc) + 300);
    return end(chunk, enc, cb);
  };
}

function decorate(req, res) {
  res.html = (body, status = 200) => sendBody(req, res, status, 'text/html; charset=utf-8', body);
  res.json = (obj, status = 200) => sendBody(req, res, status, 'application/json; charset=utf-8', JSON.stringify(obj));
  res.text = (body, status = 200) => {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(body));
  };
  res.redirect = (location, status = 303) => {
    if (res.headersSent) return;
    res.writeHead(status, { Location: location });
    res.end();
  };
  res.cookie = (name, value, opts = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path || '/'}`];
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
    if (opts.httpOnly !== false) parts.push('HttpOnly');
    parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
    if (opts.secure) parts.push('Secure');
    const prev = res.getHeader('Set-Cookie');
    const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
    res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
  };
  return res;
}

class App {
  constructor() {
    this.middleware = [];
    this.routes = [];
    this.statics = [];
    this.errorHandler = null;
    this.notFoundHandler = null;
  }

  use(fn) {
    this.middleware.push(fn);
  }

  static(prefix, dir, { maxAge = 3600 } = {}) {
    this.statics.push({ prefix, dir: path.resolve(dir), maxAge });
  }

  route(method, pattern, ...handlers) {
    let options = {};
    if (handlers.length && typeof handlers[0] === 'object') options = handlers.shift();
    this.routes.push({ method, ...compile(pattern), handlers, options });
  }

  get(p, ...h) { this.route('GET', p, ...h); }
  post(p, ...h) { this.route('POST', p, ...h); }
  put(p, ...h) { this.route('PUT', p, ...h); }
  delete(p, ...h) { this.route('DELETE', p, ...h); }

  serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    for (const s of this.statics) {
      if (!req.path.startsWith(s.prefix)) continue;
      const rel = req.path.slice(s.prefix.length);
      let decoded;
      try {
        decoded = decodeURIComponent(rel);
      } catch {
        return false;
      }
      const file = path.resolve(s.dir, `.${path.posix.normalize(`/${decoded}`)}`);
      if (!file.startsWith(s.dir + path.sep)) continue;
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return true;
      }
      const ext = path.extname(file).toLowerCase();
      const isVendor = rel.startsWith('vendor/');
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        ETag: etag,
        Vary: 'Accept-Encoding',
        // Las librerías de vendor/ casi nunca cambian: caché larga para no gastar ancho de banda.
        'Cache-Control': path.basename(file) === 'sw.js' ? 'no-cache' : `public, max-age=${isVendor ? 7 * 86400 : s.maxAge}`,
      };
      if (path.basename(file) === 'sw.js') headers['Service-Worker-Allowed'] = '/';
      if (COMPRESSIBLE.has(ext) && acceptsGzip(req) && stat.size > 1024) {
        const cacheKey = `${file}:${stat.mtimeMs}`;
        let gz = gzipCache.get(cacheKey);
        if (!gz) {
          gz = zlib.gzipSync(fs.readFileSync(file), { level: 9 });
          gzipCache.set(cacheKey, gz);
        }
        headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = gz.length;
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : gz);
        return true;
      }
      headers['Content-Length'] = stat.size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        res.end();
      } else {
        fs.createReadStream(file).pipe(res);
      }
      return true;
    }
    return false;
  }

  handler() {
    return async (req, res) => {
      if (this.onBytes) countBytes(res, this.onBytes);
      decorate(req, res);
      const url = new URL(req.url, 'http://localhost');
      req.path = url.pathname;
      req.query = Object.fromEntries(url.searchParams);
      req.originalUrl = req.url;
      req.cookies = parseCookies(req.headers.cookie);
      req.params = {};
      req.body = {};
      try {
        for (const fn of this.middleware.filter((m) => m.early)) {
          let nextCalled = false;
          await fn(req, res, () => { nextCalled = true; });
          if (!nextCalled || res.writableEnded) return;
        }
        if (this.serveStatic(req, res)) return;

        const method = req.method === 'HEAD' ? 'GET' : req.method;
        let match = null;
        let pathMatched = false;
        for (const r of this.routes) {
          const m = r.regex.exec(req.path);
          if (!m) continue;
          pathMatched = true;
          if (r.method !== method) continue;
          match = r;
          r.keys.forEach((k, i) => {
            req.params[k] = decodeURIComponent(m[i + 1]);
          });
          break;
        }
        req.route = match;
        if (!match) {
          if (pathMatched) throw new HttpError(405, 'Método no permitido');
          throw new HttpError(404, 'Página no encontrada');
        }
        if (!match.options.rawBody && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
          req.body = await parseBody(req, match.options.bodyLimit || 256 * 1024);
        }
        const chain = [...this.middleware.filter((m) => !m.early), ...match.handlers];
        let i = 0;
        const next = async (err) => {
          if (err) throw err;
          const fn = chain[i++];
          if (!fn) return;
          await fn(req, res, next);
        };
        await next();
      } catch (err) {
        if (this.errorHandler) {
          try {
            await this.errorHandler(err, req, res);
            return;
          } catch (e2) {
            console.error(e2);
          }
        }
        if (!res.headersSent) res.text(err.message || 'Error', err.status || 500);
        else res.end();
      }
    };
  }
}

function early(fn) {
  fn.early = true;
  return fn;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = { App, HttpError, early, randomToken, readBody, MIME };
