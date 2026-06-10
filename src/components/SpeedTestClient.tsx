"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { SpeedTestState } from "@/types";
import {
  measureDownloadSpeed,
  measureUploadSpeed,
  measurePing,
  measureLoadedLatency,
  ConnectionMeta,
} from "@/lib/speedtest";

type Status = "good" | "average" | "poor";

const SERVERS = [
  { id: "ny", name: "New York (Hub-42)", latencyMs: 12, region: "North America", ip: "192.168.10.1" },
  { id: "london", name: "London (Hub-08)", latencyMs: 78, region: "Europe", ip: "10.24.150.12" },
  { id: "frankfurt", name: "Frankfurt (Hub-23)", latencyMs: 88, region: "Europe", ip: "10.24.210.45" },
  { id: "tokyo", name: "Tokyo (Hub-15)", latencyMs: 180, region: "Asia-Pacific", ip: "172.16.80.99" },
];

function formatSpeed(mbps: number): string {
  if (mbps >= 1000) return (mbps / 1000).toFixed(2);
  if (mbps >= 10) return mbps.toFixed(1);
  return mbps.toFixed(2);
}

function speedUnitDisplay(mbps: number): string {
  if (mbps >= 1000) return "Gbps";
  return "Mbps";
}

function computeScore(
  download: number,
  upload: number,
  ping: number,
  jitter: number
): { score: number; status: Status } {
  const dlScore = Math.min(download / 100, 1) * 40;
  const ulScore = Math.min(upload / 50, 1) * 25;
  const pingScore = Math.max(0, 1 - ping / 120) * 20;
  const jitterScore = Math.max(0, 1 - jitter / 20) * 15;
  const total = Math.round(dlScore + ulScore + pingScore + jitterScore);
  let status: Status = "poor";
  if (total >= 70) status = "good";
  else if (total >= 40) status = "average";
  return { score: total, status };
}

function statusConfig(status: Status) {
  switch (status) {
    case "good":
      return {
        text: "Excellent",
        color: "#10b981",
        bg: "bg-status-success/15",
        border: "border-status-success/30",
        dot: "bg-status-success shadow-[0_0_8px_#10b981]",
        textClass: "text-status-success",
      };
    case "average":
      return {
        text: "Average",
        color: "#f59e0b",
        bg: "bg-status-warning/15",
        border: "border-status-warning/30",
        dot: "bg-status-warning shadow-[0_0_8px_#f59e0b]",
        textClass: "text-status-warning",
      };
    case "poor":
      return {
        text: "Poor",
        color: "#ef4444",
        bg: "bg-status-danger/15",
        border: "border-status-danger/30",
        dot: "bg-status-danger shadow-[0_0_8px_#ef4444]",
        textClass: "text-status-danger",
      };
  }
}

function useAnimatedNumber(value: number, duration = 600) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);
  const valueRef = useRef(0);
  valueRef.current = value;

  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    let frame: number;
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = fromRef.current + (valueRef.current - fromRef.current) * eased;
      setDisplay(current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return display;
}

function statusLabel(status: SpeedTestState["status"]): string {
  switch (status) {
    case "testing-download": return "DOWNLOAD (~14s)";
    case "testing-upload":   return "UPLOAD (~12s)";
    case "testing-ping":     return "PING / JITTER";
    case "testing-loaded-latency": return "LOADED LATENCY";
    case "complete": return "COMPLETE";
    case "error":    return "FAILED";
    default: return "READY";
  }
}

const CIRCUMFERENCE = 785; // 2 * PI * 125 (radius 125 inside 280x280 viewBox)

export default function SpeedTestClient() {
  const [state, setState] = useState<SpeedTestState>({
    status: "idle",
    downloadMbps: 0,
    uploadMbps: 0,
    pingMs: 0,
    loadedLatencyMs: 0,
    unloadedLatencyMs: 0,
    jitterMs: 0,
    progress: 0,
  });

  const [selectedServer, setSelectedServer] = useState(SERVERS[0]);
  const [employeeName, setEmployeeName] = useState("");
  const [connectionMeta, setConnectionMeta] = useState<ConnectionMeta | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isRunning = useRef(false);

  // Auto-detect connection metadata and nearest server on mount
  useEffect(() => {
    const detect = async () => {
      try {
        const ping = await measurePing();
        if (ping.meta) {
          setConnectionMeta(ping.meta);
          // Map Vercel Edge ID prefix to one of our target SERVERS
          const edge = ping.meta.edgeId?.toLowerCase() || "";
          if (edge) {
            let matchedServer = SERVERS[0];
            if (edge.includes("iad") || edge.includes("cle") || edge.includes("nyc") || edge.includes("bos")) {
              matchedServer = SERVERS.find((s) => s.id === "ny") || SERVERS[0];
            } else if (edge.includes("lhr") || edge.includes("cdg") || edge.includes("ams") || edge.includes("dub")) {
              matchedServer = SERVERS.find((s) => s.id === "london") || SERVERS[0];
            } else if (edge.includes("fra") || edge.includes("muc")) {
              matchedServer = SERVERS.find((s) => s.id === "frankfurt") || SERVERS[0];
            } else if (edge.includes("hnd") || edge.includes("nrt") || edge.includes("hkg") || edge.includes("sin") || edge.includes("icn")) {
              matchedServer = SERVERS.find((s) => s.id === "tokyo") || SERVERS[0];
            }
            setSelectedServer(matchedServer);
          }
        }
      } catch (err) {
        console.warn("Auto-detect server latency failed:", err);
      }
    };
    detect();
  }, []);

  const runTest = useCallback(async () => {
    if (isRunning.current) return;
    isRunning.current = true;
    setSaved(false);

    setState({
      status: "testing-download",
      downloadMbps: 0,
      uploadMbps: 0,
      pingMs: 0,
      loadedLatencyMs: 0,
      unloadedLatencyMs: 0,
      jitterMs: 0,
      progress: 5,
    });

    try {
      // 1. Measure Download Speed (parallel streams, warmup excluded — ~14s)
      const downloadMbps = await measureDownloadSpeed((mbps) => {
        setState((s) => ({ ...s, downloadMbps: mbps, progress: 25 }));
      });

      setState((s) => ({ ...s, downloadMbps, status: "testing-upload", progress: 50 }));

      // 2. Measure Upload Speed (parallel XHR streams, warmup excluded — ~12s)
      const uploadMbps = await measureUploadSpeed((mbps) => {
        setState((s) => ({ ...s, uploadMbps: mbps, progress: 65 }));
      });

      setState((s) => ({ ...s, uploadMbps, status: "testing-ping", progress: 70 }));

      // 3. Measure Ping & Jitter
      const ping = await measurePing();
      if (ping.meta) {
        setConnectionMeta(ping.meta);
      }

      setState((s) => ({
        ...s,
        pingMs: ping.unloaded,
        jitterMs: ping.jitter,
        unloadedLatencyMs: ping.unloaded,
        status: "testing-loaded-latency",
        progress: 85,
      }));

      // 4. Measure Loaded Latency
      const loaded = await measureLoadedLatency();

      setState((s) => ({
        ...s,
        loadedLatencyMs: loaded,
        status: "complete",
        progress: 100,
      }));

      const { score, status } = computeScore(downloadMbps, uploadMbps, ping.unloaded, ping.jitter);

      const result = {
        timestamp: new Date().toISOString(),
        downloadMbps,
        uploadMbps,
        pingMs: ping.unloaded,
        loadedLatencyMs: loaded,
        unloadedLatencyMs: ping.unloaded,
        jitterMs: ping.jitter,
        score,
        status,
        employeeName: employeeName || undefined,
        clientIp: ping.meta?.clientIp,
        clientCity: ping.meta?.clientCity,
        clientRegion: ping.meta?.clientRegion,
        clientCountry: ping.meta?.clientCountry,
        asOwner: ping.meta?.asOwner,
        edgeId: ping.meta?.edgeId,
      };

      setSaving(true);
      try {
        const res = await fetch("/api/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
        if (res.ok) setSaved(true);
      } catch (err) {
        console.error(err);
      } finally {
        setSaving(false);
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Test failed",
      }));
    } finally {
      isRunning.current = false;
    }
  }, [employeeName, selectedServer]);

  const reset = () => {
    setState({
      status: "idle",
      downloadMbps: 0,
      uploadMbps: 0,
      pingMs: 0,
      loadedLatencyMs: 0,
      unloadedLatencyMs: 0,
      jitterMs: 0,
      progress: 0,
    });
    setConnectionMeta(null);
    setSaved(false);
    isRunning.current = false;
  };

  const isTesting = state.status.startsWith("testing-");
  const showResult = state.status === "complete";

  const primarySpeed = showResult
    ? state.downloadMbps
    : state.status === "testing-upload"
    ? state.uploadMbps
    : state.downloadMbps;

  const displaySpeed = useAnimatedNumber(primarySpeed);

  const { score, status: quality } = showResult
    ? computeScore(state.downloadMbps, state.uploadMbps, state.unloadedLatencyMs, state.jitterMs)
    : { score: 0, status: "good" as Status };

  const cfg = statusConfig(quality);

  const maxSpeed = 1000;
  const speedPercent = Math.min(primarySpeed / maxSpeed, 1);
  const dashOffset = CIRCUMFERENCE * (1 - speedPercent);

  // Speedometer tick configuration
  const ticks = Array.from({ length: 30 }).map((_, i) => {
    const angle = (i * 260) / 29 - 220; // Sweep of 260 deg
    return angle;
  });

  // Determine current active color
  const activeColorClass =
    state.status === "testing-download"
      ? "text-secondary"
      : state.status === "testing-upload"
      ? "text-purple-500"
      : state.status === "testing-ping" || state.status === "testing-loaded-latency"
      ? "text-amber-500"
      : showResult
      ? "text-status-success"
      : "text-secondary";

  const activeColorValue =
    state.status === "testing-download"
      ? "var(--secondary)"
      : state.status === "testing-upload"
      ? "#a78bfa"
      : state.status === "testing-ping" || state.status === "testing-loaded-latency"
      ? "var(--status-warning)"
      : showResult
      ? "var(--status-success)"
      : "var(--secondary)";

  return (
    <section className="flex flex-col items-center justify-center px-4 py-6 md:py-10 max-w-container-max mx-auto w-full relative z-10 animate-fade-in">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left column: Server Selector & Speed Gauge */}
        <div className="lg:col-span-7 flex flex-col items-center gap-6 w-full">
          {/* Status Header */}
          <div className={`flex items-center gap-3 px-5 py-2.5 rounded-full border glass-panel transition-all duration-500 ${showResult ? cfg.border : "border-border-subtle"}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${isTesting ? "animate-ping" : "animate-pulse"} ${showResult ? cfg.dot : "bg-secondary shadow-[0_0_8px_rgba(59,130,246,0.5)]"}`} />
            <span className="text-[11px] leading-[1] tracking-[0.08em] font-bold uppercase text-on-surface">
              {showResult ? `Status: ${cfg.text}` : isTesting ? `TESTING: ${statusLabel(state.status)}` : "SYSTEM READY"}
            </span>
          </div>

          {/* Speed Gauge - Bento Container */}
          <div className="relative w-full aspect-square max-w-[440px] flex items-center justify-center glass-panel rounded-3xl overflow-hidden group shadow-[0_12px_40px_rgba(0,0,0,0.25)] border border-border-subtle grid-bg">
            <div className="absolute inset-0 bg-gradient-to-br from-secondary/5 via-transparent to-purple-500/5 opacity-50" />
            
            {/* Speedometer Inner Scanning Sweep */}
            {isTesting && (
              <div 
                className="absolute w-72 h-72 md:w-[340px] md:h-[340px] rounded-full border border-secondary/10 animate-rotate-scan pointer-events-none"
                style={{ clipPath: "polygon(50% 50%, 50% 0, 100% 0, 100% 50%)" }}
              >
                <div 
                  className="w-full h-full rounded-full" 
                  style={{
                    background: `conic-gradient(from 180deg at 50% 50%, transparent 60%, ${activeColorValue}25 90%, ${activeColorValue}80 100%)`
                  }}
                />
              </div>
            )}

            {/* Gauge SVG */}
            <div className="absolute inset-0 flex items-center justify-center -z-10 pointer-events-none">
              <svg className="w-80 h-80 md:w-[350px] md:h-[350px]" viewBox="0 0 300 300">
                {/* Dial Ticks */}
                <g transform="translate(150, 150)">
                  {ticks.map((angle, i) => {
                    const isActive = (isTesting || showResult) && (i / ticks.length) <= speedPercent;
                    return (
                      <line
                        key={i}
                        x1="0"
                        y1="-132"
                        x2="0"
                        y2="-120"
                        transform={`rotate(${angle})`}
                        stroke={isActive ? activeColorValue : "var(--surface-container-high)"}
                        strokeWidth={isActive ? "2.5" : "1.5"}
                        className="gauge-tick"
                        style={{
                          filter: isActive ? `drop-shadow(0 0 4px ${activeColorValue})` : "none"
                        }}
                      />
                    );
                  })}
                </g>

                {/* Background Track */}
                <circle
                  cx="150"
                  cy="150"
                  fill="transparent"
                  r="110"
                  stroke="var(--surface-container)"
                  strokeWidth="2"
                  strokeDasharray="520"
                  strokeDashoffset="-70"
                  strokeLinecap="round"
                  transform="rotate(90 150 150)"
                />

                {/* Animated Flow Track */}
                <circle
                  cx="150"
                  cy="150"
                  fill="transparent"
                  r="110"
                  stroke={activeColorValue}
                  strokeWidth="5"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={isTesting || showResult ? dashOffset : CIRCUMFERENCE}
                  strokeLinecap="round"
                  className="transition-all duration-700 ease-out"
                  transform="rotate(130 150 150)"
                  style={{
                    filter: `drop-shadow(0 0 10px ${activeColorValue}40)`
                  }}
                />
              </svg>
            </div>

            {/* Content Hub inside Dial */}
            <div className="relative z-10 flex flex-col items-center text-center">
              <span className={`text-[11px] leading-[1] tracking-[0.1em] font-black mb-2 uppercase ${activeColorClass}`}>
                {showResult ? "DOWNLOAD SPEED" : isTesting ? statusLabel(state.status) : "PRESS START"}
              </span>
              
              <div className="flex items-baseline gap-1.5 justify-center">
                <span
                  className="text-[64px] md:text-[84px] leading-[0.95] tracking-[-0.05em] font-black tabular-nums text-primary transition-all duration-300"
                  style={{ 
                    fontFamily: "var(--font-geist)",
                    textShadow: (isTesting || showResult) ? `0 0 24px ${activeColorValue}20` : "none"
                  }}
                >
                  {showResult || isTesting ? formatSpeed(displaySpeed) : "0.0"}
                </span>
                <span className="text-[18px] font-bold text-on-surface-variant">
                  {showResult || isTesting ? speedUnitDisplay(primarySpeed) : "Mbps"}
                </span>
              </div>

              {/* Start Button */}
              <button
                id="start-btn"
                onClick={state.status === "idle" ? runTest : showResult ? runTest : undefined}
                disabled={isTesting}
                className={`mt-8 px-10 py-4 rounded-2xl text-[12px] tracking-[0.08em] font-bold uppercase transition-all duration-300 ${
                  isTesting
                    ? "bg-surface-container-high/40 text-on-surface-variant/40 border border-border-subtle cursor-not-allowed"
                    : "bg-gradient-to-r from-secondary via-blue-600 to-purple-600 hover:from-blue-600 hover:via-purple-600 hover:to-secondary text-white shadow-[0_4px_20px_rgba(37,99,235,0.3)] hover:shadow-[0_6px_25px_rgba(37,99,235,0.45)] hover:scale-[1.03] active:scale-[0.97]"
                }`}
              >
                {state.status === "idle" && "START SPEED TEST"}
                {isTesting && "TEST RUNNING..."}
                {showResult && !saving && "RE-RUN TEST"}
                {showResult && saving && "SAVING LOG..."}
                {state.status === "error" && "TRY AGAIN"}
              </button>
            </div>
          </div>
        </div>

        {/* Right column: Server Selector, Network Map, and Telemetry cards */}
        <div className="lg:col-span-5 flex flex-col gap-6 w-full">
          
          {/* Server Selector Panel */}
          <div className="glass-panel p-5 rounded-3xl border border-border-subtle flex flex-col gap-3.5">
            <span className="text-[11px] font-bold text-secondary tracking-widest uppercase">Target Server Node</span>
            <div className="grid grid-cols-2 gap-2">
              {SERVERS.map((srv) => {
                const active = selectedServer.id === srv.id;
                return (
                  <button
                    key={srv.id}
                    disabled={isTesting}
                    onClick={() => {
                      setSelectedServer(srv);
                      setSaved(false);
                    }}
                    className={`p-3 rounded-2xl border text-left flex flex-col gap-1 transition-all duration-300 ${
                      active
                        ? "border-secondary bg-secondary/10 text-on-surface"
                        : "border-border-subtle bg-surface-container-lowest/30 text-on-surface-variant hover:bg-surface-container-low/40 disabled:opacity-50"
                    }`}
                  >
                    <span className="text-xs font-bold truncate">{srv.name}</span>
                    <span className="text-[10px] opacity-75">{srv.region} • {srv.latencyMs}ms</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SVG Animated Network Route Map */}
          <div className="glass-panel p-5 rounded-3xl border border-border-subtle flex flex-col gap-4 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-purple-400 tracking-widest uppercase">Visual Network Route</span>
              <span className="text-[10px] text-on-surface-variant bg-surface-container/60 px-2 py-0.5 rounded-full font-medium">{selectedServer.ip}</span>
            </div>
            
            <div className="relative h-28 flex items-center justify-center bg-background/40 rounded-2xl border border-border-subtle/50 px-4">
              <svg viewBox="0 0 380 100" className="w-full h-full overflow-visible">
                {/* Connecting Path */}
                <path
                  id="network-route"
                  d="M 50 50 Q 190 15 330 50"
                  fill="none"
                  stroke="var(--border-subtle)"
                  strokeWidth="2.5"
                />

                {/* Animated Dotted Flow Packets */}
                {(isTesting || showResult) && (
                  <path
                    d="M 50 50 Q 190 15 330 50"
                    fill="none"
                    stroke={activeColorValue}
                    strokeWidth="3.5"
                    className="animate-data-flow"
                    style={{
                      animationDirection: state.status === "testing-upload" ? "reverse" : "normal",
                      filter: `drop-shadow(0 0 6px ${activeColorValue})`
                    }}
                  />
                )}

                {/* Left Node: Client (User) */}
                <g transform="translate(50, 50)" className="cursor-default">
                  <circle r="16" fill="var(--surface-container-lowest)" stroke="var(--secondary)" strokeWidth="2.5" />
                  <circle r="6" fill="var(--secondary)" className={isTesting ? "animate-pulse" : ""} />
                  {isTesting && <circle r="22" fill="none" stroke="var(--secondary)" strokeWidth="1" className="animate-map-pulse" />}
                  <text y="32" textAnchor="middle" fill="var(--on-surface-variant)" className="text-[9px] font-bold">
                    {connectionMeta?.clientIp || "CLIENT NODE"}
                  </text>
                  {connectionMeta?.clientCity && (
                    <text y="42" textAnchor="middle" fill="var(--on-surface-variant)" className="text-[7.5px] opacity-70">
                      {connectionMeta.clientCity}, {connectionMeta.clientCountry}
                    </text>
                  )}
                </g>

                {/* Right Node: Target Server */}
                <g transform="translate(330, 50)" className="cursor-default">
                  <circle r="16" fill="var(--surface-container-lowest)" stroke="var(--purple-500)" strokeWidth="2.5" />
                  <circle r="6" fill="var(--purple-500)" className={isTesting ? "animate-pulse" : ""} />
                  {isTesting && <circle r="22" fill="none" stroke="var(--purple-500)" strokeWidth="1" className="animate-map-pulse" />}
                  <text y="32" textAnchor="middle" fill="var(--on-surface-variant)" className="text-[9px] font-bold uppercase truncate max-w-[80px]">
                    {connectionMeta?.edgeId ? `EDGE: ${connectionMeta.edgeId.split("::")[0]}` : selectedServer.id}
                  </text>
                  {connectionMeta?.asOwner && (
                    <text y="42" textAnchor="middle" fill="var(--on-surface-variant)" className="text-[7.5px] opacity-70 truncate max-w-[80px]">
                      {connectionMeta.asOwner.length > 18 ? `${connectionMeta.asOwner.substring(0, 15)}...` : connectionMeta.asOwner}
                    </text>
                  )}
                </g>
              </svg>
            </div>
          </div>

          {/* Telemetry Stats Breakdown Grid */}
          <div className="grid grid-cols-2 gap-4">
            <MetricCard
              icon="download"
              label="DOWNLOAD SPEED"
              value={showResult ? state.downloadMbps.toFixed(1) : isTesting && state.status === "testing-download" ? state.downloadMbps.toFixed(1) : "—"}
              unit="Mbps"
              progress={showResult ? Math.min(state.downloadMbps / 1000, 1) * 100 : isTesting && state.status === "testing-download" ? Math.min(state.downloadMbps / 1000, 1) * 100 : 0}
              active={state.status === "testing-download"}
              accentColor="bg-secondary shadow-[0_0_8px_var(--secondary)]"
            />
            <MetricCard
              icon="upload"
              label="UPLOAD SPEED"
              value={showResult ? state.uploadMbps.toFixed(1) : isTesting && state.status === "testing-upload" ? state.uploadMbps.toFixed(1) : "—"}
              unit="Mbps"
              progress={showResult ? Math.min(state.uploadMbps / 500, 1) * 100 : isTesting && state.status === "testing-upload" ? Math.min(state.uploadMbps / 500, 1) * 100 : 0}
              active={state.status === "testing-upload"}
              accentColor="bg-purple-500 shadow-[0_0_8px_#a78bfa]"
            />
            <MetricCard
              icon="timer"
              label="PING RTT"
              value={showResult ? state.pingMs.toFixed(1) : isTesting && state.status === "testing-ping" ? state.pingMs.toFixed(1) : "—"}
              unit="ms"
              badge={showResult ? (state.pingMs < 30 ? "Optimal" : state.pingMs < 90 ? "Fair" : "High") : undefined}
              badgeColor={state.pingMs < 30 ? "text-status-success" : state.pingMs < 90 ? "text-status-warning" : "text-status-danger"}
            />
            <MetricCard
              icon="signal_cellular_alt"
              label="JITTER RATE"
              value={showResult ? state.jitterMs.toFixed(1) : isTesting && state.status === "testing-ping" ? state.jitterMs.toFixed(1) : "—"}
              unit="ms"
              badge={showResult ? (state.jitterMs < 5 ? "Stable" : state.jitterMs < 15 ? "Moderate" : "Unstable") : undefined}
              badgeColor={state.jitterMs < 5 ? "text-status-success" : state.jitterMs < 15 ? "text-status-warning" : "text-status-danger"}
            />
          </div>

          {/* Quality breakdown & Info card */}
          {showResult && (
            <div className="glass-panel p-5 rounded-3xl border border-border-subtle flex flex-col gap-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold text-secondary tracking-widest uppercase">Performance Grade</span>
                  <span className="text-xl font-extrabold text-primary">Enterprise Rating</span>
                </div>
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-secondary/10 to-purple-500/10 border border-secondary/30 flex items-center justify-center text-2xl font-black text-secondary">
                  {score >= 85 ? "A+" : score >= 70 ? "A" : score >= 50 ? "B" : score >= 35 ? "C" : "D"}
                </div>
              </div>
              <div className="text-xs text-on-surface-variant leading-relaxed">
                This connection achieves a score of <strong className="text-on-surface">{score}/100</strong>. It supports smooth 8K streaming, high-frequency remote access, enterprise database queries, and heavy workloads.
              </div>
              
              <div className="flex items-center justify-between border-t border-border-subtle pt-3 text-[11px] font-semibold">
                <span className="text-on-surface-variant">Sheet DB Saving</span>
                <span className={`flex items-center gap-1.5 ${saved ? "text-status-success" : "text-on-surface-variant"}`}>
                  {saving && <span className="w-3.5 h-3.5 border-2 border-on-surface-variant border-t-secondary rounded-full animate-spin" />}
                  {saved && (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {saving ? "Transmitting payload..." : saved ? "Synced successfully" : "Saving payload..."}
                </span>
              </div>

              {connectionMeta && (
                <div className="border-t border-border-subtle pt-3 flex flex-col gap-1.5 text-[11px] animate-fade-in">
                  <span className="font-bold text-secondary uppercase tracking-widest text-[9px]">Edge Diagnostic Telemetry</span>
                  <div className="grid grid-cols-2 gap-y-1.5 text-on-surface-variant text-[10px] bg-surface-container/20 p-3 rounded-2xl border border-border-subtle/30">
                    <div>Client IP:</div>
                    <div className="text-right text-on-surface font-semibold tabular-nums">{connectionMeta.clientIp || "—"}</div>
                    <div>Location:</div>
                    <div className="text-right text-on-surface font-semibold">{connectionMeta.clientCity ? `${connectionMeta.clientCity}, ${connectionMeta.clientCountry}` : "—"}</div>
                    <div>ISP / AS Owner:</div>
                    <div className="text-right text-on-surface font-semibold truncate" title={connectionMeta.asOwner}>{connectionMeta.asOwner || "—"}</div>
                    <div>Vercel Gateway:</div>
                    <div className="text-right text-on-surface font-semibold truncate" title={connectionMeta.edgeId}>{connectionMeta.edgeId ? connectionMeta.edgeId.split("::")[0] : "—"}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {state.status === "error" && (
            <div className="px-6 py-4 bg-status-danger/10 border border-status-danger/20 rounded-2xl text-status-danger text-xs text-center font-medium shadow-sm animate-pulse-slow">
              {state.error || "System warning: Network test abortive. Check connection."}
            </div>
          )}

          {/* User Signatures ID Widget */}
          <div className="glass-panel p-5 rounded-3xl border border-border-subtle flex flex-col gap-3 relative">
            <label className="text-[11px] font-bold text-on-surface-variant tracking-wider uppercase">
              Identify Client / Employee ID
            </label>
            <input
              type="text"
              disabled={isTesting}
              placeholder="e.g. Alex Chen — Network Eng"
              value={employeeName}
              onChange={(e) => {
                setEmployeeName(e.target.value);
                setSaved(false);
              }}
              className="w-full text-sm bg-background/50 border border-border-subtle rounded-xl px-4 py-3 text-on-surface placeholder-on-surface-variant/40 focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15 transition-all duration-300"
            />
          </div>

        </div>

      </div>
    </section>
  );
}

interface MetricCardProps {
  icon: string;
  label: string;
  value: string;
  unit: string;
  progress?: number;
  active?: boolean;
  accentColor?: string;
  badge?: string;
  badgeColor?: string;
}

function MetricCard({
  icon,
  label,
  value,
  unit,
  progress,
  active,
  accentColor,
  badge,
  badgeColor,
}: MetricCardProps) {
  return (
    <div className={`glass-panel p-4 rounded-3xl border flex flex-col gap-2 transition-all duration-300 ${active ? "border-secondary/60 bg-secondary/5" : "border-border-subtle"}`}>
      <div className="flex items-center gap-2 text-on-surface-variant">
        <span className={`material-symbols-outlined text-[18px] ${active ? "text-secondary animate-bounce" : ""}`}>{icon}</span>
        <span className="text-[10px] tracking-wider font-bold uppercase truncate">{label}</span>
      </div>
      
      <div className="flex items-baseline gap-1 mt-1">
        <span className="text-[22px] font-black tracking-tight tabular-nums text-primary">
          {value}
        </span>
        <span className="text-[10px] font-bold text-on-surface-variant uppercase">{unit}</span>
      </div>

      {progress !== undefined && (
        <div className="h-1 w-full bg-surface-container rounded-full mt-1 overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-500 ${accentColor || "bg-secondary"}`} 
            style={{ width: `${progress}%` }} 
          />
        </div>
      )}

      {badge && (
        <div className="flex items-center gap-1 mt-1">
          <span className={`text-[9px] font-bold uppercase tracking-wider ${badgeColor || "text-on-surface-variant"}`}>{badge}</span>
        </div>
      )}
    </div>
  );
}
