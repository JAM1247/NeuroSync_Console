function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function biquadCoefficients(type, fs, f0, q = Math.SQRT1_2) {
  const w0 = 2 * Math.PI * f0 / fs;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * q);
  let b0, b1, b2, a0, a1, a2;

  if (type === "notch") {
    b0 = 1;
    b1 = -2 * cosw0;
    b2 = 1;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  } else if (type === "lowpass") {
    b0 = (1 - cosw0) / 2;
    b1 = 1 - cosw0;
    b2 = (1 - cosw0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  } else if (type === "highpass") {
    b0 = (1 + cosw0) / 2;
    b1 = -(1 + cosw0);
    b2 = (1 + cosw0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  } else {
    throw new Error(`Unsupported biquad type: ${type}`);
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function applyBiquad1d(signal, coeffs) {
  const y = new Float64Array(signal.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i += 1) {
    const x0 = signal[i];
    const out = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2;
    y[i] = out;
    x2 = x1; x1 = x0; y2 = y1; y1 = out;
  }
  return y;
}

function movingAverage1d(signal, windowSize) {
  if (windowSize <= 1) return Float64Array.from(signal);
  const out = new Float64Array(signal.length);
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < signal.length; i += 1) {
    const start = Math.max(0, i - half);
    const end = Math.min(signal.length, i + half + 1);
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += signal[j];
    out[i] = sum / (end - start);
  }
  return out;
}

export function processEegData(matrix, fs, state) {
  if (!matrix.length) return [];
  const channels = matrix[0].length;
  const out = Array.from({ length: matrix.length }, (_, i) => Float64Array.from(matrix[i]));

  for (let ch = 0; ch < channels; ch += 1) {
    let signal = Float64Array.from(out.map(row => row[ch]));
    if (state.notchEnabled) {
      const notch = biquadCoefficients("notch", fs, clamp(60, 1, fs / 2 - 1), 30);
      signal = applyBiquad1d(signal, notch);
    }
    if (state.bandpassEnabled) {
      const hp = biquadCoefficients("highpass", fs, clamp(0.5, 0.01, fs / 2 - 1), 0.707);
      const lp = biquadCoefficients("lowpass", fs, clamp(40, 0.01, fs / 2 - 1), 0.707);
      signal = applyBiquad1d(signal, hp);
      signal = applyBiquad1d(signal, lp);
    }
    signal = movingAverage1d(signal, Math.max(1, Math.floor(state.smoothingWindow || 1)));
    for (let i = 0; i < out.length; i += 1) out[i][ch] = signal[i];
  }

  return out.map(row => Array.from(row));
}

export function detectArtifacts(matrix, threshold = 7.0) {
  if (!matrix.length) return [];
  const channels = matrix[0].length;
  const flags = [];
  for (let ch = 0; ch < channels; ch += 1) {
    let sumSq = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const row of matrix) {
      const v = row[ch];
      sumSq += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const rms = Math.sqrt(sumSq / matrix.length + 1e-6);
    flags.push((max - min) > threshold * rms);
  }
  return flags;
}

export function computeSpectrum(signal, fs) {
  const n = signal.length;
  if (n < 2) return { freqs: [], mags: [] };
  const centered = signal.map(v => v - signal.reduce((a, b) => a + b, 0) / n);
  const half = Math.floor(n / 2);
  const freqs = [];
  const mags = [];
  for (let k = 0; k <= half; k += 1) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t += 1) {
      const angle = -2 * Math.PI * k * t / n;
      re += centered[t] * Math.cos(angle);
      im += centered[t] * Math.sin(angle);
    }
    freqs.push(k * fs / n);
    mags.push(Math.sqrt(re * re + im * im) / (n * 0.5));
  }
  return { freqs, mags };
}
