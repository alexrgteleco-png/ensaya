'use strict';

const http = require('http');
const path = require('path');

const { App, HttpError } = require('./lib/http');
const { sql, migrate } = require('./lib/db');
const { createSessionMiddleware } = require('./lib/session');
const { mountAuthRoutes, loginUrl } = require('./lib/oidc');
const { csrfToken, verifyCsrf, securityHeaders } = require('./lib/security');
const { layout, pageHead } = require('./lib/ui');
const { html } = require('./lib/html');
const storage = require('./lib/storage');
const limits = require('./lib/limits');
const cleanup = require('./lib/cleanup');
const { early } = require('./lib/http');

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

if (!process.env.SESSION_SECRET && isProduction) {
  console.error('Falta la variable SESSION_SECRET');
  process.exit(1);
}

const app = new App();
// Tráfico de salida: se cuenta y, si se llega al tope mensual, la app deja de servir hasta el día 1
// (así nunca se consume ancho de banda de pago ni se suspenden las demás apps del workspace).
app.onBytes = limits.addEgress;
app.use(securityHeaders);
app.use(
  early((req, res, next) => {
    if (req.path === '/healthz' || !limits.egressExceeded()) return next();
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '86400' });
    res.end('Ensaya ha alcanzado su tope de tráfico gratuito de este mes. Vuelve a estar disponible el día 1.');
  })
);
app.static('/', path.join(__dirname, 'public'), { maxAge: 3600 });

app.get('/healthz', (req, res) => res.text('ok'));

app.use(createSessionMiddleware({ secret: process.env.SESSION_SECRET || 'solo-para-desarrollo-local', secure: isProduction }));

// Contexto común para las vistas.
app.use((req, res, next) => {
  res.ctx = {
    user: req.session.user || null,
    path: req.originalUrl,
    get csrf() {
      return csrfToken(req);
    },
    flash: req.session.flash || null,
    group: null,
    isOwner: false,
  };
  if (req.method === 'GET' && req.session.flash) delete req.session.flash;
  return next();
});

app.use(verifyCsrf);

function renderError(req, res, status, message, { retryLogin = false } = {}) {
  const ctx = res.ctx || { user: null, path: req.originalUrl, csrf: '', flash: null };
  const titles = { 400: 'Algo no cuadra', 401: 'Tienes que entrar', 403: 'Sin acceso', 404: 'No encontrado', 405: 'No permitido', 413: 'Demasiado grande', 503: 'No disponible', 507: 'Sin espacio' };
  const title = titles[status] || 'Ha fallado algo';
  return res.html(
    layout(ctx, {
      title,
      body: html`<section class="narrow">
        ${pageHead(title, { lead: message })}
        <p class="actions">
          ${retryLogin ? html`<a class="button" href="/login">Entrar de nuevo</a>` : ''}
          <a class="button button-ghost" href="/">Ir a mis grupos</a>
        </p>
      </section>`,
    }),
    status
  );
}

const { upsertUser } = require('./routes/users');
mountAuthRoutes(app, { onLogin: upsertUser, renderError });

require('./routes/groups')(app);
require('./routes/songs')(app);
require('./routes/files')(app);
require('./routes/scores')(app);
require('./routes/events')(app);
require('./routes/setlists')(app);
require('./routes/tools')(app);

app.errorHandler = async (err, req, res) => {
  const status = err.status || 500;
  // Los HttpError son mensajes pensados para el usuario (también 503/507 de los topes de coste).
  const expected = err instanceof HttpError;
  if (!expected) console.error(err);
  const message = expected ? err.message : 'Ha fallado algo en el servidor. Inténtalo de nuevo en un momento.';
  if (String(req.headers.accept || '').includes('application/json') || req.path.startsWith('/api/') || req.method === 'PUT') {
    return res.json({ error: message }, status);
  }
  if (status === 401) return res.redirect(loginUrl(req), 302);
  return renderError(req, res, status, message);
};

async function start() {
  await migrate();
  await limits.flushEgress();
  setInterval(() => limits.flushEgress(), 30000).unref();
  cleanup.start();
  const server = http.createServer(app.handler());
  server.requestTimeout = 0; // subidas grandes de audio
  server.headersTimeout = 65000;
  server.listen(PORT, () => {
    console.log(`Ensaya escuchando en el puerto ${PORT} (almacenamiento: ${storage.driver})`);
  });
  const shutdown = () => {
    limits.flushEgress().catch(() => {});
    server.close(() => sql.end({ timeout: 5 }).finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('No se pudo arrancar:', err);
  process.exit(1);
});

module.exports = { HttpError };
