import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DetectionRule, AlertLevel } from "@/types";
import { ShieldCheck, Plus, Trash2, ToggleLeft, ToggleRight, Search } from "lucide-react";

export default function Rules() {
  const [rules, setRules] = useState<DetectionRule[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ruleType, setRuleType] = useState<string>("keyword");
  const [pattern, setPattern] = useState("");
  const [severity, setSeverity] = useState<string>("high");
  const [search, setSearch] = useState("");

  const fetchRules = async () => {
    try {
      const r = await invoke<DetectionRule[]>("list_rules");
      setRules(r || []);
    } catch (e) {
      console.error("Erreur list_rules:", e);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !pattern) return;
    try {
      await invoke("add_detection_rule", {
        name,
        description,
        ruleType,
        pattern,
        severity,
      });
      setShowModal(false);
      setName("");
      setDescription("");
      setPattern("");
      await fetchRules();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await invoke("toggle_rule", { ruleId: id, enabled: !enabled });
      await fetchRules();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_rule", { ruleId: id });
      await fetchRules();
    } catch (e) {
      console.error(e);
    }
  };

  const filteredRules = rules.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.pattern.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Règles de Détection</h2>
          <p className="text-sm text-surface-400 mt-1">
            Gestion des signatures, mots-clés, regex et listes d'exclusion
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} />
          Nouvelle Règle
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center gap-4 bg-surface-900 p-3 rounded-xl border border-surface-700">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            placeholder="Filtrer par nom de règle ou motif..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9"
          />
        </div>
        <div className="text-xs text-surface-400">
          {filteredRules.length} règle(s) configurée(s)
        </div>
      </div>

      {/* Rules Grid */}
      <div className="space-y-3">
        {filteredRules.length === 0 ? (
          <div className="card text-center py-12 text-surface-500">
            <ShieldCheck size={36} className="mx-auto mb-3 opacity-50" />
            <p>Aucune règle configurée ou trouvée</p>
          </div>
        ) : (
          filteredRules.map((rule) => (
            <div key={rule.id} className="card flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-lg ${rule.enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-surface-800 text-surface-500"}`}>
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm">{rule.name}</h3>
                    <span className={`badge ${rule.severity === "high" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"} text-3xs`}>
                      {rule.severity.toUpperCase()}
                    </span>
                    <span className="badge bg-surface-700 text-surface-300 text-3xs">
                      {rule.rule_type}
                    </span>
                  </div>
                  <p className="text-xs text-surface-400 mt-1">{rule.description || "Aucune description"}</p>
                  <code className="text-3xs bg-surface-800 px-2 py-0.5 rounded text-primary-300 font-mono mt-1.5 inline-block">
                    Motif: {rule.pattern}
                  </code>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleToggle(rule.id, rule.enabled)}
                  className={`btn-ghost p-1.5 ${rule.enabled ? "text-emerald-400" : "text-surface-500"}`}
                  title={rule.enabled ? "Désactiver" : "Activer"}
                >
                  {rule.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                </button>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="btn-ghost p-2 text-red-400 hover:bg-red-500/10"
                  title="Supprimer"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal Add Rule */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="card max-w-lg w-full space-y-4">
            <h3 className="text-lg font-bold">Créer une Règle de Détection</h3>
            <form onSubmit={handleAddRule} className="space-y-4">
              <div>
                <label className="block text-xs text-surface-400 mb-1">Nom de la règle</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Détection Exfiltration AWS S3"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-xs text-surface-400 mb-1">Description</label>
                <input
                  type="text"
                  placeholder="Description du risque ou du motif"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Type de règle</label>
                  <select
                    value={ruleType}
                    onChange={(e) => setRuleType(e.target.value)}
                    className="input bg-surface-800"
                  >
                    <option value="keyword">Mot-clé</option>
                    <option value="regex">Expression Régulière (Regex)</option>
                    <option value="ip_blacklist">IP Blacklistée</option>
                    <option value="user_blacklist">Utilisateur Suspect</option>
                    <option value="time_window">Fenêtre Temporelle</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Sévérité</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className="input bg-surface-800"
                  >
                    <option value="high">Haute (Critique)</option>
                    <option value="moderate">Modérée</option>
                    <option value="low">Faible</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-surface-400 mb-1">Motif / Pattern</label>
                <input
                  type="text"
                  required
                  placeholder="ex: s3://external-bucket ou [EXFILTRATION]"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  className="input font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">
                  Annuler
                </button>
                <button type="submit" className="btn-primary">
                  Créer la Règle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
