import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LogSource, NetworkNode, DiscoveredSource } from "@/types";
import {
  Plus, Trash2, Play, Pause, Server, FolderOpen,
  Monitor, HardDrive, Radio, LucideIcon, Cpu, Globe, Zap, Check, X,
  ShieldAlert, ShieldCheck, AlertTriangle, Copy, Terminal, Info
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";

const osIcons: Record<string, LucideIcon> = {
  linux: HardDrive,
  macos: Monitor,
  darwin: Monitor,
  windows: Monitor,
};

function formatSourceType(st: unknown): string {
  if (!st) return "Inconnu";
  if (typeof st === "string") return st;
  if (typeof st === "object" && st !== null) {
    const keys = Object.keys(st);
    if (keys.length > 0) return keys[0];
  }
  return "custom";
}

export default function Sources() {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [nodes, setNodes] = useState<NetworkNode[]>([]);
  const [syslogRunning, setSyslogRunning] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [suggestions, setSuggestions] = useState<DiscoveredSource[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // New Source Form State
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("file_watcher");
  const [newOs, setNewOs] = useState("auto");
  const [newPath, setNewPath] = useState("");
  const [newPattern, setNewPattern] = useState("*.log");
  const [newChannel, setNewChannel] = useState("Application");
  const [newKafkaTopic, setNewKafkaTopic] = useState("logs");
  const [newKafkaBrokers, setNewKafkaBrokers] = useState("localhost:9092");
  const [testResult, setTestResult] = useState<{ok: boolean, msg: string} | null>(null);

  // Mock data for sparklines
  const generateSparklineData = () => {
    return Array.from({ length: 20 }, () => ({
      value: Math.floor(Math.random() * 100)
    }));
  };

  const fetchSources = async () => {
    try {
      // Nettoyage préventif des fausses sources démo
      await invoke("purge_demo_sources");
      const s = await invoke<LogSource[]>("list_log_sources");
      setSources(Array.isArray(s) ? s : []);
    } catch (e) {
      console.error("Erreur list_log_sources:", e);
    }
    try {
      const n = await invoke<NetworkNode[]>("get_network_nodes");
      setNodes(Array.isArray(n) ? n : []);
    } catch (e) {
      console.error("Erreur get_network_nodes:", e);
    }
    try {
      const status = await invoke<{ running: boolean }>("get_syslog_status");
      setSyslogRunning(status?.running ?? false);
    } catch (e) {
      console.error("Erreur get_syslog_status:", e);
    }
  };

  const handleRelaunchAdmin = async () => {
    try {
      await invoke("relaunch_as_admin");
    } catch (e) {
      alert("Erreur lors de la demande d'élévation: " + String(e));
    }
  };

  useEffect(() => {
    fetchSources();
    const interval = setInterval(fetchSources, 3000);
    return () => clearInterval(interval);
  }, []);

  const autoDiscover = async () => {
    try {
      const discovered = await invoke<DiscoveredSource[]>("auto_discover_host_sources");
      setSuggestions(discovered);
    } catch (e) {
      console.error(e);
    }
  };

  const copyPermissionCmd = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const acceptSuggestion = async (suggestion: DiscoveredSource) => {
    try {
      const srcType = formatSourceType(suggestion.source_type);
      await invoke("add_log_source", {
        name: suggestion.name,
        sourceType: srcType,
        hostname: suggestion.hostname,
        os: suggestion.os,
        config: suggestion.config,
      });
      setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
      await fetchSources();
    } catch (e) {
      console.error("Erreur acceptSuggestion:", e);
      alert("Erreur lors de l'ajout de la source: " + String(e));
    }
  };

  const toggleSyslog = async () => {
    try {
      if (syslogRunning) {
        await invoke("stop_syslog_server");
      } else {
        await invoke("start_syslog_server");
      }
      await fetchSources();
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSource = async (id: string, enabled: boolean) => {
    try {
      await invoke("toggle_log_source", { sourceId: id, enabled });
      await fetchSources();
    } catch (e) {
      console.error(e);
    }
  };

  const removeSource = async (id: string) => {
    try {
      await invoke("delete_log_source", { sourceId: id });
      await fetchSources();
    } catch (e) {
      console.error(e);
    }
  };

  const submitAddSource = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newName.trim()) {
      alert("Veuillez saisir un nom pour la source.");
      return;
    }
    
    try {
      let config: any = {};
      if (newType === "file_watcher") {
        if (!newPath.trim()) {
          alert("Veuillez renseigner le chemin du fichier de log.");
          return;
        }
        config = { path: newPath.trim(), pattern: newPattern.trim() || "*" };
      } else if (newType === "windows_event_log") {
        config = { channel: newChannel.trim() || "Security" };
      } else if (newType === "macos_unified_log") {
        config = { predicate: null };
      } else if (newType === "journald") {
        config = { unit_filter: null };
      } else if (newType === "kafka") {
        if (!newKafkaTopic.trim() || !newKafkaBrokers.trim()) {
          alert("Veuillez renseigner le topic et les brokers Kafka.");
          return;
        }
        config = {
          topic: newKafkaTopic.trim(),
          brokers: newKafkaBrokers.split(",").map(b => b.trim()).filter(Boolean),
        };
      }

      const detectedOs = navigator.userAgent.includes("Win")
        ? "windows"
        : navigator.userAgent.includes("Mac")
        ? "macos"
        : "linux";

      await invoke("add_log_source", {
        name: newName.trim(),
        sourceType: newType,
        hostname: "localhost",
        os: newOs === "auto" ? detectedOs : newOs,
        config,
      });

      setShowAdd(false);
      setNewName("");
      setNewPath("");
      setTestResult(null);
      await fetchSources();
    } catch (e) {
      console.error("Erreur add_log_source:", e);
      alert("Erreur lors de l'enregistrement de la source: " + String(e));
    }
  };

  const testConnection = async () => {
    if (newType !== "file_watcher" || !newPath) return;
    try {
      const res = await invoke<{ accessible: boolean; message: string }>("check_source_permission", { path: newPath });
      setTestResult({ ok: res.accessible, msg: res.message });
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) });
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Sources & Réseau de Logs</h2>
          <p className="text-sm text-surface-400 mt-1">
            Collecte automatique locale & réception réseau multi-machines
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={autoDiscover} className="btn-secondary flex items-center gap-2">
            <Zap size={16} className="text-amber-400" />
            Auto-détecter hôte
          </button>
          <button onClick={() => setShowAdd(!showAdd)} className="btn-primary">
            <Plus size={16} />
            Ajouter une source
          </button>
        </div>
      </div>

      {/* Syslog Server Control */}
      <div className="card flex items-center justify-between bg-primary-950/20 border-primary-500/30">
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-xl ${syslogRunning ? "bg-emerald-500/20 text-emerald-400" : "bg-surface-800 text-surface-400"}`}>
            <Globe size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">Serveur Syslog Réseau (UDP/TCP: 1514)</h3>
              <span className={`badge ${syslogRunning ? "bg-emerald-500/20 text-emerald-400" : "bg-surface-700 text-surface-400"}`}>
                {syslogRunning ? "En écoute" : "Arrêté"}
              </span>
            </div>
            <p className="text-xs text-surface-400 mt-1">
              Permet aux serveurs et machines du réseau d'envoyer leurs logs via <code className="text-primary-300">*.* @IP:1514</code>
            </p>
          </div>
        </div>
        <button
          onClick={toggleSyslog}
          className={`btn ${syslogRunning ? "bg-amber-600 hover:bg-amber-700 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}
        >
          {syslogRunning ? "Arrêter le serveur" : "Activer la réception réseau"}
        </button>
      </div>

      {/* Network Nodes (Local + Remote) */}
      {nodes.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-surface-300 flex items-center gap-2">
            <Cpu size={16} className="text-primary-400" />
            Machines du réseau détectées ({nodes.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {nodes.map((node) => (
              <div key={node.hostname} className="card flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{node.hostname}</p>
                  <p className="text-xs text-surface-500">{node.ip_address} · {node.log_count} logs</p>
                </div>
                <span className="badge bg-primary-500/10 text-primary-400 text-2xs">
                  {new Date(node.last_seen).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions Auto-découverte avec État des Permissions */}
      {suggestions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-surface-300 flex items-center gap-2">
              <Zap size={16} className="text-amber-400" />
              Sources détectées sur cet hôte ({suggestions.length})
            </h3>
            <button
              onClick={() => suggestions.forEach(s => { if (s.status === "accessible") acceptSuggestion(s); })}
              className="btn-ghost text-xs text-primary-400 hover:text-primary-300"
            >
              Ajouter toutes les sources accessibles
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {suggestions.map((sug) => {
              const isAccessible = sug.status === "accessible";
              const isDenied = sug.status === "permission_denied";
              const isElevation = sug.status === "requires_elevation";

              return (
                <div
                  key={sug.id}
                  className={`card flex flex-col justify-between border ${
                    isAccessible
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : isDenied
                      ? "border-red-500/40 bg-red-500/5"
                      : "border-amber-500/40 bg-amber-500/5"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm text-surface-100">{sug.name}</p>
                          {sug.is_critical_security && (
                            <span className="badge bg-red-500/20 text-red-400 text-2xs">Sécurité Critique</span>
                          )}
                        </div>
                        <p className="text-xs text-surface-400 mt-0.5">{sug.category}</p>
                      </div>
                      <span
                        className={`badge text-2xs flex items-center gap-1 ${
                          isAccessible
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : isDenied
                            ? "bg-red-500/20 text-red-400 border border-red-500/30"
                            : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        }`}
                      >
                        {isAccessible && <ShieldCheck size={12} />}
                        {isDenied && <ShieldAlert size={12} />}
                        {isElevation && <AlertTriangle size={12} />}
                        {isAccessible ? "Accessible" : isDenied ? "Permissions Requises" : "Admin Requis"}
                      </span>
                    </div>

                    <div className="bg-surface-900/60 rounded px-2.5 py-1.5 font-mono text-xs text-surface-300 break-all mb-2 border border-surface-800">
                      {sug.target_path}
                    </div>

                    {/* Instructions de déblocage si permission_denied */}
                    {sug.permission_help && (
                      <div className="bg-surface-950/80 border border-surface-800 rounded p-2.5 mb-3 text-xs">
                        <div className="flex items-center justify-between text-amber-400 mb-1 font-medium">
                          <span className="flex items-center gap-1">
                            <Terminal size={13} />
                            Action requise pour autoriser l'accès :
                          </span>
                          <button
                            onClick={() => copyPermissionCmd(sug.id, sug.permission_help || "")}
                            className="text-xs text-surface-400 hover:text-surface-200 flex items-center gap-1"
                            title="Copier"
                          >
                            <Copy size={12} />
                            {copiedId === sug.id ? "Copié !" : "Copier"}
                          </button>
                        </div>
                        <p className="text-surface-300 font-sans leading-relaxed">
                          {sug.permission_help}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-surface-800/60">
                    <span className="text-2xs text-surface-500">
                      OS: <span className="capitalize">{sug.os}</span> · Hôte: {sug.hostname}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSuggestions(prev => prev.filter(s => s.id !== sug.id))}
                        className="btn-ghost text-xs py-1 px-2.5 text-surface-400 hover:text-surface-200"
                      >
                        Ignorer
                      </button>
                      {(isElevation || isDenied) && (
                        <button
                          onClick={handleRelaunchAdmin}
                          className="text-xs py-1 px-3 rounded font-medium bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-1 shadow-sm transition-colors"
                        >
                          <Zap size={12} className="fill-current" />
                          Élever en Admin (UAC)
                        </button>
                      )}
                      <button
                        onClick={() => acceptSuggestion(sug)}
                        className={`text-xs py-1 px-3 rounded font-medium transition-colors ${
                          isAccessible
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                            : "bg-surface-700 hover:bg-surface-600 text-surface-200"
                        }`}
                      >
                        {isAccessible ? "Surveiller cette source" : "Ajouter quand même"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Source list */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm text-surface-300 flex items-center gap-2">
          <Server size={16} className="text-primary-400" />
          Sources configurées ({sources.length})
        </h3>
        {sources.length === 0 ? (
          <div className="card text-center py-12 text-surface-500">
            <Radio size={32} className="mx-auto mb-3 opacity-50" />
            <p>Aucune source configurée</p>
            <p className="text-sm mt-1">
              Cliquez sur "Auto-détecter hôte" pour configurer automatiquement votre machine
            </p>
          </div>
        ) : (
          sources.map((src) => {
            const OsIcon = osIcons[src.os] || Server;
            return (
              <div
                key={src.id}
                className="card flex items-center justify-between"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className={`p-2 rounded-lg ${src.enabled ? "bg-emerald-500/10" : "bg-surface-800"}`}>
                    <OsIcon size={20} className={src.enabled ? "text-emerald-400" : "text-surface-500"} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{src.name}</p>
                      {src.priority === "critical" && (
                        <span className="text-3xs bg-red-500/20 text-red-400 font-bold px-2 py-0.5 rounded border border-red-500/30 flex items-center gap-1">
                          🔴 Priorité Critique
                        </span>
                      )}
                      {src.priority === "high" && (
                        <span className="text-3xs bg-amber-500/20 text-amber-400 font-bold px-2 py-0.5 rounded border border-amber-500/30 flex items-center gap-1">
                          🟠 Priorité Haute
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-surface-500">
                      {src.hostname} · {formatSourceType(src.source_type)} · {src.os}
                    </p>
                  </div>
                </div>
                
                {/* Priority & Status Controls */}
                <div className="flex items-center gap-3">
                  <select
                    value={src.priority || "normal"}
                    onChange={async (e) => {
                      try {
                        await invoke("update_log_source_priority", { id: src.id, priority: e.target.value });
                        await fetchSources();
                      } catch (err) {
                        console.error("Erreur update_log_source_priority:", err);
                      }
                    }}
                    className="bg-surface-800 border border-surface-700 text-surface-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer"
                    title="Définir le niveau de priorité de surveillance pour cette machine"
                  >
                    <option value="normal">Priorité Normale</option>
                    <option value="high">Priorité Haute 🟠</option>
                    <option value="critical">Priorité Critique 🔴</option>
                  </select>

                  {src.enabled ? (
                    <span className="badge-benign text-2xs">Actif</span>
                  ) : (
                    <span className="badge text-2xs bg-surface-700 text-surface-400 border border-surface-600">
                      Inactif
                    </span>
                  )}
                  <button
                    onClick={() => toggleSource(src.id, !src.enabled)}
                    className={`btn-ghost p-2 ${src.enabled ? "text-amber-400" : "text-emerald-400"}`}
                    title={src.enabled ? "Arrêter" : "Démarrer"}
                  >
                    {src.enabled ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <button
                    onClick={() => removeSource(src.id)}
                    className="btn-ghost p-2 text-red-400"
                    title="Supprimer"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Slide-over Drawer for Add Source */}
      {showAdd && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
            onClick={() => setShowAdd(false)}
          ></div>
          <div className="relative w-full max-w-lg bg-surface-900 h-full border-l border-surface-700 shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out">
            <div className="p-6 border-b border-surface-700 flex items-center justify-between bg-surface-800">
              <h3 className="font-bold text-lg text-white flex items-center gap-2">
                <Plus size={18} className="text-primary-400" />
                Nouvelle source de collecte
              </h3>
              <button onClick={() => setShowAdd(false)} className="text-surface-400 hover:text-white p-2 rounded-lg hover:bg-surface-700 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Quick Presets Catalog */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-surface-300">Templates rapides (Recommandé)</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { setNewType("file_watcher"); setNewName("Logs Nginx (Access)"); setNewPath("/var/log/nginx/access.log"); setNewOs("linux"); }} className="badge bg-surface-800 hover:bg-primary-900/40 text-surface-200 cursor-pointer border border-surface-700">🌐 Nginx Access</button>
                  <button onClick={() => { setNewType("file_watcher"); setNewName("Authentification Linux (Auth)"); setNewPath("/var/log/auth.log"); setNewOs("linux"); }} className="badge bg-surface-800 hover:bg-primary-900/40 text-surface-200 cursor-pointer border border-surface-700">🔐 Linux auth.log</button>
                  <button onClick={() => { setNewType("macos_unified_log"); setNewName("macOS Unified Log (Sécurité)"); setNewOs("macos"); }} className="badge bg-surface-800 hover:bg-primary-900/40 text-surface-200 cursor-pointer border border-surface-700">🍎 macOS Unified Log</button>
                  <button onClick={() => { setNewType("windows_event_log"); setNewName("Windows Event Log (Security)"); setNewChannel("Security"); setNewOs("windows"); }} className="badge bg-surface-800 hover:bg-primary-900/40 text-surface-200 cursor-pointer border border-surface-700">🪟 Windows Security</button>
                </div>
              </div>
              
              <hr className="border-surface-700" />
              
              <form onSubmit={submitAddSource} className="space-y-5">
                <p className="text-sm font-semibold text-surface-300">Configuration Manuelle</p>
                
                <div className="space-y-4">
                  <label className="block">
                    <span className="text-sm font-medium text-surface-300">Nom de la source *</span>
                    <input 
                      type="text" 
                      required
                      placeholder="ex: Logs Nginx Serveur Web" 
                      className="input mt-1.5 w-full bg-surface-800"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                    />
                  </label>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-sm font-medium text-surface-300">OS Hôte</span>
                      <select className="input mt-1.5 w-full bg-surface-800" value={newOs} onChange={e => setNewOs(e.target.value)}>
                        <option value="auto">Auto-détection</option>
                        <option value="linux">Linux</option>
                        <option value="macos">macOS</option>
                        <option value="windows">Windows</option>
                      </select>
                    </label>
                    
                    <label className="block">
                      <span className="text-sm font-medium text-surface-300">Type de connecteur</span>
                      <select className="input mt-1.5 w-full bg-surface-800" value={newType} onChange={e => setNewType(e.target.value)}>
                        <option value="file_watcher">Fichier texte local</option>
                        <option value="journald">Systemd Journald</option>
                        <option value="windows_event_log">Windows Event Log</option>
                        <option value="macos_unified_log">macOS Unified Log</option>
                        <option value="kafka">Apache Kafka (Streaming)</option>
                      </select>
                    </label>
                  </div>
                  
                  {newType === "file_watcher" && (
                    <div className="space-y-4 p-4 bg-surface-800/50 rounded-xl border border-surface-700">
                      <label className="block">
                        <span className="text-sm font-medium text-surface-300">Chemin absolu *</span>
                        <div className="flex gap-2 mt-1.5">
                          <input 
                            type="text" 
                            required
                            placeholder="/var/log/syslog" 
                            className="input flex-1 bg-surface-800"
                            value={newPath}
                            onChange={e => setNewPath(e.target.value)}
                          />
                          <button 
                            type="button" 
                            className="btn-secondary whitespace-nowrap px-3"
                            onClick={async () => {
                              try {
                                const { open } = await import("@tauri-apps/plugin-dialog");
                                const selected = await open({
                                  title: "Sélectionner un fichier log",
                                  multiple: false,
                                  directory: false,
                                });
                                if (selected && typeof selected === "string") {
                                  setNewPath(selected);
                                }
                              } catch(e) {
                                console.warn("Tauri open dialog non disponible:", e);
                              }
                            }}
                          >
                            <FolderOpen size={16} />
                          </button>
                        </div>
                      </label>
                      <label className="block">
                        <span className="text-sm font-medium text-surface-300">Filtre (Glob)</span>
                        <input 
                          type="text" 
                          placeholder="*.log" 
                          className="input mt-1.5 w-full bg-surface-800"
                          value={newPattern}
                          onChange={e => setNewPattern(e.target.value)}
                        />
                      </label>
                      <div className="pt-2">
                        <button 
                          type="button" 
                          onClick={testConnection} 
                          className="btn text-sm w-full bg-surface-700 hover:bg-surface-600 border border-surface-600 flex items-center justify-center gap-2"
                        >
                          <Zap size={16} className="text-amber-400" />
                          Tester la lecture
                        </button>
                      </div>
                    </div>
                  )}

                  {newType === "windows_event_log" && (
                    <label className="block">
                      <span className="text-sm font-medium text-surface-300">Canal Windows Event Log *</span>
                      <select
                        className="input mt-1.5 w-full bg-surface-800"
                        value={["Security", "System", "Application", "Microsoft-Windows-PowerShell/Operational", "Microsoft-Windows-Sysmon/Operational"].includes(newChannel) ? newChannel : "custom"}
                        onChange={(e) => {
                          if (e.target.value !== "custom") {
                            setNewChannel(e.target.value);
                          }
                        }}
                      >
                        <option value="Security">Security (Authentification & Privilèges - Admin)</option>
                        <option value="System">System (Système & Services Windows)</option>
                        <option value="Application">Application (Applications tierces)</option>
                        <option value="Microsoft-Windows-PowerShell/Operational">PowerShell Operational (Exécution de scripts)</option>
                        <option value="Microsoft-Windows-Sysmon/Operational">Sysmon Operational (Télémétrie EDR)</option>
                        <option value="custom">Canal personnalisé...</option>
                      </select>
                      <input 
                        type="text" 
                        required
                        placeholder="Ex: Security" 
                        className="input mt-2 w-full bg-surface-800 font-mono text-xs"
                        value={newChannel}
                        onChange={e => setNewChannel(e.target.value)}
                      />
                    </label>
                  )}
                  
                  {newType === "kafka" && (
                    <div className="space-y-4 p-4 bg-surface-800/50 rounded-xl border border-surface-700">
                      <label className="block">
                        <span className="text-sm font-medium text-surface-300">Topic Kafka *</span>
                        <input
                          type="text"
                          required
                          placeholder="logs"
                          className="input mt-1.5 w-full bg-surface-800 font-mono text-xs"
                          value={newKafkaTopic}
                          onChange={e => setNewKafkaTopic(e.target.value)}
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-medium text-surface-300">Brokers (séparés par virgule) *</span>
                        <input
                          type="text"
                          required
                          placeholder="localhost:9092, kafka-2:9092"
                          className="input mt-1.5 w-full bg-surface-800 font-mono text-xs"
                          value={newKafkaBrokers}
                          onChange={e => setNewKafkaBrokers(e.target.value)}
                        />
                      </label>
                    </div>
                  )}

                  {testResult && (
                    <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${testResult.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                      {testResult.ok ? <Check size={16} /> : <X size={16} />}
                      {testResult.msg}
                    </div>
                  )}
                </div>
              </form>
            </div>
            
            <div className="p-6 border-t border-surface-700 bg-surface-800/50 flex justify-end gap-3">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-ghost">Annuler</button>
              <button type="button" onClick={submitAddSource} className="btn-primary">Enregistrer la source</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
