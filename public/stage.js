/* Modo escenario: letras y acordes a pantalla completa, pedal o flechas para avanzar,
 * desplazamiento automático, transposición en vivo y uso sin conexión. */
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('stage-data').textContent);
  var root = document.querySelector('[data-stage-root]');
  var main = root.querySelector('[data-main]');
  var listEl = root.querySelector('[data-list]');
  var posEl = root.querySelector('[data-pos]');
  var keyEl = root.querySelector('[data-key]');
  var prevBtn = root.querySelector('[data-act="prev"]');
  var nextBtn = root.querySelector('[data-act="next"]');
  var scrollBtn = root.querySelector('[data-act="scroll"]');
  var speedInput = root.querySelector('[data-scroll-speed]');
  var chordsBtn = root.querySelector('[data-act="chords"]');
  var themeBtn = root.querySelector('[data-act="theme"]');
  var offlineBtn = root.querySelector('[data-offline]');
  var C = window.ChordPro;
  var items = data.items;
  var STORE = 'ensaya.stage.';

  function load(k, d) {
    try { var v = localStorage.getItem(STORE + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
  }
  function store(k, v) {
    try { localStorage.setItem(STORE + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ }
  }

  var state = {
    index: 0,
    transpose: items.map(function (i) { return i.transpose || 0; }),
    size: load('size', 30),
    chords: load('chords', true),
    light: load('light', false),
    scrolling: false,
    speed: load('speed', 3),
  };
  var scrollAcc = 0;
  var wakeLock = null;

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function songNumber(i) {
    var n = 0;
    for (var k = 0; k <= i; k++) if (items[k].kind === 'song') n++;
    return n;
  }

  function applyPrefs() {
    main.style.setProperty('--stage-size', state.size + 'px');
    main.classList.toggle('hide-chords', !state.chords);
    chordsBtn.setAttribute('aria-pressed', String(state.chords));
    document.body.classList.toggle('stage-light', state.light);
    themeBtn.textContent = state.light ? 'Oscuro' : 'Claro';
    speedInput.value = state.speed;
  }

  function render() {
    var item = items[state.index];
    if (!item) {
      main.innerHTML = '<div class="stage-break"><div><b>Setlist vacío</b><p>Añade canciones para usar el modo escenario.</p></div></div>';
      posEl.textContent = '';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }
    var t = state.transpose[state.index];
    var html = '';
    if (item.kind === 'song') {
      var key = item.key ? C.transposeKey(item.key, t) : '';
      keyEl.textContent = key || (t ? (t > 0 ? '+' : '') + t : '—');
      html += '<h1 class="stage-title">' + songNumber(state.index) + '. ' + esc(item.title) + '</h1>';
      var meta = [item.artist, key ? 'Tono ' + key + (t ? ' (' + (t > 0 ? '+' : '') + t + ')' : '') : '', item.bpm ? item.bpm + ' bpm' : '', item.meter].filter(Boolean);
      if (meta.length) html += '<div class="stage-meta">' + meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div>';
      if (item.note) html += '<div class="stage-note">' + esc(item.note) + '</div>';
      html += item.lyrics ? '<div class="chordpro">' + C.render(item.lyrics, t, { key: item.key }) + '</div>' : '<p class="stage-meta">Esta canción no tiene letra ni acordes.</p>';
    } else if (item.kind === 'break') {
      keyEl.textContent = '—';
      html = '<div class="stage-break"><div><b>Descanso</b><p>' + item.breakMin + ' minutos</p>' + (item.note ? '<div class="stage-note">' + esc(item.note) + '</div>' : '') + '</div></div>';
    } else {
      keyEl.textContent = '—';
      html = '<div class="stage-break"><div><b>' + esc(item.title) + '</b>' + (item.note ? '<div class="stage-note">' + esc(item.note) + '</div>' : '') + '</div></div>';
    }
    main.innerHTML = html;
    main.scrollTop = 0;
    scrollAcc = 0;
    posEl.textContent = (state.index + 1) + ' / ' + items.length;
    prevBtn.disabled = state.index === 0;
    nextBtn.disabled = state.index === items.length - 1;
    root.querySelector('[data-prev-title]').textContent = state.index > 0 ? items[state.index - 1].title : '';
    root.querySelector('[data-next-title]').textContent = state.index < items.length - 1 ? items[state.index + 1].title : 'Fin';
    document.title = item.title + ' · ' + data.name;
  }

  function go(i) {
    if (i < 0 || i >= items.length) return;
    state.index = i;
    render();
    renderList();
  }

  function renderList() {
    listEl.innerHTML = '';
    items.forEach(function (it, i) {
      var b = document.createElement('button');
      b.type = 'button';
      if (i === state.index) b.className = 'current';
      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = it.kind === 'song' ? String(songNumber(i)) : '·';
      b.appendChild(n);
      b.appendChild(document.createTextNode(it.kind === 'break' ? 'Descanso (' + it.breakMin + ' min)' : it.title));
      b.addEventListener('click', function () { go(i); toggleList(false); });
      listEl.appendChild(b);
    });
  }

  function toggleList(show) {
    var open = show === undefined ? listEl.hidden : show;
    listEl.hidden = !open;
    root.querySelector('[data-act="list"]').setAttribute('aria-expanded', String(open));
  }

  function atBottom() {
    return main.scrollTop + main.clientHeight >= main.scrollHeight - 4;
  }

  function pageDown() {
    if (atBottom()) go(state.index + 1);
    else main.scrollTop += main.clientHeight * 0.75;
  }
  function pageUp() {
    if (main.scrollTop <= 2) go(state.index - 1);
    else main.scrollTop -= main.clientHeight * 0.75;
  }

  // Desplazamiento automático.
  var last = null;
  function frame(ts) {
    if (state.scrolling) {
      if (last !== null) {
        scrollAcc += ((ts - last) / 1000) * state.speed * 9;
        if (scrollAcc >= 1) {
          var px = Math.floor(scrollAcc);
          main.scrollTop += px;
          scrollAcc -= px;
        }
        if (atBottom()) setScrolling(false);
      }
      last = ts;
    } else {
      last = null;
    }
    requestAnimationFrame(frame);
  }
  function setScrolling(on) {
    state.scrolling = on;
    scrollBtn.setAttribute('aria-pressed', String(on));
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'prev') go(state.index - 1);
    if (act === 'next') go(state.index + 1);
    if (act === 'list') toggleList();
    if (act === 'tUp' || act === 'tDown') {
      var v = state.transpose[state.index] + (act === 'tUp' ? 1 : -1);
      if (v > 11) v -= 12;
      if (v < -11) v += 12;
      state.transpose[state.index] = v;
      var top = main.scrollTop;
      render();
      main.scrollTop = top;
    }
    if (act === 'fUp' || act === 'fDown') {
      state.size = Math.max(16, Math.min(72, state.size + (act === 'fUp' ? 3 : -3)));
      store('size', state.size);
      applyPrefs();
    }
    if (act === 'scroll') setScrolling(!state.scrolling);
    if (act === 'chords') { state.chords = !state.chords; store('chords', state.chords); applyPrefs(); }
    if (act === 'theme') { state.light = !state.light; store('light', state.light); applyPrefs(); }
    if (act === 'offline') saveOffline();
    if (act === 'more') {
      var open = !root.classList.contains('show-more');
      root.classList.toggle('show-more', open);
      b.setAttribute('aria-expanded', String(open));
    }
  });
  speedInput.addEventListener('input', function () { state.speed = Number(speedInput.value); store('speed', state.speed); });

  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest('button, a')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(state.index + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(state.index - 1); }
    else if (e.key === 'PageDown' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); pageDown(); }
    else if (e.key === 'PageUp' || e.key === 'ArrowUp') { e.preventDefault(); pageUp(); }
    else if (e.key === 's' || e.key === 'S') { setScrolling(!state.scrolling); }
    else if (e.key === 'Escape') { toggleList(false); }
  });

  var swipe = null;
  main.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') swipe = { x: e.clientX, y: e.clientY }; });
  main.addEventListener('pointerup', function (e) {
    if (!swipe) return;
    var dx = e.clientX - swipe.x;
    var dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) go(state.index + (dx < 0 ? 1 : -1));
  });

  // ---------- Sin conexión ----------
  var ASSETS = ['/styles.css', '/app.js', '/chordpro.js', '/stage.js', '/favicon.svg'];
  async function saveOffline() {
    if (!('caches' in window)) {
      window.Ensaya.toast('Este navegador no permite guardar páginas sin conexión.');
      return;
    }
    try {
      var cache = await caches.open('ensaya-pages');
      var res = await fetch(location.href, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await cache.put(location.pathname, res);
      var assets = await caches.open('ensaya-static');
      await assets.addAll(ASSETS).catch(function () {});
      offlineBtn.textContent = 'Disponible sin conexión';
      window.Ensaya.toast('Guardado. Podrás abrir este modo escenario aunque no haya cobertura.');
    } catch (e) {
      window.Ensaya.toast('No se pudo guardar: ' + e.message);
    }
  }
  if ('caches' in window) {
    caches.open('ensaya-pages').then(function (c) { return c.match(location.pathname); }).then(function (m) {
      if (m) offlineBtn.textContent = 'Actualizar copia sin conexión';
    }).catch(function () {});
  } else {
    offlineBtn.hidden = true;
  }

  async function keepAwake() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') keepAwake(); });

  applyPrefs();
  render();
  renderList();
  requestAnimationFrame(frame);
  keepAwake();
  main.focus({ preventScroll: true });
})();
