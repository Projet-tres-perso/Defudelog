import React, { useEffect, useState } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import logo from "./assets/logo.png";
import {
  LayoutDashboard,
  ScrollText,
  AlertTriangle,
  Settings,
  Radio,
  FileText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Dashboard from "./pages/Dashboard";
import LogViewer from "./pages/LogViewer";
import Alerts from "./pages/Alerts";
import Configuration from "./pages/Configuration";
import Sources from "./pages/Sources";
import Reports from "./pages/Reports";
import Rules from "./pages/Rules";
import DesktopWidget from "./pages/DesktopWidget";
import UpdateNotification from "./components/UpdateNotification";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/logs", icon: ScrollText, label: "Logs" },
  { to: "/alerts", icon: AlertTriangle, label: "Alertes" },
  { to: "/rules", icon: ShieldCheck, label: "Règles" },
  { to: "/sources", icon: Radio, label: "Sources" },
  { to: "/reports", icon: FileText, label: "Rapports" },
  { to: "/config", icon: Settings, label: "Configuration" },
];

export default function App() {
  const location = useLocation();
  const [isWidgetWindow, setIsWidgetWindow] = useState(false);
  const [mlStatus, setMlStatus] = useState<"loading" | "ready" | "error">("ready");
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string | null>(null);

  useEffect(() => {
    try {
      const win = getCurrentWebviewWindow();
      if (win && win.label === "widget") {
        setIsWidgetWindow(true);
      }
    } catch {
      // Fallback
    }
  }, []);

  useEffect(() => {
    const unlistenLoading = listen("ml-loading", () => setMlStatus("loading"));
    const unlistenReady = listen("ml-ready", () => setMlStatus("ready"));
    const unlistenError = listen("ml-error", (e) => {
      setMlStatus("error");
      console.error(e);
    });
    const unlistenNetwork = listen("network-error", (e) => {
      setNetworkError(e.payload as string);
    });

    const handleUpdateFound = (e: Event) => {
      const customEvent = e as CustomEvent<{ version: string }>;
      if (customEvent.detail?.version) {
        setAvailableUpdateVersion(customEvent.detail.version);
      }
    };

    const handleUpdateNotFound = () => {
      setAvailableUpdateVersion(null);
    };

    window.addEventListener("defudelog-update-found", handleUpdateFound);
    window.addEventListener("defudelog-update-not-found", handleUpdateNotFound);

    return () => {
      unlistenLoading.then(f => f());
      unlistenReady.then(f => f());
      unlistenError.then(f => f());
      unlistenNetwork.then(f => f());
      window.removeEventListener("defudelog-update-found", handleUpdateFound);
      window.removeEventListener("defudelog-update-not-found", handleUpdateNotFound);
    };
  }, []);

  if (isWidgetWindow) {
    return (
      <div className="w-screen h-screen bg-transparent overflow-hidden">
        <DesktopWidget />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Overlays and Toasts */}
      {mlStatus === "loading" && (
        <div className="fixed inset-0 bg-surface-950/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-surface-900 border border-surface-700 p-6 rounded-xl max-w-md w-full text-center shadow-2xl">
            <div className="w-12 h-12 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
            <h3 className="text-lg font-bold text-white mb-2">Initialisation de l'IA</h3>
            <p className="text-sm text-surface-400">
              Chargement du modèle ONNX (BGE-small). Lors du premier lancement, le modèle (133 Mo) est automatiquement téléchargé en tâche de fond. Veuillez patienter...
            </p>
          </div>
        </div>
      )}

      {networkError && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-900/90 border border-red-500/50 text-white p-4 rounded-lg shadow-lg flex items-start max-w-sm animate-fade-in">
          <AlertTriangle className="w-5 h-5 text-red-400 mr-3 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-bold text-sm mb-1">Privilèges Insuffisants</h4>
            <p className="text-xs text-red-200">{networkError}</p>
          </div>
          <button onClick={() => setNetworkError(null)} className="ml-3 text-red-300 hover:text-white transition-colors">✕</button>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-surface-900 border-r border-surface-700 flex flex-col">
        <div className="p-4 border-b border-surface-700">
          <div className="flex items-center gap-3">
            <img src={logo} alt="DefuDelog Logo" className="w-8 h-8 object-contain" />
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white">DefuDelog</h1>
              <p className="text-2xs text-surface-400">Detection Platform</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ to, icon: Icon, label }) => {
            const isActive = location.pathname === to;
            const hasUpdate = to === "/config" && availableUpdateVersion;
            return (
              <NavLink
                key={to}
                to={to}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-100 ${isActive
                    ? "bg-primary-600/15 text-primary-400"
                    : "text-surface-400 hover:bg-surface-800 hover:text-surface-200"
                  }`}
              >
                <div className="flex items-center gap-3">
                  <Icon size={18} />
                  <span>{label}</span>
                </div>
                {hasUpdate && (
                  <span className="flex h-2 w-2 relative" title={`Mise à jour v${availableUpdateVersion} disponible !`}>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-surface-700 space-y-2">
          {/* Desktop HUD Widget Shortcut Button */}
          <button
            type="button"
            onClick={() => invoke("toggle_desktop_widget", { show: true })}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold text-primary-300 bg-primary-950/50 border border-primary-500/30 hover:bg-primary-900/50 hover:border-primary-500/50 transition-all shadow-sm group"
            title="Ouvrir le Mini-Widget Bureau flottant"
          >
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-primary-400 group-hover:scale-110 transition-transform" />
              <span>Widget Bureau</span>
            </div>
            <span className="text-3xs bg-primary-500/20 px-1.5 py-0.5 rounded text-primary-300 font-mono">HUD</span>
          </button>

          {availableUpdateVersion && (
            <NavLink
              to="/config"
              className="flex items-center justify-between p-2 rounded-lg bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/50 transition-all text-2xs"
            >
              <span className="font-semibold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                v{availableUpdateVersion} dispo
              </span>
              <span className="text-3xs bg-emerald-500/20 px-1.5 py-0.5 rounded text-emerald-200 font-mono">Voir</span>
            </NavLink>
          )}

          <div className="flex items-center gap-2 px-3 py-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-surface-400">Monitoring actif</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-surface-950">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/logs" element={<LogViewer />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/config" element={<Configuration />} />
        </Routes>
        <UpdateNotification />
      </main>
    </div>
  );
}
