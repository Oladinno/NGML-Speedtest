"use client";

import { useEffect, useState } from "react";
import { DashboardData } from "@/types";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

function formatSpeed(mbps: number): string {
  if (mbps >= 1000) return (mbps / 1000).toFixed(2);
  if (mbps >= 10) return mbps.toFixed(1);
  return mbps.toFixed(2);
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function getAvatarColor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "from-slate-500 to-slate-600";
  const code = trimmed.charCodeAt(0) + (trimmed.charCodeAt(trimmed.length - 1) || 0);
  const colors = [
    "from-blue-500 to-indigo-600 shadow-[0_2px_8px_rgba(59,130,246,0.35)]",
    "from-purple-500 to-fuchsia-600 shadow-[0_2px_8px_rgba(168,85,247,0.35)]",
    "from-emerald-500 to-teal-600 shadow-[0_2px_8px_rgba(16,185,129,0.35)]",
    "from-amber-500 to-orange-600 shadow-[0_2px_8px_rgba(245,158,11,0.35)]",
    "from-rose-500 to-pink-600 shadow-[0_2px_8px_rgba(244,63,94,0.35)]",
    "from-cyan-500 to-blue-600 shadow-[0_2px_8px_rgba(6,182,212,0.35)]",
  ];
  return colors[code % colors.length];
}

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch("/api/sheets")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message || "Failed to load database payload");
        setLoading(false);
      });
  }, []);

  const handleExport = async () => {
    if (!data?.recentResults.length) return;
    setExporting(true);
    try {
      const headers = ["Timestamp","Download (Mbps)","Upload (Mbps)","Ping (ms)","Loaded (ms)","Unloaded (ms)","Jitter (ms)","Score","Status","Employee"];
      const rows = data.recentResults.map((r) => [r.timestamp, r.downloadMbps, r.uploadMbps, r.pingMs, r.loadedLatencyMs||0, r.unloadedLatencyMs||0, r.jitterMs||0, r.score||0, r.status||"", r.employeeName||""]);
      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `speedtest-log-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto w-full p-4 md:p-6 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-panel p-5 h-28 rounded-3xl border border-border-subtle" />
          ))}
        </div>
        <div className="glass-panel p-6 h-80 rounded-3xl border border-border-subtle" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full p-6 text-center">
        <div className="glass-panel p-12 rounded-3xl border border-border-subtle flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-status-danger/10 flex items-center justify-center mb-4 border border-status-danger/25">
            <svg className="w-6 h-6 text-status-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
            </svg>
          </div>
          <p className="text-base font-bold text-on-surface mb-1">Failed to Load Telemetry</p>
          <p className="text-xs text-on-surface-variant mb-6">{error}</p>
          <button onClick={() => window.location.reload()} className="h-11 px-6 bg-gradient-to-r from-secondary to-blue-600 text-white rounded-xl text-[12px] tracking-[0.06em] font-bold uppercase hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-secondary/20">
            TRY AGAIN
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.totalTests === 0) {
    return (
      <div className="max-w-6xl mx-auto w-full p-6 text-center">
        <div className="glass-panel p-16 rounded-3xl border border-border-subtle flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-secondary/10 border border-secondary/20 flex items-center justify-center mb-4 shadow-inner">
            <svg className="w-7 h-7 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-lg font-black text-on-surface mb-1.5">No Network Records</h3>
          <p className="text-xs text-on-surface-variant mb-8 max-w-sm">There are no latency and bandwidth tests logged in this enterprise. Start a speed test to compile data.</p>
          <a href="/" className="inline-flex items-center gap-2 h-11 px-6 bg-gradient-to-r from-secondary to-blue-600 text-white rounded-xl text-[12px] tracking-[0.06em] font-bold uppercase hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-secondary/20">
            START SPEED TEST
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full p-4 md:p-6 animate-fade-in relative z-10">
      
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Avg Download" value={`${formatSpeed(data.averageDownload)}`} unit="Mbps" accentColor="text-secondary" />
        <KpiCard label="Avg Upload" value={`${formatSpeed(data.averageUpload)}`} unit="Mbps" accentColor="text-purple-500" />
        <KpiCard label="Avg Ping" value={data.averagePing.toFixed(1)} unit="ms" accentColor="text-amber-500" />
        <KpiCard label="Tests Run" value={String(data.totalTests)} unit="records" accentColor="text-emerald-500" />
      </div>

      {/* Chart Section */}
      <div className="glass-panel p-5 md:p-6 rounded-3xl border border-border-subtle">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">Download Speed Progression</h3>
            <p className="text-[11px] text-on-surface-variant mt-0.5">Average bandwidth monitored daily across nodes</p>
          </div>
          <span className="text-[10px] text-secondary bg-secondary/10 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">
            Last {data.downloadHistory.length} Daily Samples
          </span>
        </div>
        
        <div className="w-full h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.downloadHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="dlGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--secondary)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--secondary)" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" strokeOpacity={0.3} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "var(--on-surface-variant)", fontSize: 10, fontWeight: 500 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "var(--on-surface-variant)", fontSize: 10, fontWeight: 500 }} tickLine={false} axisLine={false} unit=" Mbps" width={75} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="speed" stroke="var(--secondary)" strokeWidth={3} fill="url(#dlGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Tests Table Card */}
      <div className="glass-panel rounded-3xl border border-border-subtle overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-border-subtle bg-surface-container-lowest/20">
          <div>
            <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider">Network Log Records</h3>
            <p className="text-[11px] text-on-surface-variant mt-0.5">Latest logs from active corporate sessions</p>
          </div>
          <button 
            onClick={handleExport} 
            disabled={exporting} 
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-on-surface-variant border border-border-subtle hover:text-on-surface hover:bg-surface-container-low/40 rounded-xl transition-all duration-300 bg-surface-container-lowest/30"
          >
            <svg className="w-3.5 h-3.5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting ? "EXPORTING..." : "EXPORT CSV LOG"}
          </button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] text-on-surface-variant uppercase tracking-wider bg-surface-container-low/30 border-b border-border-subtle font-black">
                <th className="text-left font-bold px-6 py-3.5">Client ID</th>
                <th className="text-right font-bold px-6 py-3.5">Download</th>
                <th className="text-right font-bold px-6 py-3.5">Upload</th>
                <th className="text-right font-bold px-6 py-3.5">Ping</th>
                <th className="text-right font-bold px-6 py-3.5">Jitter</th>
                <th className="text-right font-bold px-6 py-3.5">Score</th>
                <th className="text-right font-bold px-6 py-3.5">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/50">
              {data.recentResults.slice(0, 15).map((r, i) => {
                const clientName = r.employeeName || "Anonymous Node";
                const isAnonymous = clientName === "Anonymous Node" || clientName === "Anonymous";
                const initials = isAnonymous ? "AN" : clientName.split(" ").map(n => n.charAt(0)).join("").toUpperCase().slice(0, 2);
                
                return (
                  <tr key={r.id || i} className="hover:bg-surface-container-low/10 transition-colors group">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${getAvatarColor(clientName)} flex items-center justify-center text-[10px] font-black text-white shrink-0`}>
                          {initials}
                        </div>
                        <span className="font-semibold text-on-surface group-hover:text-secondary transition-colors truncate max-w-[160px]">{clientName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-right tabular-nums">
                      <span className="font-extrabold text-secondary">{r.downloadMbps.toFixed(1)}</span>
                      <span className="text-on-surface-variant text-[10px] ml-1 font-bold">Mbps</span>
                    </td>
                    <td className="px-6 py-3.5 text-right tabular-nums">
                      <span className="font-semibold text-purple-400">{r.uploadMbps.toFixed(1)}</span>
                      <span className="text-on-surface-variant text-[10px] ml-1 font-bold">Mbps</span>
                    </td>
                    <td className="px-6 py-3.5 text-right tabular-nums text-on-surface-variant font-medium">{r.pingMs.toFixed(0)} ms</td>
                    <td className="px-6 py-3.5 text-right tabular-nums text-on-surface-variant font-medium">{(r.jitterMs || 0).toFixed(1)} ms</td>
                    <td className="px-6 py-3.5 text-right"><ScoreBadge score={r.score || 0} status={r.status} /></td>
                    <td className="px-6 py-3.5 text-right text-on-surface-variant text-xs font-medium">{timeAgo(r.timestamp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, unit, accentColor }: { label: string; value: string; unit: string; accentColor: string }) {
  return (
    <div className="glass-panel glass-panel-hover p-5 rounded-3xl border border-border-subtle flex flex-col relative overflow-hidden group">
      {/* Decorative colored glow on top of card */}
      <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-current to-transparent opacity-30 ${accentColor}`} />
      
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-1.5 h-3.5 rounded-full bg-current ${accentColor}`} />
        <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">{label}</div>
      </div>
      
      <div className="flex items-baseline gap-1.5 mt-auto">
        <span className={`text-2xl md:text-3xl font-black tracking-tight tabular-nums ${accentColor}`}>{value}</span>
        <span className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">{unit}</span>
      </div>
    </div>
  );
}

function ScoreBadge({ score, status }: { score: number; status?: string }) {
  const colors: Record<string, string> = {
    good: "bg-status-success/15 text-status-success ring-status-success/30",
    average: "bg-status-warning/15 text-status-warning ring-status-warning/30",
    poor: "bg-status-danger/15 text-status-danger ring-status-danger/30",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black ring-1 ${colors[status || "average"]}`}>
      {score}
    </span>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-container-lowest/90 border border-secondary/20 rounded-2xl px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md">
      <div className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-base font-black tabular-nums text-secondary">
        {payload[0].value.toFixed(1)} <span className="text-[10px] font-bold text-on-surface-variant">Mbps</span>
      </div>
    </div>
  );
}
