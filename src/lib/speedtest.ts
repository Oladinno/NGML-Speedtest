const DOWNLOAD_SIZE_MB = 25;
const UPLOAD_SIZE_MB = 10;
const PING_SAMPLES = 8;

function generateRandomData(sizeMB: number): Blob {
  const sizeBytes = sizeMB * 1024 * 1024;
  const chunkSize = 65536;
  const chunks: BlobPart[] = [];
  let remaining = sizeBytes;

  while (remaining > 0) {
    const len = Math.min(chunkSize, remaining);
    const buf = new ArrayBuffer(len);
    crypto.getRandomValues(new Uint8Array(buf));
    chunks.push(buf);
    remaining -= len;
  }

  return new Blob(chunks);
}

async function pingOnce(signal?: AbortSignal): Promise<number> {
  const start = performance.now();
  await fetch(`/api/speedtest/ping?t=${Date.now()}&n=${Math.random()}`, {
    cache: "no-store",
    signal,
  });
  return performance.now() - start;
}

export interface PingResult {
  unloaded: number;
  jitter: number;
}

export interface LatencyResult {
  loaded: number;
  unloaded: number;
  jitter: number;
}

export async function measurePing(): Promise<PingResult> {
  const samples: number[] = [];

  for (let i = 0; i < PING_SAMPLES; i++) {
    const rtt = await pingOnce();
    samples.push(rtt);
    await new Promise((r) => setTimeout(r, 100));
  }

  samples.sort((a, b) => a - b);
  const trimmed = samples.slice(1, -1);
  const unloaded = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance =
    samples.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / samples.length;
  const jitter = Math.sqrt(variance);

  return {
    unloaded: Math.round(unloaded * 10) / 10,
    jitter: Math.round(jitter * 10) / 10,
  };
}

export async function measureLoadedLatency(): Promise<number> {
  const downloadUrl = `/api/speedtest/download?size=10&t=${Date.now()}`;
  const samples: number[] = [];

  const downloadPromise = fetch(downloadUrl).then(async (r) => {
    if (!r.body) return;
    const reader = r.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  });

  for (let i = 0; i < 6; i++) {
    const rtt = await pingOnce();
    samples.push(rtt);
    await new Promise((r) => setTimeout(r, 200));
  }

  await downloadPromise;

  samples.sort((a, b) => a - b);
  const trimmed = samples.slice(1, -1);
  return Math.round((trimmed.reduce((a, b) => a + b, 0) / trimmed.length) * 10) / 10;
}

export async function measureDownloadSpeed(
  onProgress?: (mbps: number) => void
): Promise<number> {
  const downloadUrl = `/api/speedtest/download?size=${DOWNLOAD_SIZE_MB}&t=${Date.now()}`;

  const startTime = performance.now();
  const response = await fetch(downloadUrl);

  if (!response.ok) throw new Error("Download test failed");
  if (!response.body) throw new Error("No response body");

  const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
  const reader = response.body.getReader();
  let receivedBytes = 0;
  let lastCheck = startTime;
  let lastBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value?.length || 0;

    const now = performance.now();
    if (now - lastCheck > 400) {
      const elapsed = (now - lastCheck) / 1000;
      const bits = (receivedBytes - lastBytes) * 8;
      const mbps = bits / elapsed / 1_000_000;
      onProgress?.(mbps);
      lastCheck = now;
      lastBytes = receivedBytes;
    }
  }

  const endTime = performance.now();
  const elapsedSeconds = (endTime - startTime) / 1000;
  const bits = (contentLength || receivedBytes) * 8;
  const mbps = bits / elapsedSeconds / 1_000_000;

  return Math.round(mbps * 100) / 100;
}

export async function measureUploadSpeed(): Promise<number> {
  const data = generateRandomData(UPLOAD_SIZE_MB);
  const uploadUrl = `/api/speedtest/upload?t=${Date.now()}`;

  const startTime = performance.now();
  const response = await fetch(uploadUrl, {
    method: "POST",
    body: data,
    headers: { "Content-Type": "application/octet-stream" },
  });
  const endTime = performance.now();

  if (!response.ok) throw new Error("Upload test failed");

  const elapsedSeconds = (endTime - startTime) / 1000;
  const bits = data.size * 8;
  const mbps = bits / elapsedSeconds / 1_000_000;

  return Math.round(mbps * 100) / 100;
}
