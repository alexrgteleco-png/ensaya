/* Subida de audios y partituras con barra de progreso. */
(function () {
  'use strict';
  var MAX = 300 * 1024 * 1024;

  function uploadOne(form, file, label) {
    return new Promise(function (resolve) {
      var list = form.querySelector('.upload-progress');
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.textContent = file.name;
      var bar = document.createElement('progress');
      bar.max = 100;
      bar.value = 0;
      li.appendChild(name);
      li.appendChild(bar);
      list.appendChild(li);
      var fail = function (msg) {
        bar.remove();
        var err = document.createElement('span');
        err.className = 'err';
        err.textContent = msg;
        li.appendChild(err);
        resolve(false);
      };
      if (file.size > MAX) return fail('Pasa de 300 MB. Comprímelo (por ejemplo, a MP3) y vuelve a probar.');
      if (!file.size) return fail('El archivo está vacío.');
      var params = new URLSearchParams({ name: file.name });
      if (label) params.set('label', label);
      if (form.dataset.song) params.set('song', form.dataset.song);
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', form.dataset.upload + '?' + params.toString());
      xhr.setRequestHeader('X-CSRF-Token', window.Ensaya.csrf);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) bar.value = Math.round((e.loaded / e.total) * 100);
      };
      xhr.onload = function () {
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
        if (xhr.status >= 200 && xhr.status < 300) {
          bar.value = 100;
          name.textContent = file.name + ' · subido';
          resolve(true);
        } else {
          fail((data && data.error) || 'No se pudo subir (error ' + xhr.status + ').');
        }
      };
      xhr.onerror = function () { fail('Se cortó la conexión. Vuelve a intentarlo.'); };
      xhr.send(file);
    });
  }

  async function handle(form, files) {
    if (!files || !files.length) return;
    var labelInput = form.querySelector('input[name="label"]');
    var label = labelInput ? labelInput.value.trim() : '';
    var ok = 0;
    for (var i = 0; i < files.length; i++) {
      // Con varios archivos, el nombre común se numera.
      var l = label && files.length > 1 ? label + ' ' + (i + 1) : label;
      if (await uploadOne(form, files[i], l)) ok++;
    }
    if (ok === files.length) {
      window.Ensaya.toast(ok === 1 ? 'Archivo subido' : ok + ' archivos subidos');
      setTimeout(function () { location.reload(); }, 600);
    } else if (ok) {
      setTimeout(function () { location.reload(); }, 2500);
    }
  }

  document.querySelectorAll('form.uploader').forEach(function (form) {
    var input = form.querySelector('input[type="file"]');
    var zone = form.querySelector('.dropzone');
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    input.addEventListener('change', function () {
      handle(form, Array.prototype.slice.call(input.files));
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      zone.addEventListener(t, function () { zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      handle(form, Array.prototype.slice.call(e.dataTransfer.files));
    });
  });
})();
