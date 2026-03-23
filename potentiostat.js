import { SerialBinaryReader, SerialCommandPort } from "./serial.js";
import { downloadTextFile, matrixToCsv } from "./export.js";

export class PotentiostatModule {
  constructor({ elements, log, plotTimeCanvas, plotFftCanvas }) {
    this.el = elements;
    this.log = log;
    this.timeCanvas = plotTimeCanvas;
    this.fftCanvas = plotFftCanvas;
    this.readPort = null;
    this.controlPort = null;
    this.recording = false;
    this.numPins = 18;
    this.frameBytes = this.numPins * 2;
    this.arr = [this.headers()];
    this.count = 0;
    this.maxCount = 100000;
    this.bindUi();
  }

  headers() {
    return Array.from({ length: this.numPins }, (_, i) => `A${i}`);
  }

  bindUi() {
    this.el.connectPotRead.addEventListener("click", async () => this.connectRead());
    this.el.connectPotControl.addEventListener("click", async () => this.connectControl());
    this.el.disconnectPot.addEventListener("click", async () => this.disconnectAll());
    this.el.potStart.addEventListener("click", async () => this.startRecording());
    this.el.potStop.addEventListener("click", async () => this.stopRecording());
    this.el.potSave.addEventListener("click", () => this.saveCsv());
    this.el.potSetPwm.addEventListener("click", async () => this.setPwm());
    this.el.potSetSampleRate.addEventListener("click", async () => this.setSampleRate());
    this.el.potLedOn.addEventListener("click", async () => this.sendControl("write 13 1\r"));
    this.el.potLedOff.addEventListener("click", async () => this.sendControl("write 13 0\r"));
  }

  async connectRead() {
    this.readPort = new SerialBinaryReader({
      baudRate: Number(this.el.potReadBaud.value || 115200),
      frameBytes: this.frameBytes,
      onFrame: frame => this.handleFrame(frame),
      onStatus: msg => { this.el.potReadStatus.textContent = `Read port: ${msg}`; this.log(`Pot read: ${msg}`); },
      onError: err => { this.el.potReadStatus.textContent = `Read error: ${err.message}`; this.log(`Pot read error: ${err.message}`); },
    });
    await this.readPort.connect();
    this.el.potReadStatus.textContent = `Read port connected at ${this.el.potReadBaud.value} baud.`;
  }

  async connectControl() {
    this.controlPort = new SerialCommandPort({
      baudRate: Number(this.el.potControlBaud.value || 9600),
      onStatus: msg => { this.el.potControlStatus.textContent = `Control port: ${msg}`; this.log(`Pot control: ${msg}`); },
    });
    await this.controlPort.connect();
    this.el.potControlStatus.textContent = `Control port connected at ${this.el.potControlBaud.value} baud.`;
  }

  async disconnectAll() {
    await this.stopRecording(false);
    await this.readPort?.disconnect();
    await this.controlPort?.disconnect();
    this.readPort = null;
    this.controlPort = null;
    this.el.potReadStatus.textContent = "Read port disconnected.";
    this.el.potControlStatus.textContent = "Control port disconnected.";
  }

  decodeSerialData(frame) {
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const readings = [];
    for (let i = 0; i < this.numPins; i += 1) readings.push(view.getUint16(i * 2, true));
    return readings;
  }

  handleFrame(frame) {
    if (!this.recording) return;
    const readings = this.decodeSerialData(frame);
    this.arr.push(readings);
    this.count += 1;
    this.renderPlot();
    this.el.potRecordStatus.textContent = `Recording… ${this.count}/${this.maxCount} frames`;
    if (this.count >= this.maxCount) this.stopRecording(true);
  }

  async startRecording() {
    if (!this.readPort?.port?.readable) throw new Error("Read port must be connected first.");
    const duration = Number(this.el.potDuration.value || 5);
    const sampleRate = Number(this.el.potSampleRate.value || 5000);
    this.maxCount = duration * sampleRate;
    this.arr = [this.headers()];
    this.count = 0;
    this.recording = true;
    this.el.potRecordStatus.textContent = `Recording started for ${duration}s at ${sampleRate} Hz target.`;
    if (this.controlPort?.port?.writable) {
      await this.sendControl(`readrate ${sampleRate}\r`);
      await this.sendControl(`pwm ${Number(this.el.potPwm.value || 300)} ${Number(this.el.potPwmSampleRate.value || sampleRate)}\r`);
    }
    await this.readPort.start();
  }

  async stopRecording(autoSave = true) {
    if (!this.recording) return;
    this.recording = false;
    await this.readPort?.disconnect();
    this.readPort = null;
    this.el.potRecordStatus.textContent = `Stopped at ${this.count} frames.`;
    if (autoSave && this.arr.length > 1) this.saveCsv();
  }

  async sendControl(text) {
    if (!this.controlPort) throw new Error("Control port is not connected.");
    await this.controlPort.write(text);
    this.log(`Pot control sent: ${text.trim()}`);
  }

  async setPwm() {
    await this.sendControl(`pwm ${Number(this.el.potPwm.value || 300)} ${Number(this.el.potPwmSampleRate.value || 5000)}\r`);
  }

  async setSampleRate() {
    await this.sendControl(`readrate ${Number(this.el.potSampleRate.value || 5000)}\r`);
  }

  saveCsv() {
    if (this.arr.length <= 1) return this.log("No potentiostat data available to save.");
    const csv = matrixToCsv(this.arr[0], this.arr.slice(1));
    downloadTextFile("data.csv", csv, "text/csv");
    this.log(`Saved potentiostat CSV with ${this.arr.length - 1} rows.`);
  }

  renderPlot() {
    const ctx = this.timeCanvas.getContext("2d");
    const fft = this.fftCanvas.getContext("2d");
    ctx.clearRect(0, 0, this.timeCanvas.width, this.timeCanvas.height);
    fft.clearRect(0, 0, this.fftCanvas.width, this.fftCanvas.height);
    ctx.fillStyle = "#09101e"; ctx.fillRect(0, 0, this.timeCanvas.width, this.timeCanvas.height);
    fft.fillStyle = "#09101e"; fft.fillRect(0, 0, this.fftCanvas.width, this.fftCanvas.height);
    const rows = this.arr.slice(-500);
    if (rows.length <= 1) return;
    const data = rows.slice(1);
    const series = data.map(row => row[0]);
    const min = Math.min(...series);
    const max = Math.max(...series);
    ctx.beginPath();
    series.forEach((v, i) => {
      const x = 60 + (i / Math.max(1, series.length - 1)) * (this.timeCanvas.width - 90);
      const y = this.timeCanvas.height - 40 - ((v - min) / Math.max(1, max - min)) * (this.timeCanvas.height - 80);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#7af0c7";
    ctx.lineWidth = 2;
    ctx.stroke();

    const latest = data[data.length - 1];
    const barWidth = (this.fftCanvas.width - 100) / latest.length;
    latest.forEach((v, i) => {
      const h = (v / 4095) * (this.fftCanvas.height - 60);
      fft.fillStyle = i === 0 ? "#ffd166" : "#66b2ff";
      fft.fillRect(60 + i * barWidth, this.fftCanvas.height - 35 - h, barWidth * 0.8, h);
    });
  }
}
