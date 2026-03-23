import { SerialTextLineReader } from "./serial.js";
import { processEegData, detectArtifacts, computeSpectrum } from "./filters.js";
import { downloadTextFile, matrixToCsv, saveCanvasPng, timestampTag } from "./export.js";

const DEFAULT_HISTORY_SECONDS = 120;
const CHANNEL_VERTICAL_SPACING = 4.0;

export class EegModule {
  constructor({ elements, log }) {
    this.el = elements;
    this.log = log;
    this.reader = null;
    this.paused = false;
    this.sampleRows = [];
    this.timeRows = [];
    this.maxSamples = 250 * DEFAULT_HISTORY_SECONDS;
    this.animating = false;
    this.lastRender = 0;
    this.state = this.readUiState();
    this.bindUi();
  }

  readUiState() {
    const fs = Number(this.el.eegFs.value || 250);
    return {
      baud: Number(this.el.eegBaud.value || 115200),
      channels: Number(this.el.eegChannels.value || 10),
      fs,
      windowSeconds: Number(this.el.eegWindow.value || 5),
      lagSeconds: Number(this.el.eegLag.value || 0.5),
      focusChannel: Math.max(0, Number(this.el.eegFocus.value || 1) - 1),
      gain: Number(this.el.eegGain.value || 1),
      smoothingWindow: Number(this.el.eegSmooth.value || 1),
      notchEnabled: this.el.eegNotch.checked,
      bandpassEnabled: this.el.eegBandpass.checked,
      autoScale: this.el.eegAutoScale.checked,
      showBands: this.el.eegShowBands.checked,
      timestampFirst: this.el.eegTimestampFirst.checked,
    };
  }

  bindUi() {
    const sync = () => {
      this.state = this.readUiState();
      this.maxSamples = Math.max(this.maxSamples, Math.ceil(this.state.fs * DEFAULT_HISTORY_SECONDS));
    };
    [
      this.el.eegBaud, this.el.eegChannels, this.el.eegFs, this.el.eegWindow, this.el.eegLag,
      this.el.eegFocus, this.el.eegGain, this.el.eegSmooth, this.el.eegNotch, this.el.eegBandpass,
      this.el.eegAutoScale, this.el.eegShowBands, this.el.eegTimestampFirst,
    ].forEach(node => node.addEventListener("input", sync));

    this.el.connectEeg.addEventListener("click", async () => this.connect());
    this.el.disconnectEeg.addEventListener("click", async () => this.disconnect());
    this.el.togglePause.addEventListener("click", () => this.togglePause());
    this.el.saveEegFull.addEventListener("click", () => this.saveFullCsv());
    this.el.saveScreenshot.addEventListener("click", () => saveCanvasPng(this.el.timeCanvas, "eeg_screenshot"));
    document.querySelectorAll("[data-eeg-cmd]").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await this.sendCommand(`${btn.dataset.eegCmd}\n`);
          this.log(`EEG command sent: ${btn.dataset.eegCmd}`);
        } catch (err) {
          this.log(`EEG command failed: ${err.message}`);
        }
      });
    });
    document.querySelectorAll("[data-save-seconds]").forEach(btn => {
      btn.addEventListener("click", () => this.saveLastSecondsCsv(Number(btn.dataset.saveSeconds)));
    });
  }

  async connect() {
    this.state = this.readUiState();
    this.maxSamples = Math.ceil(this.state.fs * DEFAULT_HISTORY_SECONDS);
    this.reader = new SerialTextLineReader({
      baudRate: this.state.baud,
      onLine: line => this.handleLine(line),
      onStatus: msg => { this.el.eegStatus.textContent = msg; this.log(`EEG: ${msg}`); },
      onError: err => { this.el.eegStatus.textContent = `Error: ${err.message}`; this.log(`EEG error: ${err.message}`); },
    });
    await this.reader.connect();
    await this.reader.start();
    try { await this.reader.write("csv_on\n"); } catch {}
    this.el.eegStatus.textContent = `Connected on ${this.state.baud} baud.`;
    this.startAnimation();
  }

  async disconnect() {
    if (this.reader) {
      try { await this.reader.write("csv_off\n"); } catch {}
      await this.reader.disconnect();
      this.reader = null;
    }
    this.el.eegStatus.textContent = "EEG disconnected.";
  }

  async sendCommand(text) {
    if (!this.reader) throw new Error("EEG port is not connected.");
    await this.reader.write(text);
  }

  togglePause() {
    this.paused = !this.paused;
    this.el.togglePause.textContent = this.paused ? "Resume" : "Pause";
    this.log(`EEG ${this.paused ? "paused" : "resumed"}.`);
  }

  handleLine(line) {
    if (this.paused) return;
    if (/Teensy 4\.1 Ready/i.test(line) || /^Timestamp\(ms\)/i.test(line) || /^Unknown cmd/i.test(line) || /output:/i.test(line)) {
      this.log(`EEG device: ${line}`);
      return;
    }
    const parts = line.split(",").map(p => p.trim());
    const needed = this.state.timestampFirst ? this.state.channels + 1 : this.state.channels;
    if (parts.length < needed) return;

    let timestamp = Date.now();
    let startIdx = 0;
    if (this.state.timestampFirst) {
      const t = Number(parts[0]);
      if (Number.isFinite(t)) timestamp = t;
      startIdx = 1;
    }

    const row = [];
    for (let i = 0; i < this.state.channels; i += 1) {
      const v = Number(parts[startIdx + i]);
      row.push(Number.isFinite(v) ? v : 0);
    }

    this.sampleRows.push(row);
    this.timeRows.push(timestamp);
    if (this.sampleRows.length > this.maxSamples) {
      this.sampleRows.splice(0, this.sampleRows.length - this.maxSamples);
      this.timeRows.splice(0, this.timeRows.length - this.maxSamples);
    }
  }

  getWindowedData() {
    const s = this.readUiState();
    this.state = s;
    const windowSamples = Math.max(2, Math.round(s.windowSeconds * s.fs));
    const lagSamples = Math.max(0, Math.round(s.lagSeconds * s.fs));
    const end = Math.max(0, this.sampleRows.length - lagSamples);
    const start = Math.max(0, end - windowSamples);
    return this.sampleRows.slice(start, end);
  }

  saveLastSecondsCsv(seconds) {
    const rows = this.sampleRows.slice(Math.max(0, this.sampleRows.length - Math.round(seconds * this.state.fs)));
    if (!rows.length) return this.log("No EEG data available to save.");
    const time = rows.map((_, i) => [-(rows.length - i) / this.state.fs, ...rows[i]]);
    const headers = ["time_offset", ...Array.from({ length: this.state.channels }, (_, i) => `ch${i + 1}`)];
    const csv = matrixToCsv(headers, time);
    downloadTextFile(`eeg_capture_${seconds}s_${timestampTag()}.csv`, csv, "text/csv");
    this.log(`Saved last ${seconds}s of EEG.`);
  }

  saveFullCsv() {
    if (!this.sampleRows.length) return this.log("No EEG data available to save.");
    const headers = this.state.timestampFirst
      ? ["Timestamp(ms)", ...Array.from({ length: this.state.channels }, (_, i) => `A${i}`)]
      : Array.from({ length: this.state.channels }, (_, i) => `A${i}`);
    const rows = this.sampleRows.map((row, i) => this.state.timestampFirst ? [this.timeRows[i], ...row] : row);
    const csv = matrixToCsv(headers, rows);
    downloadTextFile(`eeg_full_${timestampTag()}.csv`, csv, "text/csv");
    this.log("Saved full EEG buffer.");
  }

  startAnimation() {
    if (this.animating) return;
    this.animating = true;
    const tick = t => {
      if (!this.animating) return;
      if (t - this.lastRender > 50) {
        this.lastRender = t;
        this.render();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stopAnimation() { this.animating = false; }

  render() {
    const canvas = this.el.timeCanvas;
    const ctx = canvas.getContext("2d");
    const fftCanvas = this.el.fftCanvas;
    const fctx = fftCanvas.getContext("2d");
    const raw = this.getWindowedData();
    const s = this.state;

    this.el.timePlotTitle.textContent = `EEG Time Domain - ${s.channels} Channels @ ${s.fs.toFixed(0)} Hz`;
    this.el.plotMeta.textContent = raw.length ? `${raw.length} samples in view` : "Waiting for EEG data…";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fctx.clearRect(0, 0, fftCanvas.width, fftCanvas.height);
    ctx.fillStyle = "#09101e"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    fctx.fillStyle = "#09101e"; fctx.fillRect(0, 0, fftCanvas.width, fftCanvas.height);

    if (!raw.length) return;

    const processed = processEegData(raw, s.fs, s);
    const artifacts = detectArtifacts(processed);
    const offsets = Array.from({ length: s.channels }, (_, i) => i * CHANNEL_VERTICAL_SPACING + 2);
    const means = Array.from({ length: s.channels }, () => 0);
    const scales = Array.from({ length: s.channels }, () => 1);

    for (let ch = 0; ch < s.channels; ch += 1) {
      const col = processed.map(row => row[ch]);
      const mean = col.reduce((a, b) => a + b, 0) / col.length;
      means[ch] = mean;
      const variance = col.reduce((a, b) => a + (b - mean) ** 2, 0) / col.length;
      const rms = Math.sqrt(col.reduce((a, b) => a + b * b, 0) / col.length + 1e-6);
      scales[ch] = s.autoScale ? rms : Math.sqrt(variance + 1e-6);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    for (let i = 0; i < 10; i += 1) {
      const x = (i / 9) * (canvas.width - 100) + 70;
      ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, canvas.height - 30); ctx.stroke();
    }

    ctx.font = "bold 14px sans-serif";
    for (let ch = 0; ch < s.channels; ch += 1) {
      ctx.fillStyle = artifacts[ch] ? "#ff7f96" : "#cfe1ff";
      const yBase = canvas.height - 30 - (offsets[ch] / (offsets[offsets.length - 1] + 4)) * (canvas.height - 60);
      ctx.fillText(`Ch${ch + 1}`, 12, yBase + 5);

      ctx.beginPath();
      for (let i = 0; i < processed.length; i += 1) {
        const x = 70 + (i / Math.max(1, processed.length - 1)) * (canvas.width - 100);
        const normalized = ((processed[i][ch] - means[ch]) / (scales[ch] || 1e-6)) * s.gain + offsets[ch];
        const y = canvas.height - 30 - (normalized / (offsets[offsets.length - 1] + 4)) * (canvas.height - 60);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineWidth = artifacts[ch] ? 2.5 : 1.3;
      ctx.strokeStyle = artifacts[ch] ? "#ff7f96" : "#66b2ff";
      ctx.stroke();
    }

    const focus = Math.max(0, Math.min(s.channels - 1, s.focusChannel));
    const focusSignal = processed.map(row => row[focus]);
    const { freqs, mags } = computeSpectrum(focusSignal, s.fs);
    const filteredFreqs = freqs.map((f, i) => ({ f, m: mags[i] })).filter(({ f }) => f <= 60);
    this.el.fftTitle.textContent = `Power Spectrum - Channel ${focus + 1}`;
    this.el.fftMeta.textContent = `${s.notchEnabled ? "Notch on" : "Notch off"} · ${s.bandpassEnabled ? "Bandpass on" : "Bandpass off"}`;

    if (s.showBands) {
      const bands = [
        ["Delta", 0.5, 3.0, "rgba(224,242,241,0.15)"],
        ["Theta", 4.0, 7.0, "rgba(178,223,219,0.18)"],
        ["Alpha", 8.0, 12.0, "rgba(128,203,196,0.2)"],
        ["Beta", 13.0, 30.0, "rgba(77,182,172,0.18)"],
        ["Gamma", 30.0, 45.0, "rgba(38,166,154,0.16)"],
      ];
      for (const [label, lo, hi, color] of bands) {
        const x0 = 60 + (lo / 60) * (fftCanvas.width - 90);
        const x1 = 60 + (hi / 60) * (fftCanvas.width - 90);
        fctx.fillStyle = color;
        fctx.fillRect(x0, 20, x1 - x0, fftCanvas.height - 55);
        fctx.fillStyle = "#dfeeff";
        fctx.fillText(label, (x0 + x1) / 2 - 15, 35);
      }
    }

    const maxMag = Math.max(1e-6, ...filteredFreqs.map(v => v.m));
    fctx.strokeStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i <= 6; i += 1) {
      const y = 20 + i / 6 * (fftCanvas.height - 55);
      fctx.beginPath(); fctx.moveTo(60, y); fctx.lineTo(fftCanvas.width - 30, y); fctx.stroke();
    }
    fctx.beginPath();
    filteredFreqs.forEach(({ f, m }, i) => {
      const x = 60 + (f / 60) * (fftCanvas.width - 90);
      const y = fftCanvas.height - 35 - (m / maxMag) * (fftCanvas.height - 60);
      if (i === 0) fctx.moveTo(x, y); else fctx.lineTo(x, y);
    });
    fctx.strokeStyle = "#ffb24d";
    fctx.lineWidth = 2;
    fctx.stroke();
  }
}
