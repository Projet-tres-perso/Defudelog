import React from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import logo from "./assets/logo.png";
import {
  LayoutDashboard,
  ScrollText,
  AlertTriangle,
  Settings,
  Radio,
  FileText,
  ShieldCheck,
} from "lucide-react";
import Dashboard from "./pages/Dashboard";
import LogViewer from "./pages/LogViewer";
import Alerts from "./pages/Alerts";
import Configuration from "./pages/Configuration";
import Sources from "./pages/Sources";
import Reports from "./pages/Reports";
import Rules from "./pages/Rules";

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

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-surface-900 border-r border-surface-700 flex flex-col">
        <div className="p-4 border-b border-surface-700">
          <div className="flex items-center gap-3">
            <img src={logo} alt="DeFuDoLog Logo" className="w-8 h-8 object-contain" />
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white">DeFuDoLog</h1>
              <p className="text-2xs text-surface-400">Detection Platform</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ to, icon: Icon, label }) => {
            const isActive = location.pathname === to;
            return (
              <NavLink
                key={to}
                to={to}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-100 ${
                  isActive
                    ? "bg-primary-600/15 text-primary-400"
                    : "text-surface-400 hover:bg-surface-800 hover:text-surface-200"
                }`}
              >
                <Icon size={18} />
                {label}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-surface-700">
          <div className="flex items-center gap-2 px-3 py-2">
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
      </main>
    </div>
  );
}
