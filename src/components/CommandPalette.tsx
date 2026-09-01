import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  Search,
  LayoutDashboard,
  ScrollText,
  AlertTriangle,
  Settings,
  Radio,
  FileText,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  Trash2,
  Wand2,
  X,
  Zap,
  ArrowRight,
  ExternalLink,
  LucideIcon,
} from "lucide-react";

interface CommandItem {
  id: string;
  title: string;
  category: "Navigation" | "Actions Rapides" | "Outils & Détection";
  icon: LucideIcon;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenWizard: () => void;
}

export default function CommandPalette({ isOpen, onClose, onOpenWizard }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands: CommandItem[] = [
    // Navigation
    {
      id: "nav-dash",
      title: "Aller au Tableau de Bord (Dashboard)",
      category: "Navigation",
      icon: LayoutDashboard,
      shortcut: "1",
      action: () => {
        navigate("/");
        onClose();
      },
    },
    {
      id: "nav-logs",
      title: "Ouvrir le Visualiseur de Logs en Direct",
      category: "Navigation",
      icon: ScrollText,
      shortcut: "2",
      action: () => {
        navigate("/logs");
        onClose();
      },
    },
    {
      id: "nav-alerts",
      title: "Consulter la Liste des Alertes de Sécurité",
      category: "Navigation",
      icon: AlertTriangle,
      shortcut: "3",
      action: () => {
        navigate("/alerts");
        onClose();
      },
    },
    {
      id: "nav-rules",
      title: "Gérer les Règles de Détection & DLP",
      category: "Navigation",
      icon: ShieldCheck,
      shortcut: "4",
      action: () => {
        navigate("/rules");
        onClose();
      },
    },
    {
      id: "nav-sources",
      title: "Gérer les Sources & Collecteurs de Logs",
      category: "Navigation",
      icon: Radio,
      shortcut: "5",
      action: () => {
        navigate("/sources");
        onClose();
      },
    },
    {
      id: "nav-reports",
      title: "Générer et Exporter les Rapports SOC",
      category: "Navigation",
      icon: FileText,
      shortcut: "6",
      action: () => {
        navigate("/reports");
        onClose();
      },
    },
    {
      id: "nav-config",
      title: "Ouvrir les Paramètres & Configuration",
      category: "Navigation",
      icon: Settings,
      shortcut: "7",
      action: () => {
        navigate("/config");
        onClose();
      },
    },

    // Actions Rapides
    {
      id: "action-wizard",
      title: "Lancer l'Assistant Pas-à-Pas (Quick-Setup Wizard)",
      category: "Actions Rapides",
      icon: Wand2,
      shortcut: "Wizard",
      action: () => {
        onClose();
        onOpenWizard();
      },
    },
    {
      id: "action-widget-show",
      title: "Afficher le Mini-Widget Bureau Flottant (HUD)",
      category: "Actions Rapides",
      icon: Sparkles,
      shortcut: "HUD",
      action: async () => {
        try {
          await invoke("toggle_desktop_widget", { show: true });
        } catch (e) {
          console.error(e);
        }
        onClose();
      },
    },
    {
      id: "action-demo-logs",
      title: "Injecter des Logs de Démonstration (Attaques, Fuites DLP, Crashes)",
      category: "Actions Rapides",
      icon: Zap,
      action: async () => {
        try {
          await invoke("generate_demo_logs");
          navigate("/alerts");
        } catch (e) {
          console.error(e);
        }
        onClose();
      },
    },
    {
      id: "action-check-update",
      title: "Vérifier les Mises à Jour Logicielles (OTA GitHub)",
      category: "Actions Rapides",
      icon: RefreshCw,
      action: () => {
        navigate("/config");
        window.dispatchEvent(new CustomEvent("defudelog-check-update"));
        onClose();
      },
    },
    {
      id: "action-purge",
      title: "Accéder à la Purge et Rétention des Données",
      category: "Actions Rapides",
      icon: Trash2,
      action: () => {
        navigate("/config");
        onClose();
      },
    },
  ];

  // Filtrer les commandes selon la saisie
  const filteredCommands = commands.filter((cmd) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return (
      cmd.title.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q) ||
      (cmd.shortcut && cmd.shortcut.toLowerCase().includes(q))
    );
  });

  // Gestion de la recherche personnalisée dans les logs si la recherche ne correspond pas exactement
  const hasCustomQuery = query.trim().length > 0;

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Raccourcis clavier au sein de la palette
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
        } else if (hasCustomQuery) {
          navigate(`/logs?q=${encodeURIComponent(query.trim())}`);
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, hasCustomQuery, query, navigate, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-start justify-center pt-20 px-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface-900 border border-primary-500/40 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden text-surface-100 flex flex-col max-h-[75vh] animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Search Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-surface-800 bg-surface-950/60">
          <Search size={20} className="text-primary-400 mr-3 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent text-sm text-white placeholder-surface-500 outline-none font-medium"
            placeholder="Tapez une commande, une page ou un mot-clé à rechercher... (ex: logs, brute force, HUD)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="p-1 rounded hover:bg-surface-800 text-surface-400 hover:text-white"
            >
              <X size={16} />
            </button>
          )}
          <span className="ml-2 text-3xs font-mono text-surface-400 bg-surface-800 px-2 py-1 rounded border border-surface-700">
            ESC
          </span>
        </div>

        {/* Commands List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = cmd.icon;
              return (
                <div
                  key={cmd.id}
                  onClick={() => cmd.action()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-100 ${
                    isSelected
                      ? "bg-primary-600/20 text-white border border-primary-500/40 shadow-sm"
                      : "text-surface-300 hover:bg-surface-800/60 hover:text-white border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3 truncate">
                    <div
                      className={`p-1.5 rounded-lg ${
                        isSelected
                          ? "bg-primary-500 text-white"
                          : "bg-surface-800 text-surface-400"
                      }`}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="truncate">
                      <p className="text-xs font-semibold truncate">{cmd.title}</p>
                      <p className="text-3xs text-surface-500">{cmd.category}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {cmd.shortcut && (
                      <span className="text-3xs font-mono bg-surface-800 text-surface-400 px-1.5 py-0.5 rounded border border-surface-700">
                        {cmd.shortcut}
                      </span>
                    )}
                    {isSelected && (
                      <ArrowRight size={14} className="text-primary-400 animate-pulse" />
                    )}
                  </div>
                </div>
              );
            })
          ) : hasCustomQuery ? (
            <div
              onClick={() => {
                navigate(`/logs?q=${encodeURIComponent(query.trim())}`);
                onClose();
              }}
              className="p-4 text-center cursor-pointer hover:bg-surface-800/50 rounded-xl transition"
            >
              <Search size={24} className="mx-auto text-primary-400 mb-2" />
              <p className="text-sm font-semibold text-white">
                Rechercher « <span className="text-primary-400">{query}</span> » dans les logs
              </p>
              <p className="text-xs text-surface-400 mt-1">
                Appuyez sur <kbd className="px-1.5 py-0.5 bg-surface-800 rounded text-3xs font-mono">Entrée</kbd> pour filtrer le visualiseur de logs.
              </p>
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-surface-500">
              Aucun résultat correspondant.
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 border-t border-surface-800 bg-surface-950/40 flex items-center justify-between text-3xs text-surface-500 font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ Naviguer</span>
            <span>↵ Exécuter</span>
            <span>ESC Fermer</span>
          </div>
          <span>DefuDelog Quick Command</span>
        </div>
      </div>
    </div>
  );
}
