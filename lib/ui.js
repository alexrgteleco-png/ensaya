'use strict';

const { html, raw } = require('./html');

const PLATFORM_URL = (process.env.PLATFORM_URL || '').replace(/\/$/, '');

const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.5"/>',
  tools: '<path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5"/><circle cx="12" cy="12" r="4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  score: '<path d="M3 6h18M3 9h18M3 12h18M3 15h18M3 18h18"/><circle cx="9" cy="15" r="1.6" fill="currentColor"/><path d="M10.6 15V7"/>',
  stage: '<path d="M4 20h16M6 20V9l6-5 6 5v11"/><path d="M10 20v-5h4v5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
};

function icon(name, size = 18) {
  return raw(`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
}

function avatar(name, cls = '') {
  return html`<span class="avatar ${cls}" aria-hidden="true">${initials(name)}</span>`;
}

function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => html`<p>${p.split('\n').map((line, i) => (i === 0 ? html`${line}` : html`<br>${line}`))}</p>`);
}

function csrfField(ctx) {
  return html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
}

// Botón que envía un POST (con confirmación opcional).
function postButton(ctx, action, label, { cls = 'button button-ghost', confirm = '', fields = {} } = {}) {
  return html`<form method="post" action="${action}" class="inline" ${confirm ? html`data-confirm="${confirm}"` : ''}>
    ${csrfField(ctx)}
    ${Object.entries(fields).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <button type="submit" class="${cls}">${label}</button>
  </form>`;
}

const STAVE = raw('<svg class="stave" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 4H100M0 12H100M0 20H100M0 28H100M0 36H100" vector-effect="non-scaling-stroke"/></svg>');

function groupNav(group, active, isOwner) {
  const base = `/g/${group.id}`;
  const items = [
    ['inicio', base, 'Inicio', 'home'],
    ['repertorio', `${base}/canciones`, 'Repertorio', 'music'],
    ['agenda', `${base}/agenda`, 'Agenda', 'calendar'],
    ['setlists', `${base}/setlists`, 'Setlists', 'list'],
    ['miembros', `${base}/miembros`, 'Miembros', 'users'],
    ['herramientas', `${base}/herramientas`, 'Afinador y metrónomo', 'tools'],
  ];
  if (isOwner) items.push(['ajustes', `${base}/ajustes`, 'Ajustes', 'settings']);
  return html`<nav class="groupnav" aria-label="Secciones del grupo">
    ${items.map(([key, href, label, ic]) => html`<a href="${href}" class="${active === key ? 'active' : ''}" ${active === key ? raw('aria-current="page"') : ''}>${icon(ic)}<span>${label}</span></a>`)}
  </nav>`;
}

function layout(ctx, { title, body, active = '', scripts = [], modules = [], bodyClass = '', bare = false, refresh = null }) {
  const user = ctx.user;
  const group = ctx.group;
  const pageTitle = [title, group && group.name, 'Ensaya'].filter(Boolean).join(' · ');
  return html`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  ${refresh ? html`<meta http-equiv="refresh" content="${refresh.seconds};url=${refresh.url}">` : ''}
  <title>${pageTitle}</title>
  <meta name="description" content="Repertorio, partituras, ensayos y setlists de tu grupo de música, en un solo sitio.">
  <meta name="theme-color" content="#172033">
  <meta name="csrf-token" content="${user ? ctx.csrf : ''}">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Familjen+Grotesk:wght@500;600;700&display=swap">
  <link rel="stylesheet" href="/styles.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/icon-192.png">
  <script src="/app.js" defer></script>
  ${scripts.map((s) => html`<script src="${s}" defer></script>`)}
  ${modules.map((s) => html`<script type="module" src="${s}"></script>`)}
</head>
<body class="${bodyClass}">
  ${bare
    ? body
    : html`<header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="/" aria-label="Ensaya, inicio">
        <span class="brand-mark" aria-hidden="true">${STAVE}<span class="brand-clef">E</span></span>
        <span class="brand-name">Ensaya</span>
      </a>
      ${group ? html`<a class="topbar-group" href="/g/${group.id}" title="${group.name}">${group.name}</a>` : ''}
      <nav class="topnav" aria-label="Cuenta">
        ${user
          ? html`<a href="/" class="hide-sm">Mis grupos</a>
              <form method="post" action="/logout" class="inline">
                ${csrfField(ctx)}
                <button type="submit" class="link-button" title="Cerrar sesión de ${user.name}">${avatar(user.name)}<span class="hide-sm">Salir</span></button>
              </form>`
          : html`<a href="/login?returnTo=${encodeURIComponent(ctx.path)}" class="button button-small">Entrar</a>`}
      </nav>
    </div>
  </header>
  <div class="shell ${group ? 'has-nav' : ''}">
    ${group ? groupNav(group, active, ctx.isOwner) : ''}
    <main id="main">
      ${ctx.flash ? html`<p class="flash flash-${ctx.flash.type}" role="status">${ctx.flash.message}</p>` : ''}
      ${body}
    </main>
  </div>
  <footer class="footer">
    <span>Ensaya es una app de ${PLATFORM_URL ? html`<a href="${PLATFORM_URL}">theaipeoplehub</a>` : 'theaipeoplehub'}</span>
    ${PLATFORM_URL ? html`<span><a href="${PLATFORM_URL}/privacidad">Privacidad</a> · <a href="${PLATFORM_URL}/aviso-legal">Aviso legal</a></span>` : ''}
  </footer>`}
</body>
</html>`;
}

function pageHead(title, { lead = '', actions = '' } = {}) {
  return html`<div class="pagehead">
    <div>
      <h1>${title}</h1>
      ${lead ? html`<p class="lead">${lead}</p>` : ''}
    </div>
    ${actions ? html`<div class="pagehead-actions">${actions}</div>` : ''}
  </div>`;
}

function empty(message, action = '') {
  return html`<div class="empty">${STAVE}<p>${message}</p>${action}</div>`;
}

// Datos para scripts de cliente sin romper la CSP (sin <script> inline).
function jsonData(id, value) {
  const json = JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return raw(`<script type="application/json" id="${id}">${json}</script>`);
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

module.exports = { layout, pageHead, empty, csrfField, postButton, avatar, initials, paragraphs, icon, jsonData, formatBytes, STAVE, PLATFORM_URL };
