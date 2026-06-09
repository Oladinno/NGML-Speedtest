import { neon } from "@neondatabase/serverless";
import { SpeedTestResult, DashboardData } from "@/types";

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is not set");
  return neon(url);
}

export async function initDatabase(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS speedtest_results (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      download_mbps DOUBLE PRECISION NOT NULL,
      upload_mbps DOUBLE PRECISION NOT NULL,
      ping_ms DOUBLE PRECISION NOT NULL,
      loaded_latency_ms DOUBLE PRECISION DEFAULT 0,
      unloaded_latency_ms DOUBLE PRECISION DEFAULT 0,
      jitter_ms DOUBLE PRECISION DEFAULT 0,
      score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'average',
      employee_name TEXT DEFAULT ''
    );
  `;
  // Add metadata columns if they do not exist
  await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS client_ip TEXT DEFAULT ''`;
  await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS client_city TEXT DEFAULT ''`;
  await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS client_region TEXT DEFAULT ''`;
  await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS client_country TEXT DEFAULT ''`;
  await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS as_owner TEXT DEFAULT ''`;
  await sql`ALTER TABLE speedtest_results ADD COLUMN IF NOT EXISTS edge_id TEXT DEFAULT ''`;
}

export async function saveResult(result: SpeedTestResult): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO speedtest_results (
      timestamp, download_mbps, upload_mbps, ping_ms,
      loaded_latency_ms, unloaded_latency_ms, jitter_ms,
      score, status, employee_name,
      client_ip, client_city, client_region, client_country,
      as_owner, edge_id
    )
    VALUES (
      ${result.timestamp},
      ${result.downloadMbps},
      ${result.uploadMbps},
      ${result.pingMs},
      ${result.loadedLatencyMs || 0},
      ${result.unloadedLatencyMs || 0},
      ${result.jitterMs || 0},
      ${result.score || 0},
      ${result.status || "average"},
      ${result.employeeName || ""},
      ${result.clientIp || ""},
      ${result.clientCity || ""},
      ${result.clientRegion || ""},
      ${result.clientCountry || ""},
      ${result.asOwner || ""},
      ${result.edgeId || ""}
    )
  `;
}

export async function getResults(): Promise<SpeedTestResult[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM speedtest_results ORDER BY timestamp DESC LIMIT 100
  `;

  return rows.map((row: any) => ({
    id: String(row.id),
    timestamp:
      row.timestamp instanceof Date
        ? row.timestamp.toISOString()
        : String(row.timestamp),
    downloadMbps: Number(row.download_mbps),
    uploadMbps: Number(row.upload_mbps),
    pingMs: Number(row.ping_ms),
    loadedLatencyMs: Number(row.loaded_latency_ms || 0),
    unloadedLatencyMs: Number(row.unloaded_latency_ms || 0),
    jitterMs: Number(row.jitter_ms || 0),
    score: Number(row.score || 0),
    status: row.status || "average",
    employeeName: row.employee_name || "",
    clientIp: row.client_ip || "",
    clientCity: row.client_city || "",
    clientRegion: row.client_region || "",
    clientCountry: row.client_country || "",
    asOwner: row.as_owner || "",
    edgeId: row.edge_id || "",
  }));
}

export async function getDashboardData(): Promise<DashboardData> {
  const results = await getResults();

  if (results.length === 0) {
    return {
      averageDownload: 0,
      averageUpload: 0,
      averagePing: 0,
      averageJitter: 0,
      totalTests: 0,
      recentResults: [],
      downloadHistory: [],
    };
  }

  const totalDownload = results.reduce((sum, r) => sum + r.downloadMbps, 0);
  const totalUpload = results.reduce((sum, r) => sum + r.uploadMbps, 0);
  const totalPing = results.reduce((sum, r) => sum + r.pingMs, 0);
  const totalJitter = results.reduce((sum, r) => sum + (r.jitterMs || 0), 0);
  const count = results.length;

  const sorted = [...results].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const historyMap = new Map<string, number[]>();
  sorted.forEach((r) => {
    const date = r.timestamp.split("T")[0];
    if (!historyMap.has(date)) historyMap.set(date, []);
    historyMap.get(date)!.push(r.downloadMbps);
  });

  const downloadHistory = Array.from(historyMap.entries())
    .map(([date, speeds]) => ({
      date,
      speed:
        Math.round(
          (speeds.reduce((a, b) => a + b, 0) / speeds.length) * 100
        ) / 100,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    averageDownload: Math.round((totalDownload / count) * 100) / 100,
    averageUpload: Math.round((totalUpload / count) * 100) / 100,
    averagePing: Math.round((totalPing / count) * 100) / 100,
    averageJitter: Math.round((totalJitter / count) * 100) / 100,
    totalTests: count,
    recentResults: sorted.slice(0, 20),
    downloadHistory,
  };
}
