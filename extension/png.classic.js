// Classic worker script: self.encodePNG(opts) -> Promise<Uint8Array>
(function () {
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  async function deflate(bytes) {
    const cs = new CompressionStream("deflate");
    const w = cs.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }
  function filterRaster(src, height, stride, bpp) {
    const out = new Uint8Array(height * (stride + 1));
    let prevOff = -1;
    for (let y = 0; y < height; y++) {
      const inOff = y * stride, outOff = y * (stride + 1);
      out[outOff] = 4;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? src[inOff + x - bpp] : 0;
        const b = prevOff >= 0 ? src[prevOff + x] : 0;
        const c = prevOff >= 0 && x >= bpp ? src[prevOff + x - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        out[outOff + 1 + x] = (src[inOff + x] - pred) & 0xff;
      }
      prevOff = inOff;
    }
    return out;
  }
  self.encodePNG = async function ({ width, height, colors, bits, data }) {
    const colorType = colors === 1 ? 0 : colors === 4 ? 6 : 2;
    const bps = bits === 16 ? 2 : 1;
    const bpp = colors * bps, stride = width * bpp;
    const raster = new Uint8Array(height * stride);
    if (bits === 16) {
      for (let i = 0, j = 0; i < data.length; i++, j += 2) { raster[j] = data[i] >>> 8; raster[j + 1] = data[i] & 0xff; }
    } else {
      raster.set(data.subarray ? data.subarray(0, raster.length) : data);
    }
    const idat = await deflate(filterRaster(raster, height, stride, bpp));
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = bits; ihdr[9] = colorType;
    const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
    let total = 0; for (const p of parts) total += p.length;
    const out = new Uint8Array(total); let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };
})();
