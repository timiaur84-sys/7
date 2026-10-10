# DNG → PNG Converter (Chrome Extension)

Batch-convert DNG raw photos to PNG at full resolution and quality, entirely on your device. No upload, no server.

## Features
- Up to **100** DNG files per batch
- **Full resolution** — original pixel dimensions preserved
- **Lossless PNG**, default **16-bit** (full tonal range from the raw sensor)
- Camera white balance, sRGB, selectable demosaic quality
- Download files individually or all at once as a `.zip`
- Works **offline** — decoding runs locally in a background worker

## Install (Load unpacked)
1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Click the extension's toolbar icon → the converter opens in a tab

## Use
1. Drop or choose `.dng` files
2. Pick depth (16-bit = max quality) and demosaic quality
3. **Convert**
4. **Download** each, or **Download all (.zip)**

## Notes
- 16-bit PNGs are larger but preserve the raw's full dynamic range. Choose 8-bit for smaller files.
- Decoding is CPU-heavy; large batches take time. Two files are processed in parallel.
- Raw decoding uses a JavaScript build of dcraw (no WebAssembly, no `eval`), so it runs under the strict Manifest V3 content security policy.
