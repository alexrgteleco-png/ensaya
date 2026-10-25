'use strict';

const { html } = require('../lib/html');
const { layout, pageHead } = require('../lib/ui');
const { loadGroup } = require('./common');

module.exports = function toolRoutes(app) {
  app.get('/g/:gid/herramientas', loadGroup, (req, res) => {
    const body = html`
      ${pageHead('Afinador y metrónomo', { lead: 'Para calentar antes del ensayo. Funcionan sin conexión.' })}
      <div class="tools">
        <section class="panel tool" data-metronome>
          <h2>Metrónomo</h2>
          <div class="metro-display">
            <output class="metro-bpm" data-bpm-out>100</output><span class="muted">bpm</span>
          </div>
          <div class="metro-beats" data-beats aria-hidden="true"></div>
          <input type="range" min="30" max="260" value="100" data-bpm aria-label="Tempo en bpm">
          <div class="metro-row">
            <button type="button" class="button button-ghost button-small" data-step="-5">−5</button>
            <button type="button" class="button button-ghost button-small" data-step="-1">−1</button>
            <button type="button" class="button button-play" data-toggle aria-label="Iniciar metrónomo">Iniciar</button>
            <button type="button" class="button button-ghost button-small" data-step="1">+1</button>
            <button type="button" class="button button-ghost button-small" data-step="5">+5</button>
          </div>
          <div class="metro-row">
            <label>Compás
              <select data-meter><option value="1">Sin acento</option><option value="2">2/4</option><option value="3">3/4</option><option value="4" selected>4/4</option><option value="5">5/4</option><option value="6">6/8</option><option value="7">7/8</option></select>
            </label>
            <label>Subdivisión
              <select data-sub><option value="1">Negras</option><option value="2">Corcheas</option><option value="3">Tresillos</option><option value="4">Semicorcheas</option></select>
            </label>
            <button type="button" class="button button-ghost" data-tap>Marcar tempo</button>
          </div>
          <p class="muted small">Espacio inicia o para. Pulsa «Marcar tempo» al ritmo para medirlo.</p>
        </section>
        <section class="panel tool" data-tuner>
          <h2>Afinador</h2>
          <div class="tuner-display">
            <output class="tuner-note" data-note>–</output>
            <output class="tuner-freq muted" data-freq>Pulsa «Escuchar»</output>
            <div class="tuner-meter" aria-hidden="true"><span class="tuner-needle" data-needle></span><span class="tuner-center"></span></div>
            <output class="tuner-cents" data-cents></output>
          </div>
          <div class="metro-row">
            <button type="button" class="button button-play" data-listen>Escuchar</button>
            <label>La =
              <input type="number" min="415" max="466" value="440" data-a4 aria-label="Frecuencia de referencia del La"> Hz
            </label>
            <label class="check"><input type="checkbox" data-latin checked> Do Re Mi</label>
          </div>
          <div class="metro-row">
            <span class="muted">Nota de referencia:</span>
            <select data-ref>
              <option value="">Elige…</option>
              <option value="40">Mi grave (E2)</option><option value="45">La (A2)</option><option value="50">Re (D3)</option>
              <option value="55">Sol (G3)</option><option value="59">Si (B3)</option><option value="64">Mi agudo (E4)</option>
              <option value="69">La 440 (A4)</option><option value="60">Do central (C4)</option>
            </select>
            <button type="button" class="button button-ghost button-small" data-ref-play>Sonar</button>
          </div>
          <p class="muted small">El navegador te pedirá permiso para usar el micrófono. Nada se graba ni sale de tu dispositivo.</p>
        </section>
      </div>`;
    res.html(layout(res.ctx, { title: 'Afinador y metrónomo', active: 'herramientas', scripts: ['/tools.js'], body }));
  });
};
