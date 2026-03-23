import { EegModule } from "./eeg.js";
import { PotentiostatModule } from "./potentiostat.js";

const appLog = document.getElementById("appLog");
const log = message => {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  appLog.textContent = `${line}\n${appLog.textContent}`.slice(0, 20000);
};

const elements = {
  browserSupport: document.getElementById("browserSupport"),
  activeModePill: document.getElementById("activeModePill"),
  eegControls: document.getElementById("eegControls"),
  potControls: document.getElementById("potControls"),
  timeCanvas: document.getElementById("timeCanvas"),
  fftCanvas: document.getElementById("fftCanvas"),
  timePlotTitle: document.getElementById("timePlotTitle"),
  plotMeta: document.getElementById("plotMeta"),
  fftTitle: document.getElementById("fftTitle"),
  fftMeta: document.getElementById("fftMeta"),
  eegBaud: document.getElementById("eegBaud"),
  eegChannels: document.getElementById("eegChannels"),
  eegFs: document.getElementById("eegFs"),
  eegWindow: document.getElementById("eegWindow"),
  eegLag: document.getElementById("eegLag"),
  eegFocus: document.getElementById("eegFocus"),
  eegGain: document.getElementById("eegGain"),
  eegSmooth: document.getElementById("eegSmooth"),
  eegNotch: document.getElementById("eegNotch"),
  eegBandpass: document.getElementById("eegBandpass"),
  eegAutoScale: document.getElementById("eegAutoScale"),
  eegShowBands: document.getElementById("eegShowBands"),
  eegTimestampFirst: document.getElementById("eegTimestampFirst"),
  connectEeg: document.getElementById("connectEeg"),
  disconnectEeg: document.getElementById("disconnectEeg"),
  togglePause: document.getElementById("togglePause"),
  saveEegFull: document.getElementById("saveEegFull"),
  saveScreenshot: document.getElementById("saveScreenshot"),
  eegStatus: document.getElementById("eegStatus"),
  potReadBaud: document.getElementById("potReadBaud"),
  potControlBaud: document.getElementById("potControlBaud"),
  potDuration: document.getElementById("potDuration"),
  potSampleRate: document.getElementById("potSampleRate"),
  potPwm: document.getElementById("potPwm"),
  potPwmSampleRate: document.getElementById("potPwmSampleRate"),
  connectPotRead: document.getElementById("connectPotRead"),
  connectPotControl: document.getElementById("connectPotControl"),
  disconnectPot: document.getElementById("disconnectPot"),
  potStart: document.getElementById("potStart"),
  potStop: document.getElementById("potStop"),
  potSave: document.getElementById("potSave"),
  potSetPwm: document.getElementById("potSetPwm"),
  potSetSampleRate: document.getElementById("potSetSampleRate"),
  potLedOn: document.getElementById("potLedOn"),
  potLedOff: document.getElementById("potLedOff"),
  potReadStatus: document.getElementById("potReadStatus"),
  potControlStatus: document.getElementById("potControlStatus"),
  potRecordStatus: document.getElementById("potRecordStatus"),
  manualCommand: document.getElementById("manualCommand"),
  sendManual: document.getElementById("sendManual"),
  clearLog: document.getElementById("clearLog"),
};

if ("serial" in navigator) {
  elements.browserSupport.textContent = "Web Serial ready";
  elements.browserSupport.className = "pill primary";
} else {
  elements.browserSupport.textContent = "Web Serial unavailable in this browser";
}

const eeg = new EegModule({ elements, log });
const pot = new PotentiostatModule({ elements, log, plotTimeCanvas: elements.timeCanvas, plotFftCanvas: elements.fftCanvas });

let activeMode = "eeg";
const applyMode = mode => {
  activeMode = mode;
  elements.activeModePill.textContent = `Mode: ${mode === "eeg" ? "EEG" : "Potentiostat"}`;
  elements.eegControls.classList.toggle("hidden", mode !== "eeg");
  elements.potControls.classList.toggle("hidden", mode !== "potentiostat");
  if (mode === "potentiostat") {
    elements.timePlotTitle.textContent = "Potentiostat Live Plot";
    elements.fftTitle.textContent = "Potentiostat Channel Snapshot";
  }
};

document.querySelectorAll('input[name="mode"]').forEach(node => {
  node.addEventListener("change", event => applyMode(event.target.value));
});
applyMode("eeg");

document.getElementById("sendManual").addEventListener("click", async () => {
  const text = elements.manualCommand.value.trim();
  if (!text) return;
  try {
    if (activeMode === "eeg") {
      await eeg.sendCommand(text.endsWith("\n") ? text : `${text}\n`);
    } else {
      await pot.sendControl(text.endsWith("\r") ? text : `${text}\r`);
    }
    log(`Manual command sent: ${text}`);
  } catch (err) {
    log(`Manual command failed: ${err.message}`);
  }
});

document.getElementById("clearLog").addEventListener("click", () => {
  appLog.textContent = "";
});

window.addEventListener("keydown", event => {
  if (activeMode !== "eeg") return;
  const key = event.key.toLowerCase();
  if (key === " ") {
    event.preventDefault();
    eeg.togglePause();
  } else if (key === "n") {
    elements.eegNotch.checked = !elements.eegNotch.checked;
    elements.eegNotch.dispatchEvent(new Event("input"));
  } else if (key === "f") {
    elements.eegBandpass.checked = !elements.eegBandpass.checked;
    elements.eegBandpass.dispatchEvent(new Event("input"));
  } else if (key === "g") {
    elements.eegGain.value = String(Math.max(0.1, Number(elements.eegGain.value || 1) * 0.8));
    elements.eegGain.dispatchEvent(new Event("input"));
  } else if (key === "h") {
    elements.eegGain.value = String(Number(elements.eegGain.value || 1) * 1.25);
    elements.eegGain.dispatchEvent(new Event("input"));
  } else if (key === "[") {
    elements.eegSmooth.value = String(Math.max(1, Number(elements.eegSmooth.value || 1) - 1));
    elements.eegSmooth.dispatchEvent(new Event("input"));
  } else if (key === "]") {
    elements.eegSmooth.value = String(Number(elements.eegSmooth.value || 1) + 1);
    elements.eegSmooth.dispatchEvent(new Event("input"));
  } else if (key === "c") {
    const next = (Number(elements.eegFocus.value || 1) % Number(elements.eegChannels.value || 10)) + 1;
    elements.eegFocus.value = String(next);
    elements.eegFocus.dispatchEvent(new Event("input"));
  } else if (key === "1") {
    eeg.saveLastSecondsCsv(5);
  } else if (key === "2") {
    eeg.saveLastSecondsCsv(30);
  } else if (key === "3") {
    eeg.saveLastSecondsCsv(60);
  } else if (key === "s") {
    elements.saveScreenshot.click();
  }
});

log("Unified device app loaded.");
