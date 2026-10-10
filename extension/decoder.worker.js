// Classic worker: decodes DNG via dcraw (pure JS, asm.js) to 16/8-bit PPM, then encodes PNG.
// No eval, no wasm — runs under a strict MV3 extension CSP.
let loaded = false;
function load() {
  if (loaded) return;
  self.importScripts("png.classic.js");
  self.importScripts("vendor/dcraw/dcraw.js"); // defines global dcraw(rawBytes, options) -> output bytes
  loaded = true;
}

// Parse binary PPM (P6 rgb / P5 gray), 8- or 16-bit big-endian.
function parsePPM(bytes) {
  let pos = 0;
  function token() {
    while (pos < bytes.length && (bytes[pos] === 32 || bytes[pos] === 9 || bytes[pos] === 10 || bytes[pos] === 13)) pos++;
    if (bytes[pos] === 35) { while (pos < bytes.length && bytes[pos] !== 10) pos++; return token(); }
    let s = "";
    while (pos < bytes.length && bytes[pos] > 32) { s += String.fromCharCode(bytes[pos]); pos++; }
    return s;
  }
  const magic = token();
  if (magic !== "P6" && magic !== "P5") throw new Error("unexpected decoder output '" + magic + "'");
  const width = +token(), height = +token(), maxval = +token();
  pos++; // one whitespace after maxval
  const colors = magic === "P6" ? 3 : 1;
  const bits = maxval > 255 ? 16 : 8;
  const count = width * height * colors;
  let data;
  if (bits === 16) {
    data = new Uint16Array(count);
    for (let i = 0, j = pos; i < count; i++, j += 2) data[i] = (bytes[j] << 8) | bytes[j + 1];
  } else {
    data = bytes.subarray(pos, pos + count);
  }
  return { width, height, colors, bits, data };
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== "convert") return;
  try {
    load();
    const opts = {
      useCameraWhiteBalance: true,               // -w  (dcraw default output is already sRGB)
      setInterpolationQuality: String(msg.qual), // -q
    };
    if (msg.bits === 16) opts.use16BitMode = true; // -6
    const out = self.dcraw(new Uint8Array(msg.buffer), opts);
    if (!out || typeof out === "string" || out.length < 16)
      throw new Error("decode produced no image" + (typeof out === "string" ? ": " + out.slice(0, 160) : ""));
    const img = parsePPM(out instanceof Uint8Array ? out : new Uint8Array(out));
    const png = await self.encodePNG(img);
    self.postMessage(
      { type: "result", id: msg.id, ok: true, png: png.buffer, width: img.width, height: img.height, bits: img.bits },
      [png.buffer]
    );
  } catch (err) {
    self.postMessage({ type: "result", id: msg.id, ok: false, error: (err && err.message) || String(err) });
  }
};
