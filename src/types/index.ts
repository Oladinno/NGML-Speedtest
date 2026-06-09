export interface SpeedTestResult {
  id?: string;
  timestamp: string;
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  loadedLatencyMs?: number;
  unloadedLatencyMs?: number;
  jitterMs?: number;
  score?: number;
  status?: "good" | "average" | "poor";
  employeeName?: string;
}

export interface SpeedTestState {
  status:
    | "idle"
    | "testing-download"
    | "testing-upload"
    | "testing-ping"
    | "testing-loaded-latency"
    | "complete"
    | "error";
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  loadedLatencyMs: number;
  unloadedLatencyMs: number;
  jitterMs: number;
  progress: number;
  error?: string;
}

export interface DashboardData {
  averageDownload: number;
  averageUpload: number;
  averagePing: number;
  averageJitter: number;
  totalTests: number;
  recentResults: SpeedTestResult[];
  downloadHistory: { date: string; speed: number }[];
}
