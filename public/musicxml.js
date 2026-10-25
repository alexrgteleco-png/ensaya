/* Visor de MusicXML con OpenSheetMusicDisplay: transposición, zoom y partes. */
(function () {
  'use strict';
  var root = document.querySelector('[data-musicxml]');
  if (!root) return;
  var statusEl = root.querySelector('[data-status]');
  var scoreEl = root.querySelector('[data-score]');
  var transposeOut = root.querySelector('[data-transpose]');
  var zoomOut = root.querySelector('[data-zoom]');
  var partsEl = root.querySelector('[data-parts]');
  var OSMD = window.opensheetmusicdisplay;
  var osmd = null;
  var transpose = 0;
  var zoom = 1;

  function bytesToBinary(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return out;
  }

  function rerender(withUpdate) {
    statusEl.textContent = 'Dibujando…';
    setTimeout(function () {
      try {
        if (withUpdate) osmd.updateGraphic();
        osmd.render();
        statusEl.textContent = '';
      } catch (e) {
        statusEl.textContent = 'No se pudo dibujar: ' + e.message;
      }
    }, 10);
  }

  function buildParts() {
    var instruments = osmd.Sheet.Instruments || [];
    if (instruments.length < 2) return;
    var label = document.createElement('span');
    label.textContent = 'Partes:';
    partsEl.appendChild(label);
    instruments.forEach(function (ins, i) {
      var l = document.createElement('label');
      l.className = 'check';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.addEventListener('change', function () {
        if (!instruments.some(function (x, j) { return j === i ? cb.checked : x.Visible; })) {
          cb.checked = true;
          window.Ensaya.toast('Deja al menos una parte visible.');
          return;
        }
        ins.Visible = cb.checked;
        rerender(true);
      });
      l.appendChild(cb);
      l.appendChild(document.createTextNode(' ' + (ins.Name || 'Parte ' + (i + 1))));
      partsEl.appendChild(l);
    });
  }

  root.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn || !osmd) return;
    var act = btn.dataset.act;
    if (act === 'up' || act === 'down') {
      transpose += act === 'up' ? 1 : -1;
      if (transpose > 12) transpose = 12;
      if (transpose < -12) transpose = -12;
      osmd.Sheet.Transpose = transpose;
      transposeOut.textContent = (transpose > 0 ? '+' : '') + transpose;
      rerender(true);
    }
    if (act === 'zoomIn' || act === 'zoomOut') {
      zoom = Math.max(0.4, Math.min(2.5, zoom * (act === 'zoomIn' ? 1.15 : 1 / 1.15)));
      osmd.Zoom = zoom;
      zoomOut.textContent = Math.round(zoom * 100) + ' %';
      rerender(false);
    }
    if (act === 'print') window.print();
  });

  (async function init() {
    if (!OSMD) {
      statusEl.textContent = 'No se pudo cargar el visor de partituras.';
      return;
    }
    try {
      var res = await fetch(root.dataset.src, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var bytes = new Uint8Array(await res.arrayBuffer());
      var isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      var content = isZip ? bytesToBinary(bytes) : new TextDecoder('utf-8').decode(bytes);
      osmd = new OSMD.OpenSheetMusicDisplay(scoreEl, { autoResize: true, backend: 'svg', drawTitle: true, drawingParameters: 'default' });
      await osmd.load(content);
      if (OSMD.TransposeCalculator) osmd.TransposeCalculator = new OSMD.TransposeCalculator();
      else root.querySelectorAll('[data-act="up"],[data-act="down"]').forEach(function (b) { b.disabled = true; });
      osmd.render();
      statusEl.textContent = '';
      buildParts();
    } catch (e) {
      statusEl.textContent = 'No se pudo abrir la partitura: ' + (e && e.message ? e.message : e) + '. Comprueba que es un MusicXML válido.';
    }
  })();
})();
