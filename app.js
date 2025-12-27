// ---------------------------
// 1) FIXED PERMUTATION SETUP
// ---------------------------
// Keep this seed constant forever. Changing it changes the permutation.
const PERM_SEED = 0xC0FFEE; // pick any 32-bit integer you like, but DON'T change it later

// Deterministic PRNG (Mulberry32)
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makePermutation(seed) {
  const rand = mulberry32(seed);
  const arr = new Uint16Array(256);
  for (let i = 0; i < 256; i++) arr[i] = i;

  // Fisher–Yates shuffle
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }

  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = arr[i] & 0xff;
  return perm;
}

const PERM = makePermutation(PERM_SEED);

// ---------------------------
// 2) UI + IMAGE PROCESSING
// ---------------------------
const fileInput = document.getElementById("fileInput");
const downloadLink = document.getElementById("downloadLink");
const outCanvas = document.getElementById("outCanvas");
const permInfo = document.getElementById("permInfo");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");

let lastDownloadUrl = null;

function setError(msg) {
  errorEl.textContent = msg || "";
}

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function setDownloadDisabled(disabled) {
  if (disabled) {
    downloadLink.setAttribute("aria-disabled", "true");
    downloadLink.removeAttribute("href");
    downloadLink.removeAttribute("download");
  } else {
    downloadLink.setAttribute("aria-disabled", "false");
  }
}

// Show a tiny proof that the permutation is fixed.
(function initPermInfo() {
  const previewPairs = [];
  for (let i = 0; i < 16; i++) previewPairs.push(`${i}→${PERM[i]}`);
  permInfo.textContent =
    `Fixed permutation seed: 0x${PERM_SEED.toString(16)} | sample: ${previewPairs.join(", ")} ...`;
})();

// Loads image into a bitmap with EXIF orientation when available
async function fileToImageBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);

    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return await createImageBitmap(c);
  }
}

async function processFile(file) {
  setError("");
  setStatus("Processing...");
  setDownloadDisabled(true);

  // Clean up old download URL
  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl);
    lastDownloadUrl = null;
  }

  const bmp = await fileToImageBitmap(file);

  outCanvas.width = bmp.width;
  outCanvas.height = bmp.height;

  const ctx = outCanvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);

  const imgData = ctx.getImageData(0, 0, outCanvas.width, outCanvas.height);
  const data = imgData.data; // [R,G,B,A,...]

  // Apply permutation to R,G,B; leave A unchanged.
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = PERM[data[i]];     // R
    data[i + 1] = PERM[data[i + 1]]; // G
    data[i + 2] = PERM[data[i + 2]]; // B
  }

  ctx.putImageData(imgData, 0, 0);

  // Create downloadable file
  const blob = await new Promise((resolve) => outCanvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not export image.");

  lastDownloadUrl = URL.createObjectURL(blob);
  downloadLink.href = lastDownloadUrl;
  downloadLink.download = "permuted.png";
  setDownloadDisabled(false);

  setStatus(`Done. ${bmp.width}×${bmp.height} — ready to download.`);
}

fileInput.addEventListener("change", async () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;

  if (!f.type.startsWith("image/")) {
    setError("Please choose an image file.");
    setStatus("");
    return;
  }

  try {
    await processFile(f);
  } catch (e) {
    setError(e?.message || String(e));
    setStatus("");
  }
});
