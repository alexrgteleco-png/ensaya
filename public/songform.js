/* Formulario de canción: vista previa del cifrado, importación de iReal Pro y relleno automático de datos. */
(function () {
  'use strict';
  var form = document.querySelector('[data-song-form]');
  if (!form || !window.ChordPro) return;
  var CP = window.ChordPro;
  var area = form.querySelector('[data-chart]');
  var preview = form.querySelector('[data-chart-preview]');
  var status = form.querySelector('[data-chart-status]');
  var count = form.querySelector('[data-chart-count]');
  var keyInput = form.querySelector('[name="song_key"]');
  var defaultHint = status ? status.textContent : '';
  var timer = 0;

  function field(name) {
    return form.querySelector('[data-meta="' + name + '"]');
  }

  // Rellena los campos vacíos con los datos del cifrado ({title}, {key}, {tempo}…).
  function fillMeta(meta, overwrite) {
    var filled = [];
    ['title', 'artist', 'key', 'tempo', 'time'].forEach(function (k) {
      var input = field(k);
      var v = meta[k];
      if (!input || !v) return;
      if (k === 'tempo' && !/^\d{2,3}$/.test(v)) return;
      if (input.value.trim() && !overwrite) return;
      if (input.value.trim() === String(v)) return;
      input.value = String(v).slice(0, Number(input.maxLength) > 0 ? input.maxLength : 150);
      filled.push(input);
    });
    filled.forEach(function (input) {
      input.classList.add('just-filled');
      setTimeout(function () { input.classList.remove('just-filled'); }, 1600);
    });
    return filled.length;
  }

  function draw() {
    var text = area.value;
    if (!text.trim()) {
      preview.innerHTML = '<p class="muted">Aquí verás el cifrado tal como lo leerá el grupo.</p>';
      if (count) count.textContent = '';
      return;
    }
    preview.innerHTML = CP.render(text, 0, { key: keyInput ? keyInput.value : '' });
    var n = CP.parse(text).some(function (b) { return b.type === 'bars'; }) ? CP.bars(text).length : 0;
    if (count) count.textContent = n ? '· ' + n + ' compases' : '';
  }

  function say(msg, ok) {
    if (!status) return;
    status.textContent = msg || defaultHint;
    status.classList.toggle('hint-ok', Boolean(ok));
  }

  // Convierte lo pegado (enlace de iReal Pro, texto de la IA con ``` o acordes sin corchetes).
  function convert(quiet) {
    var text = area.value;
    if (!text.trim()) return;
    var songs = CP.fromIReal(text);
    if (songs.length) {
      var song = songs[0];
      area.value = song.chart;
      fillMeta(CP.meta(song.chart), false);
      draw();
      say('Importado de iReal Pro: «' + song.title + '» (' + song.bars.length + ' compases)' + (songs.length > 1 ? '. El enlace traía ' + songs.length + ' canciones; se ha usado la primera.' : '.'), true);
      draw();
      return;
    }
    var normalized = CP.normalizeChart(text);
    if (normalized === text && quiet) return;
    if (normalized !== text) area.value = normalized;
    var filled = fillMeta(CP.meta(normalized), false);
    var hasBarLines = CP.parse(normalized).some(function (b) { return b.type === 'bars'; });
    var bars = hasBarLines ? CP.bars(normalized).length : 0;
    if (quiet) { draw(); return; }
    if (bars) say('Cifrado reconocido: ' + bars + ' compases' + (filled ? '; datos de la canción completados.' : '.'), true);
    else say('');
    draw();
  }

  area.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(draw, 150);
  });
  area.addEventListener('paste', function () {
    setTimeout(convert, 0);
  });
  // Al salir del cuadro solo se arregla el formato (sin mensajes que muevan la página bajo el ratón).
  area.addEventListener('blur', function () { convert(true); });
  if (keyInput) keyInput.addEventListener('change', draw);

  var pasteBtn = form.querySelector('[data-paste]');
  if (pasteBtn) {
    if (!navigator.clipboard || !navigator.clipboard.readText) pasteBtn.hidden = true;
    pasteBtn.addEventListener('click', function () {
      navigator.clipboard.readText().then(function (text) {
        if (!text) return say('El portapapeles está vacío.');
        area.value = text;
        convert();
        area.focus();
      }).catch(function () {
        say('El navegador no deja leer el portapapeles: pega con Ctrl+V (o mantén pulsado y «Pegar»).');
        area.focus();
      });
    });
  }

  form.addEventListener('submit', function (e) {
    convert(true);
    var title = form.querySelector('[name="title"]');
    if (title && !title.value.trim()) {
      e.preventDefault();
      say('Ponle título a la canción.');
      title.focus();
    }
  });
  draw();
})();
