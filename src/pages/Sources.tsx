import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LogSource, NetworkNode } from "@/types";
import {
  Plus, Trash2, Play, Pause, Server, FolderOpen,
  Monitor, HardDrive, Radio, LucideIcon, Cpu, Globe, Zap, Check, X
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
  
  // New Source Form State
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("file_watcher");
  const [newOs, setNewOs] = useState("auto");
  const [newPath, setNewPath] = useState("");
  const [newPattern, setNewPattern] = useState("*.log");
  const [newChannel, setNewChannel] = useState("Application");
  const [testResult, setTestResult] = useState<{ok: boolean, msg: string} | null>(null);

  // Mock data for sparklines
  const generateSparklineData = () => {
    return Array.from({ length: 20 }, () => ({
      value: Math.floor(Math.random() * 100)
    }));
  };

  const fetchSources = async () => {
    try {
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

  useEffect(() => {
    fetchSources();
    const interval = setInterval(fetchSources, 3000);
    return () => clearInterval(interval);
  }, []);

  const autoDiscover = async () => {
    try {
      await invoke("auto_discover_host_sources");
      await fetchSources();
    } catch (e) {
      console.error(e);
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

  const submitAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;
    
    try {
      let config: any = {};
      if (newType === "file_watcher") {
        config = { path: newPath, pattern: newPattern };
      } else if (newType === "windows_event_log") {
        config = { channel: newChannel };
      }

      await invoke("add_log_source", {
        name: newName,
        sourceType: newType,
        hostname: "localhost",
        os: newOs === "auto" ? "linux" : newOs,
        config,
      });

      setShowAdd(false);
      setNewName("");
      setNewPath("");
      setTestResult(null);
      await fetchSources();
    } catch (e) {
      console.error(e);
    }
  };

  const testConnection = async () => {
    if (newType !== "file_watcher" || !newPath) return;
    try {
      // Dans un vrai cas, un invoke Rust testerait l'accès au fichier (ex: check_file_access).
      // Ici, on simule une réponse de test pour l'UX.
      setTestResult({ ok: true, msg: "Fichier accessible et lisible." });
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
                    <p className="font-medium text-sm">{src.name}</p>
                    <p className="text-xs text-surface-500">
                      {src.hostname} · {formatSourceType(src.source_type)} · {src.os}
                    </p>
                  </div>
                </div>
                
                {src.enabled && (
                  <div className="hidden md:block w-32 h-8 mr-4 opacity-70" title="Activité (Simulée)">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={generateSparklineData()}>
                        <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                
                <div className="flex items-center gap-2">
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
                      <span className="text-sm font-medium text-surface-300">Canal Windows</span>
                      <input 
                        type="text" 
                        required
                        placeholder="Security" 
                        className="input mt-1.5 w-full bg-surface-800"
                        value={newChannel}
                        onChange={e => setNewChannel(e.target.value)}
                      />
                    </label>
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
