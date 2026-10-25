/* Transposición de la letra con acordes en la ficha de la canción. */
(function () {
  'use strict';
  document.querySelectorAll('[data-chordpro]').forEach(function (panel) {
    var source = panel.querySelector('[data-source]');
    var target = panel.querySelector('[data-render]');
    var label = panel.querySelector('[data-transpose-label]');
    var key = panel.dataset.key || '';
    var semis = 0;
    function draw() {
      target.innerHTML = window.ChordPro.render(source.value, semis, { key: key });
      if (label) {
        var sign = semis > 0 ? '+' + semis : String(semis);
        if (key) label.textContent = 'Tono ' + window.ChordPro.transposeKey(key, semis) + (semis ? ' (' + sign + ')' : '');
        else label.textContent = semis ? sign + ' semitonos' : 'Original';
      }
    }
    panel.querySelectorAll('[data-transpose]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        semis += Number(btn.dataset.transpose);
        if (semis > 11) semis -= 12;
        if (semis < -11) semis += 12;
        draw();
      });
    });
  });
})();
