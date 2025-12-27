// ---------------------------
// 1) FIXED PERMUTATION SETUP
// ---------------------------
// Keep this seed constant forever. Changing it changes the permutation.
const PERM_SEED = 0xC0FFEE; // pick any 32-bit integer you like, but DON'T change it later

// Deterministic PRNG (Mulberry32): small, fast, stable for this use.
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

  // Convert to Uint8Array for fast indexing
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = arr[i] & 0xff;
  return perm;
}

const PERM = makePermutation(PERM_SEED);

// ---------------------------
// 2) UI + IMAGE PROCESSING
// ---------------------------
const fileInput = document.getElementById("fileInput");
const processBtn = document.getElementById("processBtn");
const downloadLink = document.getElementById("downloadLink");
const outCanvas = document.getElementById("outCanvas");
const permInfo = document.getElementById("permInfo");
const errorEl = document.getElementById("error");

let loadedFile = null;
let lastDownloadUrl = null;

function isMobileDevice() {
  const ua = navigator.userAgent || "";

  const isIpad =
    /iPad/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS pretending to be Mac

  const isIphone = /iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);

  return isIpad || isIphone || isAndroid;
}


function enableDownloadOrShare(blob, filename = "permuted.png") {
  // Revoke any previous URL
  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl);
    lastDownloadUrl = null;
  }

  const url = URL.createObjectURL(blob);
  lastDownloadUrl = url;

  setDownloadDisabled(false);

  // Desktop: normal download
  downloadLink.textContent = "Download result";
  downloadLink.onclick = null;
  downloadLink.href = url;
  downloadLink.download = filename;

  // Mobile: try Share Sheet so user can choose "Save Image"/"Save to Photos"
  if (isMobileDevice()) {
    const file = new File([blob], filename, { type: blob.type || "image/png" });

    const canShareFiles =
      typeof navigator.share === "function" &&
      (!navigator.canShare || navigator.canShare({ files: [file] }));

    if (canShareFiles) {
      downloadLink.textContent = "Save to Photos / Share";
      downloadLink.removeAttribute("download"); // don’t force downloads folder
      downloadLink.onclick = async (e) => {
        e.preventDefault();
        try {
          await navigator.share({
            files: [file],
            title: "Encrypted image",
            text: "Save this image to Photos",
          });
        } catch {
          // user canceled share sheet -> do nothing
        }
      };
      return;
    }

    // Fallback: open image in a new tab so user can long-press/share to save
    downloadLink.textContent = "Open image to save";
    downloadLink.removeAttribute("download");
    downloadLink.onclick = (e) => {
      e.preventDefault();
      window.open(url, "_blank");
    };
  }
}

function scaledDims(w, h, maxDim = 1280) {
  const maxSide = Math.max(w, h);
  if (maxSide <= maxDim) return { w, h, scaled: false };

  const scale = maxDim / maxSide;

  // Use floor so we never exceed maxDim due to rounding.
  const newW = Math.max(1, Math.floor(w * scale));
  const newH = Math.max(1, Math.floor(h * scale));

  return { w: newW, h: newH, scaled: true };
}

function setError(msg) {
  errorEl.textContent = msg || "";
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

fileInput.addEventListener("change", () => {
  setError("");
  setDownloadDisabled(true);
  processBtn.disabled = true;

  const f = fileInput.files && fileInput.files[0];
  if (!f) {
    loadedFile = null;
    return;
  }
  if (!f.type.startsWith("image/")) {
    setError("Please choose an image file.");
    loadedFile = null;
    return;
  }

  loadedFile = f;
  processBtn.disabled = false;
});

// Loads image into a bitmap with EXIF orientation when available
async function fileToImageBitmap(file) {
  // createImageBitmap supports orientation in most modern browsers
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Fallback: use <img>
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);

    // Draw to canvas then create bitmap
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return await createImageBitmap(c);
  }
}

processBtn.addEventListener("click", async () => {
  setError("");
  setDownloadDisabled(true);

  if (!loadedFile) return;

  // Clean up old download object URL
  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl);
    lastDownloadUrl = null;
  }

  try {
    const bmp = await fileToImageBitmap(loadedFile);

    const { w, h } = scaledDims(bmp.width, bmp.height, 1280);
    
    outCanvas.width = w;
    outCanvas.height = h;
    
    const ctx = outCanvas.getContext("2d", { willReadFrequently: true });
    
    // Optional, but improves downscale quality in most browsers
    ctx.imageSmoothingEnabled = true;
    try { ctx.imageSmoothingQuality = "high"; } catch {}
    
    // Draw scaled (or unchanged if already small enough)
    ctx.drawImage(bmp, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, outCanvas.width, outCanvas.height);
    const data = imgData.data; // Uint8ClampedArray: [R,G,B,A,...]

    // Apply permutation to R,G,B; leave A unchanged.
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = PERM[data[i]];     // R
      data[i + 1] = PERM[data[i + 1]]; // G
      data[i + 2] = PERM[data[i + 2]]; // B
    }

    ctx.putImageData(imgData, 0, 0);

    // Create downloadable file
    const blob = await new Promise((resolve) =>
      outCanvas.toBlob(resolve, "image/jpeg", 0.92) // quality: 0..1
    );

    if (!blob) throw new Error("Could not export image.");
    enableDownloadOrShare(blob, "encrypted.jpg");
  } catch (e) {
    setError(e?.message || String(e));
  }
});
