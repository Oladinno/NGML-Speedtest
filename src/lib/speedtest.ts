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

// ─── Connection Meta Interface ────────────────────────────────────────────────
export interface ConnectionMeta {
  clientIp?: string;
  clientCity?: string;
  clientRegion?: string;
  clientCountry?: string;
  asOwner?: string;
  edgeId?: string;
}

// ─── Ping helpers ─────────────────────────────────────────────────────────────
async function pingOnce(signal?: AbortSignal): Promise<{ duration: number; meta?: ConnectionMeta }> {
  const start = performance.now();
  const response = await fetch(`/api/speedtest/ping?t=${Date.now()}&n=${Math.random()}`, {
    cache: "no-store",
    signal,
  });
  const duration = performance.now() - start;

  // Retrieve geo/infra headers set by our Vercel-facing 204 handler
  const clientIp = response.headers.get("x-client-ip") || undefined;
  const cityHeader = response.headers.get("x-client-city");
  const clientCity = cityHeader ? decodeURIComponent(cityHeader) : undefined;
  const clientRegion = response.headers.get("x-client-region") || undefined;
  const clientCountry = response.headers.get("x-client-country") || undefined;
  const asHeader = response.headers.get("x-as-owner");
  const asOwner = asHeader ? decodeURIComponent(asHeader) : undefined;
  const edgeId = response.headers.get("x-edge-id") || undefined;

  return {
    duration,
    meta: {
      clientIp,
      clientCity,
      clientRegion,
      clientCountry,
      asOwner,
      edgeId,
    }
  };
}

export interface PingResult {
  unloaded: number;
  jitter: number;
  meta?: ConnectionMeta;
}
export interface LatencyResult { loaded: number; unloaded: number; jitter: number; }

export async function measurePing(): Promise<PingResult> {
  const samples: number[] = [];
  let connectionMeta: ConnectionMeta | undefined;

  for (let i = 0; i < PING_SAMPLES; i++) {
    const res = await pingOnce();
    samples.push(res.duration);
    // Collect metadata from the first response headers
    if (i === 0 && res.meta) {
      connectionMeta = res.meta;
    }
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
    meta:     connectionMeta,
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
    const res = await pingOnce();
    samples.push(res.duration);
    await new Promise((r) => setTimeout(r, 200));
  }
  await downloadPromise;
  samples.sort((a, b) => a - b);
  const trimmed = samples.slice(1, -1);
  return Math.round((trimmed.reduce((a, b) => a + b, 0) / trimmed.length) * 10) / 10;
}

// ─── Download speed ───────────────────────────────────────────────────────────
// Industry-standard multi-request loop with Adaptive Warmup Filter:
//   Discards the first 2 completed chunks per stream to let the TCP slow-start
//   window open fully. The moment a stream enters its 3rd chunk, we set
//   measureStart and begin accumulating measuredBytes.
export async function measureDownloadSpeed(
  onProgress?: (mbps: number) => void
): Promise<number> {
  let totalBytes    = 0;
  let measuredBytes = 0;
  let measureStart  = 0;

  // Track completed chunks per stream
  const streamCompletedChunks = new Array(DOWNLOAD_STREAMS).fill(0);

  // Sliding-window progress display
  let lastReportTime  = performance.now();
  let lastReportBytes = 0;

  const testStart = performance.now();
  const abortControllers: AbortController[] = [];

  const runStream = async (index: number): Promise<void> => {
    const ac = new AbortController();
    abortControllers.push(ac);

    try {
      while (!ac.signal.aborted) {
        let response: Response;
        try {
          response = await fetch(
            `/api/speedtest/download?size=${DOWNLOAD_CHUNK_MB}&t=${Date.now()}&s=${index}`,
            { cache: "no-store", signal: ac.signal }
          );
        } catch (e) {
          if ((e as Error).name === "AbortError") break;
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        if (!response.ok || !response.body) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        // Determine if this chunk is still part of the warmup for this stream
        const isWarmup = streamCompletedChunks[index] < 2;

        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const bytes = value?.length ?? 0;
            totalBytes += bytes;

            const now = performance.now();

            if (!isWarmup) {
              // Start counting time from the first non-warmup byte
              if (measureStart === 0) {
                measureStart = now;
              }
              measuredBytes += bytes;
            }

            // Sliding-window progress update every 500ms
            if (onProgress && now - lastReportTime >= 500) {
              const dt     = (now - lastReportTime) / 1000;
              const dBytes = totalBytes - lastReportBytes;
              onProgress((dBytes * 8) / dt / 1_000_000);
              lastReportTime  = now;
              lastReportBytes = totalBytes;
            }
          }
          // Increment completed chunk count for this stream
          streamCompletedChunks[index]++;
        } catch (e) {
          if ((e as Error).name === "AbortError") break;
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") console.warn(`DL stream ${index}:`, e);
    }
  };

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
// Industry-standard multi-request loop with Adaptive Warmup Filter:
//   Discards the first 2 completed upload chunks per stream from speed calculations.
function xhrUploadStream(
  blob: Blob,
  onBytesSent: (delta: number, isWarmup: boolean) => void,
  onChunkComplete: () => void,
  isWarmupFn: () => boolean,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }

    const xhr = new XMLHttpRequest();
    let lastLoaded = 0;

    const onAbort = () => { xhr.abort(); };
    signal.addEventListener("abort", onAbort, { once: true });

    xhr.open("POST", `/api/speedtest/upload?t=${Date.now()}&n=${Math.random()}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (signal.aborted) return;
      const delta = e.loaded - lastLoaded;
      lastLoaded  = e.loaded;
      if (delta > 0) {
        onBytesSent(delta, isWarmupFn());
      }
    };

    xhr.onload = () => {
      signal.removeEventListener("abort", onAbort);
      onChunkComplete();
      if (!signal.aborted) {
        xhrUploadStream(blob, onBytesSent, onChunkComplete, isWarmupFn, signal).then(resolve);
      } else {
        resolve();
      }
    };

    xhr.onerror = () => { signal.removeEventListener("abort", onAbort); resolve(); };
    xhr.onabort = () => { signal.removeEventListener("abort", onAbort); resolve(); };

    xhr.send(blob);
  });
}

export async function measureUploadSpeed(): Promise<number> {
  const blob = makeUploadBlob(UPLOAD_CHUNK_MB);

  let totalSent    = 0;
  let measuredSent = 0;
  let measureStart = 0;

  // Track completed chunks per stream
  const streamCompletedChunks = new Array(UPLOAD_STREAMS).fill(0);

  const handleBytes = (delta: number, isWarmup: boolean) => {
    totalSent += delta;
    if (!isWarmup) {
      if (measureStart === 0) {
        measureStart = performance.now();
      }
      measuredSent += delta;
    }
  };

  const acs = Array.from({ length: UPLOAD_STREAMS }, () => new AbortController());

  const timer = setTimeout(
    () => acs.forEach((ac) => ac.abort()),
    UPLOAD_DURATION_MS
  );

  await Promise.allSettled(
    acs.map((ac, index) =>
      xhrUploadStream(
        blob,
        handleBytes,
        () => {
          streamCompletedChunks[index]++;
        },
        () => streamCompletedChunks[index] < 2,
        ac.signal
      )
    )
  );
  clearTimeout(timer);

  const elapsed = (performance.now() - measureStart) / 1000;
  if (elapsed <= 0 || measuredSent === 0) return 0;

  return Math.round((measuredSent * 8) / elapsed / 1_000_000 * 100) / 100;
}
