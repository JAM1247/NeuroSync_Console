export class SerialTextLineReader {
  constructor({ baudRate, onLine, onStatus, onError, lineEnding = "\n" }) {
    this.baudRate = baudRate;
    this.onLine = onLine;
    this.onStatus = onStatus;
    this.onError = onError;
    this.lineEnding = lineEnding;
    this.port = null;
    this.reader = null;
    this.decoder = new TextDecoder();
    this.running = false;
    this.buffer = "";
  }

  async connect() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baudRate, bufferSize: 4096 });
    this.onStatus?.(`Connected at ${this.baudRate} baud.`);
  }

  async start() {
    if (!this.port?.readable) throw new Error("Port is not readable.");
    this.running = true;
    this.reader = this.port.readable.getReader();
    this.readLoop();
  }

  async readLoop() {
    try {
      while (this.running) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        this.buffer += this.decoder.decode(value, { stream: true });
        let idx;
        while ((idx = this.buffer.indexOf(this.lineEnding)) >= 0) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + this.lineEnding.length);
          if (line) this.onLine?.(line);
        }
      }
    } catch (err) {
      this.onError?.(err);
    } finally {
      try { this.reader?.releaseLock(); } catch {}
      this.reader = null;
      this.running = false;
      this.onStatus?.("Stopped.");
    }
  }

  async write(text) {
    if (!this.port?.writable) throw new Error("Port is not writable.");
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(text));
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect() {
    this.running = false;
    try { await this.reader?.cancel(); } catch {}
    try { await this.port?.close(); } catch {}
    this.port = null;
  }
}

export class SerialBinaryReader {
  constructor({ baudRate, frameBytes, onFrame, onStatus, onError }) {
    this.baudRate = baudRate;
    this.frameBytes = frameBytes;
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.onError = onError;
    this.port = null;
    this.reader = null;
    this.running = false;
    this.buffer = new Uint8Array();
  }

  async connect() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baudRate, bufferSize: 2047 });
    this.onStatus?.(`Connected at ${this.baudRate} baud.`);
  }

  async start() {
    if (!this.port?.readable) throw new Error("Read port is not readable.");
    this.running = true;
    this.reader = this.port.readable.getReader();
    this.readLoop();
  }

  async readLoop() {
    try {
      while (this.running) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        const merged = new Uint8Array(this.buffer.length + value.length);
        merged.set(this.buffer);
        merged.set(value, this.buffer.length);
        this.buffer = merged;
        while (this.buffer.length >= this.frameBytes) {
          const frame = this.buffer.slice(0, this.frameBytes);
          this.buffer = this.buffer.slice(this.frameBytes);
          this.onFrame?.(frame);
        }
      }
    } catch (err) {
      this.onError?.(err);
    } finally {
      try { this.reader?.releaseLock(); } catch {}
      this.reader = null;
      this.running = false;
      this.onStatus?.("Stopped.");
    }
  }

  async disconnect() {
    this.running = false;
    try { await this.reader?.cancel(); } catch {}
    try { await this.port?.close(); } catch {}
    this.port = null;
    this.buffer = new Uint8Array();
  }
}

export class SerialCommandPort {
  constructor({ baudRate, onStatus }) {
    this.baudRate = baudRate;
    this.onStatus = onStatus;
    this.port = null;
  }

  async connect() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baudRate });
    this.onStatus?.(`Connected at ${this.baudRate} baud.`);
  }

  async write(text) {
    if (!this.port?.writable) throw new Error("Control port is not writable.");
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(text));
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect() {
    try { await this.port?.close(); } catch {}
    this.port = null;
  }
}
