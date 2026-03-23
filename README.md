# NeuroSync

## What it replaces

### EEG repo
- USB serial connection
- CSV stream parsing from Teensy
- timestamp-aware parsing for rows like `Timestamp(ms),A0,...,A9`
- gain
- smoothing
- focus channel spectrum
- 60 Hz notch toggle
- 0.5-40 Hz bandpass toggle
- pause/resume
- screenshot export
- save 5s / 30s / 60s / full EEG CSV
- device commands: `csv_on`, `csv_off`, `pi_on`, `pi_off`

### Potentiostat repo
- read port connect at 115200
- control port connect at 9600
- 18-channel binary frame decode
- start/stop recording
- auto-save on stop
- `readrate <samplerate>`
- `pwm <value> <samplerate>`
- `write 13 1`
- `write 13 0`
- CSV export


## Run locally

```bash
cd fixed-app
python -m http.server 8000
```

