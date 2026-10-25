/* Editor de setlists: añadir canciones, descansos y textos; ordenar arrastrando o con flechas;
 * tono y nota por canción; duración total; guardado automático. */
(function () {
  'use strict';
  var root = document.querySelector('[data-setlist-editor]');
  if (!root) return;
  var E = window.Ensaya;
  var data = JSON.parse(document.getElementById('setlist-data').textContent);
  var items = data.items;
  var songs = {};
  data.songs.forEach(function (s) { songs[s.id] = s; });
  var list = root.querySelector('[data-items]');
  var pick = root.querySelector('[data-pick]');
  var filter = root.querySelector('[data-song-filter]');
  var status = document.querySelector('[data-save-status]');
  var totalsEl = document.querySelector('[data-totals]');
  var saveTimer = null;
  var dragIndex = null;

  function fmtDur(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h) return h + ' h ' + (m < 10 ? '0' : '') + m + ' min';
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function keyFor(item) {
    var s = songs[item.song_id];
    if (!s || !s.key) return '';
    return item.transpose ? window.ChordPro ? window.ChordPro.transposeKey(s.key, item.transpose) : s.key + ' (' + (item.transpose > 0 ? '+' : '') + item.transpose + ')' : s.key;
  }

  function totals() {
    var total = 0;
    var unknown = 0;
    var count = 0;
    items.forEach(function (i) {
      if (i.song_id) {
        count++;
        var s = songs[i.song_id];
        if (s && s.duration) total += s.duration;
        else unknown++;
      } else if (i.break_min) {
        total += i.break_min * 60;
      }
    });
    totalsEl.textContent = count + (count === 1 ? ' canción' : ' canciones') + ' · ' + fmtDur(total) + (unknown ? ' (+' + unknown + ' sin duración)' : '');
  }

  function save() {
    status.textContent = 'Guardando…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async function () {
      try {
        await E.api('PUT', data.save, { items: items });
        status.textContent = 'Guardado';
      } catch (e) {
        status.textContent = 'No se pudo guardar: ' + e.message;
      }
    }, 500);
  }

  function changed() {
    render();
    save();
  }

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function move(from, to) {
    if (to < 0 || to >= items.length || from === to) return;
    var it = items.splice(from, 1)[0];
    items.splice(to, 0, it);
    changed();
  }

  function render() {
    list.innerHTML = '';
    var n = 0;
    if (!items.length) {
      var empty = el('li', { class: 'muted' }, 'Añade canciones desde el repertorio.');
      empty.style.padding = '16px';
      list.appendChild(empty);
    }
    items.forEach(function (item, index) {
      var li = el('li', { class: 'set-item', draggable: 'true' });
      li.dataset.index = String(index);
      var handle = el('span', { class: 'set-handle', title: 'Arrastra para mover', 'aria-hidden': 'true' }, '⠿');
      var num = el('span', { class: 'set-num' });
      var main = el('div', { class: 'set-main' });
      var controls = el('div', { class: 'set-controls' });
      if (item.song_id) {
        n++;
        num.textContent = String(n);
        var s = songs[item.song_id] || { title: 'Canción borrada' };
        main.appendChild(el('span', { class: 'set-title' }, s.title));
        var meta = [keyFor(item), s.bpm ? s.bpm + ' bpm' : '', s.duration ? fmtDur(s.duration) : ''].filter(Boolean).join(' · ');
        main.appendChild(el('span', { class: 'set-meta' }, meta || 'Sin datos de tono ni duración'));
        var t = el('select', { 'aria-label': 'Tono para ' + s.title, title: 'Transponer en el escenario' });
        for (var v = -6; v <= 6; v++) {
          var o = el('option', { value: String(v) }, v === 0 ? 'Tono original' : (v > 0 ? '+' : '') + v + ' st');
          if (v === (item.transpose || 0)) o.selected = true;
          t.appendChild(o);
        }
        t.addEventListener('change', function () { item.transpose = Number(t.value); changed(); });
        controls.appendChild(t);
      } else if (item.break_min) {
        li.classList.add('is-break');
        main.appendChild(el('span', { class: 'set-title' }, 'Descanso'));
        var mins = el('input', { type: 'number', min: '1', max: '180', value: String(item.break_min), 'aria-label': 'Minutos de descanso' });
        mins.style.width = '70px';
        mins.addEventListener('change', function () { item.break_min = Math.max(1, Math.min(180, Number(mins.value) || 1)); changed(); });
        controls.appendChild(mins);
        controls.appendChild(el('span', { class: 'muted small' }, 'min'));
      } else {
        li.classList.add('is-text');
        main.appendChild(el('span', { class: 'set-title' }, item.title));
        main.appendChild(el('span', { class: 'set-meta' }, 'Texto'));
      }
      var note = el('input', { class: 'set-note', maxlength: '200', placeholder: 'Nota', value: item.note || '', 'aria-label': 'Nota' });
      note.addEventListener('change', function () { item.note = note.value; save(); });
      controls.appendChild(note);
      var up = el('button', { type: 'button', 'aria-label': 'Subir' }, '↑');
      up.disabled = index === 0;
      up.addEventListener('click', function () { move(index, index - 1); });
      var down = el('button', { type: 'button', 'aria-label': 'Bajar' }, '↓');
      down.disabled = index === items.length - 1;
      down.addEventListener('click', function () { move(index, index + 1); });
      var del = el('button', { type: 'button', class: 'set-remove', 'aria-label': 'Quitar del setlist' }, '×');
      del.addEventListener('click', function () { items.splice(index, 1); changed(); });
      controls.appendChild(up);
      controls.appendChild(down);
      controls.appendChild(del);
      li.appendChild(handle);
      li.appendChild(num);
      li.appendChild(main);
      li.appendChild(controls);

      li.addEventListener('dragstart', function (e) {
        if (e.target.closest('input, select')) { e.preventDefault(); return; }
        dragIndex = index;
        li.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
      });
      li.addEventListener('dragend', function () {
        dragIndex = null;
        li.classList.remove('is-dragging');
        list.querySelectorAll('.drop-before, .drop-after').forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); });
      });
      li.addEventListener('dragover', function (e) {
        if (dragIndex === null) return;
        e.preventDefault();
        var r = li.getBoundingClientRect();
        var after = e.clientY > r.top + r.height / 2;
        li.classList.toggle('drop-after', after);
        li.classList.toggle('drop-before', !after);
      });
      li.addEventListener('dragleave', function () { li.classList.remove('drop-before', 'drop-after'); });
      li.addEventListener('drop', function (e) {
        e.preventDefault();
        if (dragIndex === null) return;
        var r = li.getBoundingClientRect();
        var after = e.clientY > r.top + r.height / 2;
        var to = index + (after ? 1 : 0);
        if (dragIndex < to) to--;
        move(dragIndex, to);
      });
      list.appendChild(li);
    });
    renderPick();
    totals();
  }

  function renderPick() {
    var q = (filter.value || '').toLowerCase().trim();
    var inSet = {};
    items.forEach(function (i) { if (i.song_id) inSet[i.song_id] = true; });
    pick.innerHTML = '';
    data.songs
      .filter(function (s) { return !q || (s.title + ' ' + (s.artist || '')).toLowerCase().indexOf(q) >= 0; })
      .forEach(function (s) {
        var li = el('li');
        var b = el('button', { type: 'button', class: inSet[s.id] ? 'in-set' : '' });
        var info = el('span');
        info.appendChild(el('b', {}, s.title));
        var meta = [s.artist, s.key, s.duration ? fmtDur(s.duration) : ''].filter(Boolean).join(' · ');
        if (meta) info.appendChild(el('span', { class: 'muted small' }, ' ' + meta));
        b.appendChild(info);
        b.appendChild(el('span', { class: 'add' }, inSet[s.id] ? 'Ya está · añadir otra vez' : '+ Añadir'));
        b.addEventListener('click', function () {
          items.push({ song_id: s.id, title: '', note: '', transpose: 0, break_min: null });
          changed();
          E.toast('«' + s.title + '» añadida');
        });
        li.appendChild(b);
        pick.appendChild(li);
      });
  }

  filter.addEventListener('input', renderPick);
  root.querySelector('[data-add-break]').addEventListener('click', function () {
    items.push({ song_id: null, title: 'Descanso', note: '', transpose: 0, break_min: 15 });
    changed();
  });
  root.querySelector('[data-add-text]').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = e.target.querySelector('input');
    var v = input.value.trim();
    if (!v) return;
    items.push({ song_id: null, title: v, note: '', transpose: 0, break_min: null });
    input.value = '';
    changed();
  });

  render();
  status.textContent = 'Guardado';
})();
