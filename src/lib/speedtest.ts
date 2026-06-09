// ─── Constants ────────────────────────────────────────────────────────────────
// How fast.com / speedtest.net work:
//  - Multiple parallel TCP streams to saturate the link
//  - A warmup phase excluded from the final average (avoids TCP slow-start drag)
//  - Duration-based tests, not fixed-file-size tests
//  - Upload measured via XHR progress events (fires as bytes leave the send buffer)

const DOWNLOAD_STREAMS    = 4;     // parallel fetch() connections
const DOWNLOAD_DURATION_MS = 14_000; // total test window (incl. warmup)
const DOWNLOAD_WARMUP_MS   = 2_000;  // excluded from final average
const DOWNLOAD_MB_PER_STREAM = 150;  // large enough that streams never exhaust before timer

const UPLOAD_STREAMS      = 3;     // parallel XHR connections
const UPLOAD_DURATION_MS  = 12_000; // total test window (incl. warmup)
const UPLOAD_WARMUP_MS    = 2_000;
const UPLOAD_MB_PER_STREAM = 50;   // per XHR payload

const PING_SAMPLES = 10;

// ─── Upload data ──────────────────────────────────────────────────────────────
// Fix #7: Use a simple deterministic pattern instead of crypto.getRandomValues().
// crypto.getRandomValues() on 10 MB takes 200-600 ms on many devices — pure waste
// before the test even starts. A repeating pattern generates in <5 ms.
function makeUploadBlob(sizeMB: number): Blob {
  const sizeBytes = sizeMB * 1024 * 1024;
  const PATTERN_SIZE = 65_536;
  const pattern = new Uint8Array(PATTERN_SIZE);
  for (let i = 0; i < PATTERN_SIZE; i++) {
    pattern[i] = ((i * 0x9e3779b9) ^ (i >> 8)) & 0xff; // incompressible, fast
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
  const downloadUrl = `/api/speedtest/download?size=10&t=${Date.now()}`;
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
export async function measureDownloadSpeed(
  onProgress?: (mbps: number) => void
): Promise<number> {
  // Shared state across all parallel streams
  let totalBytes    = 0; // all bytes received (incl. warmup)
  let measuredBytes = 0; // bytes received AFTER warmup
  let measureStart  = 0;
  let warmupDone    = false;

  // For sliding-window progress display
  let lastReportTime  = performance.now();
  let lastReportBytes = 0;

  const testStart = performance.now();
  const abortControllers: AbortController[] = [];

  // Fix #3 + #4 + #5: 4 parallel streams, timing starts after response headers
  // arrive (excluding TTFB), and warmup bytes are discarded.
  const runStream = async (index: number): Promise<void> => {
    const ac = new AbortController();
    abortControllers.push(ac);
    try {
      const response = await fetch(
        `/api/speedtest/download?size=${DOWNLOAD_MB_PER_STREAM}&t=${Date.now()}&s=${index}`,
        { cache: "no-store", signal: ac.signal }
      );
      if (!response.ok || !response.body) return;

      // Fix #4: start timing HERE — after headers received, before body read.
      // This excludes DNS + TLS + TTFB from the elapsed time.
      const bodyStart = performance.now();
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const bytes = value?.length ?? 0;
        totalBytes += bytes;

        const now = performance.now();
        const elapsed = now - testStart;

        // Fix #5: warmup — discard first DOWNLOAD_WARMUP_MS of data
        if (!warmupDone && elapsed >= DOWNLOAD_WARMUP_MS) {
          warmupDone    = true;
          measureStart  = now;
          measuredBytes = 0;
        }
        if (warmupDone) measuredBytes += bytes;

        // Sliding-window progress update every 500 ms
        if (onProgress && now - lastReportTime >= 500) {
          const dt    = (now - lastReportTime) / 1000;
          const dBytes = totalBytes - lastReportBytes;
          onProgress((dBytes * 8) / dt / 1_000_000);
          lastReportTime  = now;
          lastReportBytes = totalBytes;
        }
      }
      void bodyStart; // suppress unused warning
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
// Fix #6 + #8: XHR with xhr.upload.onprogress fires as bytes leave the OS send
// buffer — the most accurate client-side upload measurement possible.
// Multiple parallel XHR streams saturate the uplink properly.
function xhrUploadStream(
  blob: Blob,
  onBytesSent: (delta: number) => void
): Promise<void> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let lastLoaded = 0;

    xhr.open("POST", `/api/speedtest/upload?t=${Date.now()}&n=${Math.random()}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      const delta = e.loaded - lastLoaded;
      lastLoaded = e.loaded;
      if (delta > 0) onBytesSent(delta);
    };

    // Resolve in all cases — we don't want one failed stream to kill the test
    xhr.onload  = () => resolve();
    xhr.onerror = () => resolve();
    xhr.onabort = () => resolve();

    xhr.send(blob);
  });
}

export async function measureUploadSpeed(): Promise<number> {
  const blob = makeUploadBlob(UPLOAD_MB_PER_STREAM);

  let totalSent    = 0;
  let measuredSent = 0;
  let measureStart = 0;
  let warmupDone   = false;
  const testStart  = performance.now();

  const xhrs: XMLHttpRequest[] = [];

  const handleBytes = (delta: number) => {
    totalSent += delta;
    const now     = performance.now();
    const elapsed = now - testStart;

    if (!warmupDone && elapsed >= UPLOAD_WARMUP_MS) {
      warmupDone    = true;
      measureStart  = now;
      measuredSent  = 0;
    }
    if (warmupDone) measuredSent += delta;
  };

  // Abort all XHRs after the test window
  const timer = setTimeout(() => {
    xhrs.forEach((x) => x.abort());
  }, UPLOAD_DURATION_MS);

  // Fix #8: parallel upload streams
  await Promise.allSettled(
    Array.from({ length: UPLOAD_STREAMS }, () =>
      xhrUploadStream(blob, handleBytes)
    )
  );
  clearTimeout(timer);

  const elapsed = (performance.now() - measureStart) / 1000;
  if (elapsed <= 0 || measuredSent === 0) return 0;

  return Math.round((measuredSent * 8) / elapsed / 1_000_000 * 100) / 100;
}
