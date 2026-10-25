/* Cambio de tono sin cambiar la velocidad: desplazador granular de dos cabezas
 * de lectura con fundido (técnica clásica de "delay line" con ventana de Hann). */
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.window = Math.round(sampleRate * 0.075);
    this.size = this.window * 2 + 4;
    this.buffers = [];
    this.write = 0;
    this.phase = 0;
  }

  read(buf, pos) {
    const size = this.size;
    let p = pos;
    while (p < 0) p += size;
    const i = Math.floor(p);
    const frac = p - i;
    const a = buf[i % size];
    const b = buf[(i + 1) % size];
    return a + (b - a) * frac;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;
    const ratio = parameters.ratio[0];
    const channels = output.length;
    while (this.buffers.length < channels) this.buffers.push(new Float32Array(this.size));
    const frames = output[0].length;
    const step = (1 - ratio) / this.window;
    let write = this.write;
    let phase = this.phase;
    for (let n = 0; n < frames; n++) {
      const p1 = phase;
      const p2 = (phase + 0.5) % 1;
      const g1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * p1);
      const g2 = 0.5 - 0.5 * Math.cos(2 * Math.PI * p2);
      const d1 = p1 * this.window;
      const d2 = p2 * this.window;
      for (let c = 0; c < channels; c++) {
        const inCh = input[c] || input[0];
        const buf = this.buffers[c];
        buf[write] = inCh ? inCh[n] : 0;
        output[c][n] = this.read(buf, write - d1 - 1) * g1 + this.read(buf, write - d2 - 1) * g2;
      }
      write = (write + 1) % this.size;
      phase += step;
      if (phase >= 1) phase -= 1;
      if (phase < 0) phase += 1;
    }
    this.write = write;
    this.phase = phase;
    return true;
  }
}

registerProcessor('pitch-shifter', PitchShifter);
