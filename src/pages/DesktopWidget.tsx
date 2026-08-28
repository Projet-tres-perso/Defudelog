import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { DashboardStats, Alert, AlertCategory } from "@/types";
import {
  ShieldAlert,
  KeyRound,
  Cpu,
  Lock,
  Maximize2,
  X,
  Pin,
  Activity,
  ShieldCheck,
  Radio,
} from "lucide-react";

export default function DesktopWidget() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [categoryCounts, setCategoryCounts] = useState<Record<AlertCategory, number>>({
    data_leak: 0,
    authentication: 0,
    system_anomaly: 0,
    privilege_escalation: 0,
    general: 0,
  });
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);
  const [throughputHistory, setThroughputHistory] = useState<number[]>([12, 18, 15, 22, 28, 25, 34, 30, 42, 38, 45, 40]);
  const prevTotalLogs = useRef<number | null>(null);

  const fetchWidgetData = async () => {
    try {
      const s = await invoke<DashboardStats>("get_dashboard_stats");
      setStats(s);

      // Calcul du débit de logs/seconde
      if (s && prevTotalLogs.current !== null) {
        const delta = Math.max(0, s.total_logs - prevTotalLogs.current);
        setThroughputHistory((prev) => [...prev.slice(1), delta]);
      }
      if (s) {
        prevTotalLogs.current = s.total_logs;
      }

      const alerts = await invoke<Alert[]>("get_alerts", { limit: 100 });
      const counts = alerts.reduce((acc, a) => {
        acc[a.category] = (acc[a.category] || 0) + 1;
        return acc;
      }, {
        data_leak: 0,
        authentication: 0,
        system_anomaly: 0,
        privilege_escalation: 0,
        general: 0,
      } as Record<AlertCategory, number>);
      setCategoryCounts(counts);
    } catch (e) {
      console.debug("Erreur rafraîchissement DesktopWidget:", e);
    }
  };

  useEffect(() => {
    fetchWidgetData();
    const interval = setInterval(fetchWidgetData, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleOpenMainApp = async () => {
    try {
      await invoke("focus_main_window");
    } catch (e) {
      console.error(e);
    }
  };

  const handleCloseWidget = async () => {
    try {
      await invoke("toggle_desktop_widget", { show: false });
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleAlwaysOnTop = async () => {
    try {
      const win = getCurrentWebviewWindow();
      const nextState = !isAlwaysOnTop;
      await win.setAlwaysOnTop(nextState);
      setIsAlwaysOnTop(nextState);
    } catch (e) {
      console.error(e);
    }
  };

  // Coordonnées pour tracer la courbe SVG
  const maxVal = Math.max(10, ...throughputHistory);
  const points = throughputHistory
    .map((val, idx) => {
      const x = (idx / (throughputHistory.length - 1)) * 300;
      const y = 30 - (val / maxVal) * 26;
      return `${x},${y}`;
    })
    .join(" ");

  const latestThroughput = throughputHistory[throughputHistory.length - 1] || 0;

  return (
    <div className="w-full h-full bg-surface-950/95 backdrop-blur-2xl border border-primary-500/40 rounded-2xl shadow-2xl p-3 flex flex-col justify-between select-none overflow-hidden text-surface-100 font-sans">
      {/* Draggable Header */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between cursor-move pb-2 border-b border-surface-800/80 -mx-1 px-1"
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <div className="p-1 rounded-md bg-primary-500/20 text-primary-400 border border-primary-500/30">
            <Radio size={13} className="animate-pulse" />
          </div>
          <div>
            <span className="text-xs font-bold tracking-wide text-white flex items-center gap-1.5">
              <span>DefuDelog HUD</span>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggleAlwaysOnTop}
            className={`p-1 rounded hover:bg-surface-800 transition ${
              isAlwaysOnTop ? "text-primary-400" : "text-surface-500"
            }`}
            title={isAlwaysOnTop ? "Détacher du premier plan" : "Garder au premier plan"}
          >
            <Pin size={12} className={isAlwaysOnTop ? "fill-current" : ""} />
          </button>
          <button
            type="button"
            onClick={handleOpenMainApp}
            className="p-1 rounded hover:bg-surface-800 text-surface-400 hover:text-white transition"
            title="Ouvrir la Console Principale"
          >
            <Maximize2 size={12} />
          </button>
          <button
            type="button"
            onClick={handleCloseWidget}
            className="p-1 rounded hover:bg-red-500/20 text-surface-400 hover:text-red-300 transition"
            title="Masquer le Widget"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Mini Live Sparkline Chart */}
      <div className="py-1.5">
        <div className="flex items-center justify-between text-3xs text-surface-400 mb-1">
          <span className="flex items-center gap-1">
            <Activity size={10} className="text-cyan-400" />
            <span>Débit Flux Temps Réel</span>
          </span>
          <span className="font-mono text-cyan-300 font-semibold">{latestThroughput} logs/s</span>
        </div>

        <div className="h-8 w-full bg-surface-900/60 rounded-lg p-1 border border-surface-800/60 relative overflow-hidden flex items-end">
          <svg className="w-full h-full overflow-visible" viewBox="0 0 300 30" preserveAspectRatio="none">
            <defs>
              <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <polygon points={`0,30 ${points} 300,30`} fill="url(#sparklineGrad)" />
            <polyline fill="none" stroke="#22d3ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" points={points} />
          </svg>
        </div>
      </div>

      {/* 2x2 Grid Threat & Anomaly Counters */}
      <div className="grid grid-cols-2 gap-1.5">
        {/* Risque de Fuite */}
        <div className={`p-1.5 rounded-lg border flex items-center justify-between ${
          categoryCounts.data_leak > 0
            ? "bg-red-950/40 border-red-500/40 text-red-300 animate-pulse"
            : "bg-surface-900/50 border-surface-800 text-surface-300"
        }`}>
          <div className="flex items-center gap-1.5 truncate">
            <ShieldAlert size={12} className={categoryCounts.data_leak > 0 ? "text-red-400" : "text-surface-500"} />
            <span className="text-3xs font-medium truncate">Risque Fuite</span>
          </div>
          <span className="text-xs font-mono font-bold">{categoryCounts.data_leak}</span>
        </div>

        {/* Authentification */}
        <div className={`p-1.5 rounded-lg border flex items-center justify-between ${
          categoryCounts.authentication > 0
            ? "bg-amber-950/40 border-amber-500/40 text-amber-300"
            : "bg-surface-900/50 border-surface-800 text-surface-300"
        }`}>
          <div className="flex items-center gap-1.5 truncate">
            <KeyRound size={12} className={categoryCounts.authentication > 0 ? "text-amber-400" : "text-surface-500"} />
            <span className="text-3xs font-medium truncate">Authentification</span>
          </div>
          <span className="text-xs font-mono font-bold">{categoryCounts.authentication}</span>
        </div>

        {/* Anomalies Système */}
        <div className={`p-1.5 rounded-lg border flex items-center justify-between ${
          categoryCounts.system_anomaly > 0
            ? "bg-purple-950/40 border-purple-500/40 text-purple-300"
            : "bg-surface-900/50 border-surface-800 text-surface-300"
        }`}>
          <div className="flex items-center gap-1.5 truncate">
            <Cpu size={12} className={categoryCounts.system_anomaly > 0 ? "text-purple-400" : "text-surface-500"} />
            <span className="text-3xs font-medium truncate">Anomalies</span>
          </div>
          <span className="text-xs font-mono font-bold">{categoryCounts.system_anomaly}</span>
        </div>

        {/* Élévation Privilèges */}
        <div className={`p-1.5 rounded-lg border flex items-center justify-between ${
          categoryCounts.privilege_escalation > 0
            ? "bg-rose-950/40 border-rose-500/40 text-rose-300"
            : "bg-surface-900/50 border-surface-800 text-surface-300"
        }`}>
          <div className="flex items-center gap-1.5 truncate">
            <Lock size={12} className={categoryCounts.privilege_escalation > 0 ? "text-rose-400" : "text-surface-500"} />
            <span className="text-3xs font-medium truncate">Privilèges</span>
          </div>
          <span className="text-xs font-mono font-bold">{categoryCounts.privilege_escalation}</span>
        </div>
      </div>

      {/* Footer Status Bar */}
      <div className="pt-1.5 border-t border-surface-800/80 flex items-center justify-between text-3xs text-surface-500">
        <span className="flex items-center gap-1">
          <ShieldCheck size={11} className="text-emerald-400" />
          <span>HDBSCAN + BGE Actif</span>
        </span>
        <button
          type="button"
          onClick={handleOpenMainApp}
          className="text-primary-400 hover:text-primary-300 underline font-medium"
        >
          Console
        </button>
      </div>
    </div>
  );
}
