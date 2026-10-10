import LibRaw from "./vendor/libraw/index.js";
import { encodePNG } from "./png.js";
import { makeZip } from "./zip.js";

const MAX_FILES = 100;
const CONCURRENCY = 2;

const els = {
  drop: document.getElementById("drop"),
  input: document.getElementById("file"),
  list: document.getElementById("list"),
  convert: document.getElementById("convert"),
  zip: document.getElementById("zip"),
  clear: document.getElementById("clear"),
  bits: document.getElementById("bits"),
  qual: document.getElementById("qual"),
  summary: document.getElementById("summary"),
};

let items = []; // { id, file, status, name, blob, url, w, h, bits, error }
let nextId = 0;
let running = false;

function baseName(name) {
  return name.replace(/\.[^.]+$/, "");
}
function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

function addFiles(fileList) {
  const incoming = Array.from(fileList).filter((f) =>
    /\.dng$/i.test(f.name) || f.type === "image/x-adobe-dng" || f.type === "image/dng"
  );
  for (const f of incoming) {
    if (items.length >= MAX_FILES) break;
    items.push({ id: nextId++, file: f, status: "queued", name: baseName(f.name) + ".png" });
  }
  render();
}

function render() {
  els.list.innerHTML = "";
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "row " + it.status;
    const left = document.createElement("div");
    left.className = "meta";
    const title = document.createElement("div");
    title.className = "fname";
    title.textContent = it.file.name;
    const sub = document.createElement("div");
    sub.className = "sub";
    if (it.status === "done") sub.textContent = `${it.w}×${it.h} · ${it.bits}-bit · ${fmtBytes(it.blob.size)}`;
    else if (it.status === "error") sub.textContent = "Error: " + it.error;
    else if (it.status === "working") sub.textContent = "Converting…";
    else sub.textContent = fmtBytes(it.file.size) + " · queued";
    left.append(title, sub);
    const right = document.createElement("div");
    right.className = "actions";
    if (it.status === "done") {
      const a = document.createElement("a");
      a.href = it.url;
      a.download = it.name;
      a.className = "btn small";
      a.textContent = "Download";
      right.append(a);
    }
    const badge = document.createElement("span");
    badge.className = "badge " + it.status;
    badge.textContent = it.status;
    right.append(badge);
    row.append(left, right);
    els.list.append(row);
  }
  const done = items.filter((i) => i.status === "done").length;
  const err = items.filter((i) => i.status === "error").length;
  els.summary.textContent = items.length
    ? `${items.length} file(s) · ${done} done · ${err} failed`
    : "No files yet.";
  els.convert.disabled = running || !items.some((i) => i.status === "queued");
  els.zip.disabled = done === 0;
  els.clear.disabled = running || items.length === 0;
  els.bits.disabled = running;
  els.qual.disabled = running;
}

function settings() {
  return {
    useCameraWb: true,
    outputColor: 1,       // sRGB
    outputBps: Number(els.bits.value), // 8 or 16
    userQual: Number(els.qual.value),  // demosaic quality
    halfSize: false,
    userFlip: -1,         // keep camera orientation
    highlight: 0,
    noAutoBright: false,
  };
}

async function convertOne(it) {
  it.status = "working";
  render();
  const raw = new LibRaw();
  try {
    const buf = new Uint8Array(await it.file.arrayBuffer());
    await raw.open(buf, settings());
    const img = await raw.imageData();
    if (!img) throw new Error("decode returned no image");
    it.blob = await encodePNG({
      width: img.width,
      height: img.height,
      colors: img.colors,
      bits: img.bits,
      data: img.data,
    });
    it.url = URL.createObjectURL(it.blob);
    it.w = img.width;
    it.h = img.height;
    it.bits = img.bits;
    it.status = "done";
  } catch (e) {
    it.status = "error";
    it.error = (e && e.message) || String(e);
  } finally {
    raw.dispose();
    render();
  }
}

async function runQueue() {
  if (running) return;
  running = true;
  render();
  const queue = items.filter((i) => i.status === "queued");
  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      const it = queue[idx++];
      await convertOne(it);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) workers.push(worker());
  await Promise.all(workers);
  running = false;
  render();
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function downloadZip() {
  const done = items.filter((i) => i.status === "done");
  if (!done.length) return;
  els.zip.disabled = true;
  els.zip.textContent = "Zipping…";
  const seen = new Map();
  const files = done.map((i) => {
    let name = i.name;
    const n = seen.get(name) || 0;
    if (n) name = name.replace(/\.png$/, `_${n}.png`);
    seen.set(i.name, n + 1);
    return { name, blob: i.blob };
  });
  const zip = await makeZip(files);
  download(zip, "dng-to-png.zip");
  els.zip.textContent = "Download all (.zip)";
  els.zip.disabled = false;
}

// Events
els.input.addEventListener("change", (e) => { addFiles(e.target.files); els.input.value = ""; });
els.drop.addEventListener("click", () => els.input.click());
["dragenter", "dragover"].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add("over"); })
);
["dragleave", "drop"].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove("over"); })
);
els.drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
els.convert.addEventListener("click", runQueue);
els.zip.addEventListener("click", downloadZip);
els.clear.addEventListener("click", () => {
  for (const i of items) if (i.url) URL.revokeObjectURL(i.url);
  items = [];
  render();
});

render();
