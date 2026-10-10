import { makeZip } from "./zip.js";

const MAX_FILES = 100;
const POOL_SIZE = 2;

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

let items = [];
let nextId = 0;
let running = false;

// ---- Worker pool (dcraw decode + PNG encode run off the UI thread) ----
const pool = [];
let msgId = 0;
function makeWorker() {
  const w = new Worker("decoder.worker.js");
  w.busy = false;
  w.jobs = new Map();
  w.onmessage = (e) => {
    const m = e.data;
    if (m.type !== "result") return;
    const job = w.jobs.get(m.id);
    if (!job) return;
    w.jobs.delete(m.id);
    w.busy = false;
    m.ok ? job.resolve(m) : job.reject(new Error(m.error));
    pump();
  };
  w.onerror = (e) => {
    for (const job of w.jobs.values()) job.reject(new Error(e.message || "worker error"));
    w.jobs.clear();
    w.busy = false;
    pump();
  };
  return w;
}
function ensurePool() { while (pool.length < POOL_SIZE) pool.push(makeWorker()); }

const waitQ = [];
function decode(buffer, bits, qual) {
  return new Promise((resolve, reject) => {
    waitQ.push({ buffer, bits, qual, resolve, reject });
    pump();
  });
}
function pump() {
  if (!waitQ.length) return;
  const w = pool.find((x) => !x.busy);
  if (!w) return;
  const task = waitQ.shift();
  const id = msgId++;
  w.busy = true;
  w.jobs.set(id, task);
  w.postMessage({ type: "convert", id, buffer: task.buffer, bits: task.bits, qual: task.qual }, [task.buffer]);
}

// ---- helpers ----
function baseName(name) { return name.replace(/\.[^.]+$/, ""); }
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

async function convertOne(it, bits, qual) {
  it.status = "working";
  render();
  try {
    const buf = await it.file.arrayBuffer();
    const r = await decode(buf, bits, qual);
    it.blob = new Blob([r.png], { type: "image/png" });
    it.url = URL.createObjectURL(it.blob);
    it.w = r.width;
    it.h = r.height;
    it.bits = r.bits;
    it.status = "done";
  } catch (e) {
    it.status = "error";
    it.error = (e && e.message) || String(e);
  }
  render();
}

async function runQueue() {
  if (running) return;
  running = true;
  render();
  ensurePool();
  const bits = Number(els.bits.value);
  const qual = Number(els.qual.value);
  const queue = items.filter((i) => i.status === "queued");
  await Promise.all(queue.map((it) => convertOne(it, bits, qual)));
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
    const n = seen.get(i.name) || 0;
    if (n) name = name.replace(/\.png$/, `_${n}.png`);
    seen.set(i.name, n + 1);
    return { name, blob: i.blob };
  });
  const zip = await makeZip(files);
  download(zip, "dng-to-png.zip");
  els.zip.textContent = "Download all (.zip)";
  els.zip.disabled = false;
}

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
