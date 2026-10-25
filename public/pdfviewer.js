/* Atril de partituras PDF: pasa página con teclado, pedal Bluetooth o toques;
 * anotaciones a mano alzada en dos capas (mías y del grupo). */
import * as pdfjsLib from '/vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';

const root = document.querySelector('[data-atril]');
const E = window.Ensaya;
const stage = root.querySelector('[data-stage]');
const pageOut = root.querySelector('[data-page]');
const annotBar = root.querySelector('[data-annot-bar]');
const saveStatus = root.querySelector('[data-save-status]');
const annUrl = root.dataset.annotations;

const state = {
  pdf: null,
  page: 1,
  twoUp: false,
  zoom: 'fit',
  drawing: false,
  layer: 'personal',
  tool: 'pen',
  color: '#c2364a',
  show: { personal: true, group: true },
  ann: { personal: {}, group: {} },
  renderToken: 0,
  pages: [],
};

const saveTimers = {};
let wakeLock = null;

function strokesFor(scope, page) {
  if (!state.ann[scope][page]) state.ann[scope][page] = [];
  return state.ann[scope][page];
}

function step() {
  return state.twoUp ? 2 : 1;
}

function go(page) {
  if (!state.pdf) return;
  const max = state.pdf.numPages;
  const p = Math.max(1, Math.min(max, page));
  if (p === state.page) return;
  state.page = p;
  render();
}

// ---------- Pintado de páginas ----------
async function render() {
  const pdf = state.pdf;
  if (!pdf) return;
  const token = ++state.renderToken;
  const nums = [state.page];
  if (state.twoUp && state.page + 1 <= pdf.numPages) nums.push(state.page + 1);
  pageOut.textContent = `${nums.join('–')} / ${pdf.numPages}`;
  const pages = await Promise.all(nums.map((n) => pdf.getPage(n)));
  if (token !== state.renderToken) return;
  const style = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - (pages.length - 1) * 12;
  const availH = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const base = pages.map((p) => p.getViewport({ scale: 1 }));
  const totalW = base.reduce((s, v) => s + v.width, 0);
  const maxH = Math.max(...base.map((v) => v.height));
  let scale;
  if (state.zoom === 'fit') scale = Math.max(0.2, Math.min(availW / totalW, availH / maxH));
  else scale = state.zoom;
  const dpr = window.devicePixelRatio || 1;

  const frag = document.createDocumentFragment();
  const created = [];
  for (let i = 0; i < pages.length; i++) {
    const vp = pages[i].getViewport({ scale });
    const wrap = document.createElement('div');
    wrap.className = 'atril-page';
    wrap.style.width = `${Math.floor(vp.width)}px`;
    wrap.style.height = `${Math.floor(vp.height)}px`;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${Math.floor(vp.width)}px`;
    canvas.style.height = `${Math.floor(vp.height)}px`;
    const annot = document.createElement('canvas');
    annot.className = 'annot';
    annot.width = canvas.width;
    annot.height = canvas.height;
    annot.dataset.page = String(nums[i]);
    wrap.appendChild(canvas);
    wrap.appendChild(annot);
    frag.appendChild(wrap);
    created.push({ page: pages[i], vp, canvas, annot, num: nums[i] });
  }
  stage.innerHTML = '';
  const left = document.createElement('div');
  left.className = 'tap-zone left';
  const right = document.createElement('div');
  right.className = 'tap-zone right';
  stage.appendChild(frag);
  if (window.matchMedia('(pointer: coarse)').matches) {
    stage.appendChild(left);
    stage.appendChild(right);
    left.addEventListener('click', () => go(state.page - step()));
    right.addEventListener('click', () => go(state.page + step()));
  }
  state.pages = created;
  await Promise.all(
    created.map((c) =>
      c.page.render({ canvasContext: c.canvas.getContext('2d'), viewport: c.vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise.catch(() => {})
    )
  );
  if (token !== state.renderToken) return;
  created.forEach((c) => {
    drawAnnotations(c);
    bindDrawing(c);
  });
  // Precarga la siguiente página para que el cambio sea instantáneo.
  const next = state.page + step();
  if (next <= pdf.numPages) pdf.getPage(next).catch(() => {});
}

function drawStroke(ctx, s, w, h) {
  if (s.tool === 'text') {
    if (!s.points.length || !s.text) return;
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.color;
    ctx.font = `700 ${Math.round(s.width * w * 0.0035 + 14 * (w / 900))}px "Atkinson Hyperlegible", sans-serif`;
    ctx.fillText(s.text, s.points[0][0] * w, s.points[0][1] * h);
    return;
  }
  if (s.points.length < 1) return;
  ctx.globalAlpha = s.tool === 'marker' ? 0.33 : 1;
  ctx.strokeStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.width * (w / 1000);
  ctx.beginPath();
  ctx.moveTo(s.points[0][0] * w, s.points[0][1] * h);
  if (s.points.length === 1) ctx.lineTo(s.points[0][0] * w + 0.1, s.points[0][1] * h);
  for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0] * w, s.points[i][1] * h);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawAnnotations(c) {
  const ctx = c.annot.getContext('2d');
  const w = c.annot.width;
  const h = c.annot.height;
  ctx.clearRect(0, 0, w, h);
  ['group', 'personal'].forEach((scope) => {
    if (!state.show[scope]) return;
    (state.ann[scope][c.num] || []).forEach((s) => drawStroke(ctx, s, w, h));
  });
}

function scheduleSave(page) {
  const scope = state.layer;
  const key = `${scope}:${page}`;
  clearTimeout(saveTimers[key]);
  saveStatus.textContent = 'Guardando…';
  saveTimers[key] = setTimeout(async () => {
    try {
      await E.api('PUT', annUrl, { page, scope, strokes: strokesFor(scope, page) });
      saveStatus.textContent = scope === 'group' ? 'Guardado para todo el grupo' : 'Guardado (solo tú lo ves)';
    } catch (e) {
      saveStatus.textContent = `No se pudo guardar: ${e.message}`;
    }
  }, 700);
}

function bindDrawing(c) {
  let current = null;
  const pos = (ev) => {
    const r = c.annot.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))];
  };
  c.annot.addEventListener('pointerdown', (ev) => {
    if (!state.drawing) return;
    ev.preventDefault();
    const p = pos(ev);
    const list = strokesFor(state.layer, c.num);
    if (state.tool === 'text') {
      const text = window.prompt('Texto de la anotación:');
      if (text && text.trim()) {
        list.push({ tool: 'text', color: state.color, width: 4, points: [p], text: text.trim().slice(0, 200) });
        drawAnnotations(c);
        scheduleSave(c.num);
      }
      return;
    }
    c.annot.setPointerCapture(ev.pointerId);
    if (state.tool === 'eraser') {
      current = { erase: true };
      eraseAt(c, p);
      return;
    }
    current = { tool: state.tool, color: state.color, width: state.tool === 'marker' ? 14 : 2.4, points: [p] };
    list.push(current);
    drawAnnotations(c);
  });
  c.annot.addEventListener('pointermove', (ev) => {
    if (!current || !state.drawing) return;
    const p = pos(ev);
    if (current.erase) {
      eraseAt(c, p);
      return;
    }
    const last = current.points[current.points.length - 1];
    if (Math.abs(last[0] - p[0]) + Math.abs(last[1] - p[1]) > 0.0015) {
      current.points.push(p);
      drawAnnotations(c);
    }
  });
  const end = () => {
    if (!current) return;
    current = null;
    scheduleSave(c.num);
  };
  c.annot.addEventListener('pointerup', end);
  c.annot.addEventListener('pointercancel', end);
}

function eraseAt(c, p) {
  const list = strokesFor(state.layer, c.num);
  const before = list.length;
  const kept = list.filter((s) => !s.points.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.02));
  if (kept.length !== before) {
    state.ann[state.layer][c.num] = kept;
    drawAnnotations(c);
  }
}

function redrawAll() {
  state.pages.forEach(drawAnnotations);
}

// ---------- Controles ----------
function setPressed(selector, value, attr) {
  root.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
}

root.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  if (!btn || !root.contains(btn)) return;
  const act = btn.dataset.act;
  if (act === 'prev') go(state.page - step());
  if (act === 'next') go(state.page + step());
  if (act === 'zoomIn' || act === 'zoomOut') {
    const current = state.zoom === 'fit' && state.pages[0] ? state.pages[0].vp.scale : state.zoom === 'fit' ? 1 : state.zoom;
    state.zoom = Math.max(0.3, Math.min(5, current * (act === 'zoomIn' ? 1.2 : 1 / 1.2)));
    render();
  }
  if (act === 'fit') {
    state.zoom = 'fit';
    render();
  }
  if (act === 'twoUp') {
    state.twoUp = !state.twoUp;
    btn.setAttribute('aria-pressed', String(state.twoUp));
    render();
  }
  if (act === 'draw') {
    state.drawing = !state.drawing;
    btn.setAttribute('aria-pressed', String(state.drawing));
    annotBar.hidden = !state.drawing;
    stage.classList.toggle('is-drawing', state.drawing);
    render();
  }
  if (act === 'undo') {
    let changed = false;
    for (const c of state.pages) {
      const list = strokesFor(state.layer, c.num);
      if (list.length) {
        list.pop();
        drawAnnotations(c);
        scheduleSave(c.num);
        changed = true;
        break;
      }
    }
    if (!changed) E.toast('No hay nada que deshacer en esta capa.');
  }
  if (act === 'clearPage') {
    if (!window.confirm(state.layer === 'group' ? '¿Borrar las notas del grupo en esta página? Las verá todo el grupo.' : '¿Borrar tus notas en esta página?')) return;
    state.pages.forEach((c) => {
      state.ann[state.layer][c.num] = [];
      drawAnnotations(c);
      scheduleSave(c.num);
    });
  }
  if (act === 'full') toggleFull();
  if (btn.dataset.layer) {
    state.layer = btn.dataset.layer;
    setPressed('[data-layer]', state.layer, 'layer');
  }
  if (btn.dataset.tool) {
    state.tool = btn.dataset.tool;
    setPressed('[data-tool]', state.tool, 'tool');
  }
  if (btn.dataset.color) {
    state.color = btn.dataset.color;
    setPressed('[data-color]', state.color, 'color');
  }
});

root.querySelectorAll('[data-show]').forEach((cb) => {
  cb.addEventListener('change', () => {
    state.show[cb.dataset.show] = cb.checked;
    redrawAll();
  });
});

async function toggleFull() {
  const isFull = document.fullscreenElement === root || root.classList.contains('is-full');
  if (isFull) {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    root.classList.remove('is-full');
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  } else {
    if (root.requestFullscreen) {
      await root.requestFullscreen().catch(() => root.classList.add('is-full'));
    } else {
      root.classList.add('is-full');
    }
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen').catch(() => null);
  }
  stage.focus();
  setTimeout(render, 120);
}
document.addEventListener('fullscreenchange', () => setTimeout(render, 120));

// Teclado y pedales Bluetooth (suelen enviar flechas, AvPág/RePág o espacio).
document.addEventListener('keydown', (ev) => {
  if (ev.target.closest('input, textarea, select') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if ((ev.key === ' ' || ev.key === 'Enter') && ev.target.closest('button, a')) return;
  const nextKeys = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
  const prevKeys = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
  if (nextKeys.includes(ev.key)) {
    ev.preventDefault();
    go(state.page + step());
  } else if (prevKeys.includes(ev.key)) {
    ev.preventDefault();
    go(state.page - step());
  } else if (ev.key === 'f' || ev.key === 'F') {
    toggleFull();
  } else if (ev.key === 'Escape' && root.classList.contains('is-full')) {
    toggleFull();
  }
});

// Deslizar con el dedo para pasar página.
let swipe = null;
stage.addEventListener('pointerdown', (ev) => {
  if (state.drawing || ev.pointerType === 'mouse') return;
  swipe = { x: ev.clientX, y: ev.clientY };
});
stage.addEventListener('pointerup', (ev) => {
  if (!swipe) return;
  const dx = ev.clientX - swipe.x;
  const dy = ev.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(state.page + (dx < 0 ? step() : -step()));
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});

(async function init() {
  stage.textContent = 'Cargando partitura…';
  try {
    state.pdf = await pdfjsLib.getDocument({ url: root.dataset.src, withCredentials: false }).promise;
  } catch (e) {
    stage.textContent = 'No se pudo abrir el PDF. Descárgalo desde «Datos del archivo».';
    return;
  }
  try {
    state.ann = await E.api('GET', annUrl);
  } catch (e) {
    state.ann = { personal: {}, group: {} };
  }
  if (window.innerWidth > 1100 && window.innerWidth > window.innerHeight * 1.2 && state.pdf.numPages > 1) {
    state.twoUp = true;
    root.querySelector('[data-act="twoUp"]').setAttribute('aria-pressed', 'true');
  }
  await render();
  stage.focus({ preventScroll: true });
})();
