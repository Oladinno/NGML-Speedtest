// ─── Industry-Standard Speed Test Architecture ────────────────────────────────
//
// How fast.com / Cloudflare Speed Test / Speedtest.net work:
//  - Multiple parallel TCP streams to saturate the link
//  - Each stream makes REPEATED small requests (not one giant long-lived request)
//  - A warmup phase excluded from the final average (avoids TCP slow-start drag)
//  - Duration-based tests, not fixed-file-size tests
//  - Upload measured via XHR progress events (fires as bytes leave the OS send buffer)
//
// Why repeated small requests?
//  - Works on any platform: serverless (Vercel, AWS Lambda, Render), containers, VMs
//  - Keeps each HTTP transaction small (~4–8 MB) — no platform memory/timeout caps hit
//  - The client controls the test window; the server is a simple stateless byte-pump
//  - Proper TCP stream reuse via HTTP/2 multiplexing (browsers do this automatically)

const DOWNLOAD_STREAMS     = 4;       // parallel fetch() connections
const DOWNLOAD_DURATION_MS = 14_000;  // total test window (incl. warmup)
const DOWNLOAD_WARMUP_MS   = 2_000;   // excluded from final average
const DOWNLOAD_CHUNK_MB    = 4;       // bytes per individual request (~4 MB)

const UPLOAD_STREAMS       = 3;       // parallel XHR connections
const UPLOAD_DURATION_MS   = 12_000;  // total test window (incl. warmup)
const UPLOAD_WARMUP_MS     = 2_000;
const UPLOAD_CHUNK_MB      = 4;       // bytes per individual upload request (~4 MB)

const PING_SAMPLES = 10;

// ─── Upload data ──────────────────────────────────────────────────────────────
// Use a deterministic incompressible pattern instead of crypto.getRandomValues().
// crypto.getRandomValues() on large buffers is CPU-intensive (200–600ms on slow
// devices). A repeating bit-mixed pattern generates in <5ms and is incompressible.
function makeUploadBlob(sizeMB: number): Blob {
  const sizeBytes = sizeMB * 1024 * 1024;
  const PATTERN_SIZE = 65_536;
  const pattern = new Uint8Array(PATTERN_SIZE);
  for (let i = 0; i < PATTERN_SIZE; i++) {
    pattern[i] = ((i * 0x9e3779b9) ^ (i >> 8)) & 0xff;
  }
  const chunks: BlobPart[] = [];
  let remaining = sizeBytes;
  while (remaining > 0) {
    chunks.push(pattern.subarray(0, Math.min(PATTERN_SIZE, remaining)));
    remaining -= PATTERN_SIZE;
  }
  return new Blob(chunks, { type: "application/octet-stream" });
}

// ─── Ping helpers ─────────────────────────────────────────────────────────────
async function pingOnce(signal?: AbortSignal): Promise<number> {
  const start = performance.now();
  await fetch(`/api/speedtest/ping?t=${Date.now()}&n=${Math.random()}`, {
    cache: "no-store",
    signal,
  });
  return performance.now() - start;
}

export interface PingResult { unloaded: number; jitter: number; }
export interface LatencyResult { loaded: number; unloaded: number; jitter: number; }

export async function measurePing(): Promise<PingResult> {
  const samples: number[] = [];
  for (let i = 0; i < PING_SAMPLES; i++) {
    samples.push(await pingOnce());
    await new Promise((r) => setTimeout(r, 80));
  }
  samples.sort((a, b) => a - b);
  // Trim top and bottom 2 outliers for robustness
  const trimmed = samples.slice(2, -2);
  const mean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const variance = trimmed.reduce((s, v) => s + (v - mean) ** 2, 0) / trimmed.length;
  return {
    unloaded: Math.round(mean * 10) / 10,
    jitter:   Math.round(Math.sqrt(variance) * 10) / 10,
  };
}

export async function measureLoadedLatency(): Promise<number> {
  const downloadUrl = `/api/speedtest/download?size=4&t=${Date.now()}`;
  const samples: number[] = [];
  const downloadPromise = fetch(downloadUrl).then(async (r) => {
    if (!r.body) return;
    const reader = r.body.getReader();
    while (!(await reader.read()).done) { /* drain */ }
  });
  for (let i = 0; i < 6; i++) {
    samples.push(await pingOnce());
    await new Promise((r) => setTimeout(r, 200));
  }
  await downloadPromise;
  samples.sort((a, b) => a - b);
  const trimmed = samples.slice(1, -1);
  return Math.round((trimmed.reduce((a, b) => a + b, 0) / trimmed.length) * 10) / 10;
}

// ─── Download speed ───────────────────────────────────────────────────────────
// Industry-standard multi-request loop:
//   Each stream fires small (~4MB) fetch requests back-to-back until the timer
//   fires. The server is a stateless byte-pump — no long-lived connection needed.
//   This works identically on Vercel, Railway, Render, AWS Lambda, or bare Node.js.
export async function measureDownloadSpeed(
  onProgress?: (mbps: number) => void
): Promise<number> {
  let totalBytes    = 0; // all bytes received (incl. warmup)
  let measuredBytes = 0; // bytes received AFTER warmup
  let measureStart  = 0;
  let warmupDone    = false;

  // Sliding-window progress display
  let lastReportTime  = performance.now();
  let lastReportBytes = 0;

  const testStart = performance.now();
  // One AbortController per stream; the timer fires abort() after the window
  const abortControllers: AbortController[] = [];

  const runStream = async (index: number): Promise<void> => {
    const ac = new AbortController();
    abortControllers.push(ac);

    try {
      // Keep firing requests until the test window timer aborts us
      while (!ac.signal.aborted) {
        let response: Response;
        try {
          response = await fetch(
            `/api/speedtest/download?size=${DOWNLOAD_CHUNK_MB}&t=${Date.now()}&s=${index}`,
            { cache: "no-store", signal: ac.signal }
          );
        } catch (e) {
          if ((e as Error).name === "AbortError") break;
          // Brief pause before retrying on transient network error
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        if (!response.ok || !response.body) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const bytes = value?.length ?? 0;
            totalBytes += bytes;

            const now     = performance.now();
            const elapsed = now - testStart;

            // Discard warmup bytes
            if (!warmupDone && elapsed >= DOWNLOAD_WARMUP_MS) {
              warmupDone    = true;
              measureStart  = now;
              measuredBytes = 0;
            }
            if (warmupDone) measuredBytes += bytes;

            // Sliding-window progress update every 500ms
            if (onProgress && now - lastReportTime >= 500) {
              const dt     = (now - lastReportTime) / 1000;
              const dBytes = totalBytes - lastReportBytes;
              onProgress((dBytes * 8) / dt / 1_000_000);
              lastReportTime  = now;
              lastReportBytes = totalBytes;
            }
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") break;
          // Stream cancelled by abort — outer loop will exit on next check
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") console.warn(`DL stream ${index}:`, e);
    }
  };

  // Auto-abort all streams after the test window
  const timer = setTimeout(
    () => abortControllers.forEach((ac) => ac.abort()),
    DOWNLOAD_DURATION_MS
  );

  await Promise.allSettled(
    Array.from({ length: DOWNLOAD_STREAMS }, (_, i) => runStream(i))
  );
  clearTimeout(timer);

  const elapsed = (performance.now() - measureStart) / 1000;
  if (elapsed <= 0 || measuredBytes === 0) return 0;

  return Math.round((measuredBytes * 8) / elapsed / 1_000_000 * 100) / 100;
}

// ─── Upload speed ─────────────────────────────────────────────────────────────
// Industry-standard multi-request loop:
//   Each XHR stream fires small (~4MB) upload requests back-to-back until the
//   AbortSignal fires. xhr.upload.onprogress fires as bytes leave the OS send
//   buffer — the most accurate client-side upload measurement possible.
function xhrUploadStream(
  blob: Blob,
  onBytesSent: (delta: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }

    const xhr = new XMLHttpRequest();
    let lastLoaded = 0;

    // When the signal fires, abort the current XHR and stop looping
    const onAbort = () => { xhr.abort(); };
    signal.addEventListener("abort", onAbort, { once: true });

    xhr.open("POST", `/api/speedtest/upload?t=${Date.now()}&n=${Math.random()}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (signal.aborted) return;
      const delta = e.loaded - lastLoaded;
      lastLoaded  = e.loaded;
      if (delta > 0) onBytesSent(delta);
    };

    xhr.onload = () => {
      signal.removeEventListener("abort", onAbort);
      // Immediately start next upload unless we've been aborted
      if (!signal.aborted) {
        xhrUploadStream(blob, onBytesSent, signal).then(resolve);
      } else {
        resolve();
      }
    };

    // Resolve (don't reject) on error/abort — one failed stream shouldn't kill the test
    xhr.onerror = () => { signal.removeEventListener("abort", onAbort); resolve(); };
    xhr.onabort = () => { signal.removeEventListener("abort", onAbort); resolve(); };

    xhr.send(blob);
  });
}

export async function measureUploadSpeed(): Promise<number> {
  // Pre-build one blob — reused by all streams (no extra allocations)
  const blob = makeUploadBlob(UPLOAD_CHUNK_MB);

  let totalSent    = 0;
  let measuredSent = 0;
  let measureStart = 0;
  let warmupDone   = false;
  const testStart  = performance.now();

  const handleBytes = (delta: number) => {
    totalSent += delta;
    const now     = performance.now();
    const elapsed = now - testStart;

    if (!warmupDone && elapsed >= UPLOAD_WARMUP_MS) {
      warmupDone   = true;
      measureStart = now;
      measuredSent = 0;
    }
    if (warmupDone) measuredSent += delta;
  };

  // One AbortController per stream
  const acs = Array.from({ length: UPLOAD_STREAMS }, () => new AbortController());

  // Abort all streams after the test window
  const timer = setTimeout(
    () => acs.forEach((ac) => ac.abort()),
    UPLOAD_DURATION_MS
  );

  await Promise.allSettled(
    acs.map((ac) => xhrUploadStream(blob, handleBytes, ac.signal))
  );
  clearTimeout(timer);

  const elapsed = (performance.now() - measureStart) / 1000;
  if (elapsed <= 0 || measuredSent === 0) return 0;

  return Math.round((measuredSent * 8) / elapsed / 1_000_000 * 100) / 100;
}
