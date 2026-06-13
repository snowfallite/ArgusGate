import { useState, useEffect, useCallback, useRef } from "react";
import { LayerPageHeader, LayerDisabledBanner } from "@/components/LayerPageHeader";
import { useLayerStatus } from "@/hooks/useLayerStatus";
import { PeriodPicker } from "@/components/PeriodPicker";
import { useStatsPeriod } from "@/hooks/useStatsPeriod";
import { Tabs } from "@/components/Tabs";
import { Switch } from "@/components/Switch";
import { StatusPill } from "@/components/StatusPill";
import { Plus, X, Trash2, Pencil, Search, Zap, ShieldCheck, ShieldOff, TrendingUp, Clock } from "lucide-react";
import { api } from "@/api/client";
import type { SignatureRead, LayerStatsResponse } from "@/api/types";
import { LayerTestPanel } from "@/components/LayerTestPanel";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend,
} from "recharts";

// ─── helpers ────────────────────────────────────────────────────────────────

const CATEGORIES = ["prompt_injection", "jailbreak", "pii", "secret_leak", "other"];
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
type Sev = (typeof SEVERITIES)[number];

function sevStatus(sev: string): "critical" | "warning" | "info" | "success" {
  switch (sev) {
    case "critical": return "critical";
    case "high":     return "warning";
    case "medium":   return "info";
    default:         return "success";
  }
}

function genId(prefix = "sig_custom"): string {
  return `${prefix}_${Date.now().toString(36)}`;
}

// ─── form state ─────────────────────────────────────────────────────────────

interface FormState {
  id: string;
  name: string;
  pattern: string;
  pattern_type: "regex" | "keyword";
  category: string;
  severity: Sev;
  enabled: boolean;
}

function emptyForm(defaults?: Partial<FormState>): FormState {
  return {
    id: "",
    name: "",
    pattern: "",
    pattern_type: "regex",
    category: "prompt_injection",
    severity: "medium",
    enabled: true,
    ...defaults,
  };
}

// ─── modal ──────────────────────────────────────────────────────────────────

interface SigModalProps {
  initial: FormState | null; // null = create
  onSave: (f: FormState) => Promise<void>;
  onClose: () => void;
}

function SigModal({ initial, onSave, onClose }: SigModalProps) {
  const isEdit = initial !== null && initial.id !== "";
  const [form, setForm] = useState<FormState>(initial ?? emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [patternError, setPatternError] = useState("");

  const validatePattern = (pattern: string, type: string) => {
    if (type === "regex" && pattern.trim()) {
      try {
        new RegExp(pattern);
        setPatternError("");
      } catch (e: any) {
        setPatternError(`Невалидный regex: ${e.message}`);
      }
    } else {
      setPatternError("");
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === "pattern" || k === "pattern_type") {
        validatePattern(
          k === "pattern" ? (v as string) : f.pattern,
          k === "pattern_type" ? (v as string) : f.pattern_type,
        );
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.pattern.trim() || patternError) return;
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, id: form.id || genId() };
      await onSave(payload);
    } catch (e: any) {
      setError(e.message || "Не удалось сохранить подпись");
    }
    setSaving(false);
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-surface-1 border border-border-subtle rounded-2xl shadow-2xl w-full max-w-lg flex flex-col pointer-events-auto max-h-[90vh]"
          onClick={e => e.stopPropagation()}
        >
          {/* header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0">
            <h2 className="text-[16px] font-semibold">
              {isEdit ? "Редактировать сигнатуру" : "Создать сигнатуру"}
            </h2>
            <button onClick={onClose} className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* body */}
          <div className="overflow-y-auto p-6 flex flex-col gap-5">
            {/* name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium">Название</label>
              <input
                value={form.name}
                onChange={e => set("name", e.target.value)}
                placeholder="e.g. ignore_previous_instructions"
                className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {/* type row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium">Тип паттерна</label>
                <select
                  value={form.pattern_type}
                  onChange={e => set("pattern_type", e.target.value as "regex" | "keyword")}
                  className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="regex">Regex</option>
                  <option value="keyword">Keyword</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium">Категория</label>
                <select
                  value={form.category}
                  onChange={e => set("category", e.target.value)}
                  className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c.replace("_", " ")}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* pattern */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium">Паттерн</label>
              <textarea
                value={form.pattern}
                onChange={e => set("pattern", e.target.value)}
                placeholder={form.pattern_type === "regex" ? "(?i)ignore\\s+all\\s+previous" : "ignore all previous instructions"}
                rows={3}
                className={`bg-surface-2 border rounded-lg px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-accent resize-none ${patternError ? "border-status-critical" : "border-border-default"}`}
              />
              {patternError && (
                <p className="text-[11px] text-status-critical">{patternError}</p>
              )}
            </div>

            {/* severity */}
            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-medium">Серьёзность</label>
              <div className="flex gap-3">
                {SEVERITIES.map(s => (
                  <label key={s} className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border cursor-pointer text-[13px] font-medium capitalize transition-colors ${
                    form.severity === s
                      ? s === "critical" ? "bg-[rgba(229,72,77,0.15)] border-status-critical text-status-critical"
                      : s === "high" ? "bg-[rgba(245,166,35,0.15)] border-status-warning text-status-warning"
                      : s === "medium" ? "bg-[rgba(74,158,255,0.15)] border-status-info text-status-info"
                      : "bg-[rgba(70,167,88,0.15)] border-status-success text-status-success"
                      : "border-border-default text-text-secondary hover:bg-surface-2"
                  }`}>
                    <input
                      type="radio"
                      className="sr-only"
                      checked={form.severity === s}
                      onChange={() => set("severity", s)}
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>

            {/* enabled */}
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">Включена</span>
              <Switch checked={form.enabled} onChange={v => set("enabled", v)} />
            </div>

            {error && <p className="text-[12px] text-status-critical">{error}</p>}
          </div>

          {/* footer */}
          <div className="px-6 py-4 border-t border-border-subtle flex justify-end gap-3 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || !form.name.trim() || !form.pattern.trim() || !!patternError}
              className="px-5 py-2 rounded-lg bg-accent text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── signatures table ────────────────────────────────────────────────────────

interface SigTableProps {
  signatures: SignatureRead[];
  onEdit: (s: SignatureRead) => void;
  onDelete: (id: string) => void;
  onToggle: (s: SignatureRead) => void;
  onCreate: () => void;
  createDefaults?: Partial<FormState>;
  emptyText?: string;
  showCategory?: boolean;
}

function SigTable({ signatures, onEdit, onDelete, onToggle, onCreate, emptyText, showCategory = true }: SigTableProps) {
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filtered = search.trim()
    ? signatures.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.pattern.toLowerCase().includes(search.toLowerCase())
      )
    : signatures;

  return (
    <div className="content-card flex flex-col flex-1 min-h-0 p-0 overflow-hidden">
      {/* toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle bg-surface-2/50 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию или паттерну…"
            className="w-full bg-surface-1 border border-border-default rounded-lg pl-8 pr-3 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-[13px] font-medium hover:opacity-90 transition-opacity shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> Добавить
        </button>
      </div>

      {/* table */}
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-text-tertiary text-[13px] p-8">
          {search ? "Совпадений нет" : emptyText ?? "Сигнатур нет — добавьте выше"}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[13px] text-left border-collapse">
            <thead className="bg-surface-2 sticky top-0 z-10 border-b border-border-subtle">
              <tr>
                <th className="px-4 py-2.5 font-medium text-text-secondary w-12">Вкл</th>
                <th className="px-4 py-2.5 font-medium text-text-secondary">Название</th>
                <th className="px-4 py-2.5 font-medium text-text-secondary max-w-[220px]">Паттерн</th>
                {showCategory && <th className="px-4 py-2.5 font-medium text-text-secondary">Категория</th>}
                <th className="px-4 py-2.5 font-medium text-text-secondary">Серьёзность</th>
                <th className="px-4 py-2.5 font-medium text-text-secondary text-right">Срабатываний</th>
                <th className="px-4 py-2.5 w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filtered.map(sig => (
                <tr key={sig.id} className="hover:bg-surface-2 transition-colors group">
                  <td className="px-4 py-2.5">
                    <Switch checked={sig.enabled} onChange={() => onToggle(sig)} />
                  </td>
                  <td className="px-4 py-2.5 font-medium text-text-primary">{sig.name}</td>
                  <td className="px-4 py-2.5 max-w-[220px]">
                    <span
                      className="block truncate font-mono text-[11px] bg-surface-3 border border-border-subtle px-1.5 py-0.5 rounded text-text-secondary"
                      title={sig.pattern}
                    >
                      {sig.pattern}
                    </span>
                  </td>
                  {showCategory && (
                    <td className="px-4 py-2.5">
                      <span className="px-1.5 py-0.5 rounded bg-surface-3 border border-border-default text-text-secondary text-[11px] uppercase tracking-wide">
                        {(sig.category ?? "—").replace("_", " ")}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    <StatusPill status={sevStatus(sig.severity ?? "low")} label={sig.severity ?? "—"} />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-text-secondary text-right">{sig.hit_count}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                      <button
                        onClick={() => onEdit(sig)}
                        className="p-1 rounded text-text-tertiary hover:text-accent hover:bg-surface-3 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {confirmDelete === sig.id ? (
                        <>
                          <button
                            onClick={() => { onDelete(sig.id); setConfirmDelete(null); }}
                            className="px-2 py-0.5 rounded bg-status-critical text-white text-[11px] font-medium"
                          >
                            Удалить
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="px-2 py-0.5 rounded bg-surface-3 text-text-secondary text-[11px]"
                          >
                            Отмена
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(sig.id)}
                          className="p-1 rounded text-text-tertiary hover:text-status-critical hover:bg-surface-3 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── statistics ─────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  prompt_injection: "#E5484D",
  jailbreak:        "#F5A623",
  pii:              "#9758FF",
  secret_leak:      "#4A9EFF",
  other:            "#8E96A3",
};
const SEV_COLORS: Record<string, string> = {
  critical: "#E5484D",
  high:     "#F5A623",
  medium:   "#4A9EFF",
  low:      "#46A758",
};

interface AuditEvent {
  id: string;
  timestamp: string;
  request_text: string;
  verdict: string;
  matched_rule: string | null;
  category: string | null;
  latency_ms: number | null;
}

interface MetricCardProps { title: string; value: string | number; sub?: string; icon: React.ReactNode; color?: string; }
function StatCard({ title, value, sub, icon, color = "text-accent" }: MetricCardProps) {
  return (
    <div className="content-card flex items-start gap-4 p-5">
      <div className={`p-2.5 rounded-xl bg-surface-3 ${color}`}>{icon}</div>
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] text-text-secondary">{title}</span>
        <span className="text-[24px] font-bold text-text-primary leading-tight">{value}</span>
        {sub && <span className="text-[12px] text-text-tertiary mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

function StatisticsTab({ signatures }: { signatures: SignatureRead[] }) {
  const { period, setPeriod, hours } = useStatsPeriod("24h");
  const [stats, setStats] = useState<LayerStatsResponse | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    setLoadingStats(true);
    api.get<LayerStatsResponse>(`/layers/2/stats?hours=${hours}`)
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoadingStats(false));
  }, [hours]);

  // All-time catalog stats (from signatures prop)
  const enabled   = signatures.filter(s => s.enabled).length;
  const disabled  = signatures.length - enabled;
  const bySeverity = Object.entries(
    signatures.reduce<Record<string, number>>((acc, s) => {
      acc[s.severity ?? "low"] = (acc[s.severity ?? "low"] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([name, count]) => ({ name, count }));

  // Period stats (from server endpoint)
  const t        = stats?.totals;
  const detected = (t?.blocked ?? 0) + (t?.suspicious ?? 0);
  const avgLat   = t?.avg_latency_ms != null ? `${t.avg_latency_ms.toFixed(1)}ms` : "—";
  const topCat   = stats?.by_category[0]?.category?.replace(/_/g, " ") ?? "—";

  const catData  = (stats?.by_category ?? []).map(c => ({
    name: c.category.replace(/_/g, " "),
    raw:  c.category,
    hits: c.count,
  }));
  const maxCatCount = Math.max(...(stats?.by_category ?? []).map(c => c.count), 1);

  return (
    <div className="flex flex-col gap-6">
      {/* Period picker */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-secondary">Период статистики</span>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Всего сигнатур"
          value={signatures.length}
          sub={`${enabled} включено · ${disabled} выкл`}
          icon={<ShieldCheck className="w-5 h-5" />}
          color="text-accent"
        />
        <StatCard
          title="Обнаружено за период"
          value={detected.toLocaleString()}
          sub="блокировок и подозрений"
          icon={<Zap className="w-5 h-5" />}
          color="text-status-warning"
        />
        <StatCard
          title="Активных правил"
          value={enabled}
          sub={`${disabled} отключено`}
          icon={<TrendingUp className="w-5 h-5" />}
          color="text-status-success"
        />
        <StatCard
          title="Ср. задержка L2"
          value={avgLat}
          sub={topCat !== "—" ? `топ: ${topCat}` : "данных нет"}
          icon={<Clock className="w-5 h-5" />}
          color="text-status-info"
        />
      </div>

      {loadingStats ? (
        <div className="flex justify-center p-12">
          <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Charts row */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6">
            {/* Top patterns leaderboard (period-based) */}
            <div className="content-card flex flex-col">
              <h3 className="text-body-strong mb-4">Топ категорий за период</h3>
              {catData.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-text-tertiary text-[13px]">
                  Обнаружений за период нет
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {catData.slice(0, 8).map((c, i) => {
                    const pct = (c.hits / maxCatCount) * 100;
                    return (
                      <div key={c.raw} className="flex items-center gap-3">
                        <span className="text-[11px] font-mono text-text-tertiary w-4 shrink-0">{i + 1}</span>
                        <span className="text-[13px] text-text-primary flex-1 truncate">{c.name}</span>
                        <div className="w-28 h-2 bg-surface-3 rounded-full overflow-hidden shrink-0">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: CAT_COLORS[c.raw] ?? "#8E96A3" }}
                          />
                        </div>
                        <span
                          className="text-[11px] font-mono px-2 py-0.5 rounded shrink-0"
                          style={{ background: `${CAT_COLORS[c.raw] ?? "#8E96A3"}18`, color: CAT_COLORS[c.raw] ?? "#8E96A3" }}
                        >
                          {c.hits}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right column: category pie + severity */}
            <div className="flex flex-col gap-6">
              <div className="content-card flex flex-col">
                <h3 className="text-body-strong mb-4">Распределение по категориям</h3>
                {catData.length === 0 ? (
                  <div className="h-36 flex items-center justify-center text-text-tertiary text-[13px]">Данных пока нет</div>
                ) : (
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={catData} dataKey="hits" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={3}>
                          {catData.map((c) => <Cell key={c.raw} fill={CAT_COLORS[c.raw] ?? "#8E96A3"} />)}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "12px" }} formatter={(v: number, name: string) => [`${v}`, name]} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px", color: "var(--text-secondary)" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="content-card flex flex-col">
                <h3 className="text-body-strong mb-2">Серьёзность сигнатур</h3>
                <p className="text-[11px] text-text-tertiary mb-3">Из каталога (все время)</p>
                <div className="flex flex-col gap-2">
                  {(["critical", "high", "medium", "low"] as const).map(sev => {
                    const count = bySeverity.find(b => b.name === sev)?.count ?? 0;
                    const pct = signatures.length ? (count / signatures.length) * 100 : 0;
                    return (
                      <div key={sev} className="flex items-center gap-3">
                        <span className="w-16 text-[12px] text-text-secondary capitalize">{sev}</span>
                        <div className="flex-1 h-2 bg-surface-3 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: SEV_COLORS[sev] }} />
                        </div>
                        <span className="w-8 text-[12px] font-mono text-text-secondary text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export function Layer2Signatures() {
  const { status, initFromConfig, handleStatusChange } = useLayerStatus(2);
  const [activeTab, setActiveTab] = useState("Статистика");
  const [signatures, setSignatures] = useState<SignatureRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [piiAction, setPiiAction] = useState<"suspicious" | "block" | "pass">("suspicious");

  // modal state
  const [modal, setModal] = useState<{ open: boolean; initial: FormState | null }>({ open: false, initial: null });

  const reload = useCallback(async () => {
    const [sigs, cfg] = await Promise.all([
      api.get<SignatureRead[]>("/signatures"),
      api.get<{ enabled: boolean; pii_action: string }>("/layers/2/config"),
    ]);
    setSignatures(sigs);
    setPiiAction(cfg.pii_action as "suspicious" | "block" | "pass");
    initFromConfig(cfg.enabled);
  }, []);

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  // filter helpers
  const regexSigs = signatures.filter(s => s.pattern_type === "regex" && s.category !== "pii" && s.category !== "secret_leak");
  const keywordSigs = signatures.filter(s => s.pattern_type === "keyword" && s.category !== "pii" && s.category !== "secret_leak");
  const piiSigs = signatures.filter(s => s.category === "pii");
  const secretSigs = signatures.filter(s => s.category === "secret_leak");

  const [crudError, setCrudError] = useState<string | null>(null);

  // crud handlers
  const handleSave = async (form: FormState) => {
    const isEdit = signatures.some(s => s.id === form.id);
    if (isEdit) {
      await api.put<SignatureRead>(`/signatures/${form.id}`, form);
    } else {
      await api.post<SignatureRead>("/signatures", { ...form, id: form.id || genId() });
    }
    await reload();
    setModal({ open: false, initial: null });
  };

  const handleToggle = async (sig: SignatureRead) => {
    setCrudError(null);
    try {
      const updated = { ...sig, enabled: !sig.enabled };
      await api.put<SignatureRead>(`/signatures/${sig.id}`, updated);
      setSignatures(prev => prev.map(s => s.id === sig.id ? { ...s, enabled: !s.enabled } : s));
    } catch (e: any) {
      setCrudError(e.message ?? "Не удалось обновить подпись");
    }
  };

  const handleDelete = async (id: string) => {
    setCrudError(null);
    try {
      await api.delete(`/signatures/${id}`);
      setSignatures(prev => prev.filter(s => s.id !== id));
    } catch (e: any) {
      setCrudError(e.message ?? "Не удалось удалить подпись");
    }
  };

  const openCreate = (defaults?: Partial<FormState>) =>
    setModal({ open: true, initial: emptyForm(defaults) });

  const openEdit = (sig: SignatureRead) =>
    setModal({
      open: true,
      initial: {
        id: sig.id,
        name: sig.name,
        pattern: sig.pattern,
        pattern_type: sig.pattern_type as "regex" | "keyword",
        category: sig.category ?? "other",
        severity: (sig.severity ?? "medium") as Sev,
        enabled: sig.enabled,
      },
    });

  const tableProps = { onEdit: openEdit, onDelete: handleDelete, onToggle: handleToggle };

  const piiSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePiiAction = (val: "suspicious" | "block" | "pass") => {
    setPiiAction(val);
    if (piiSaveRef.current) clearTimeout(piiSaveRef.current);
    piiSaveRef.current = setTimeout(() => {
      api.put("/layers/2/config", { pii_action: val }).catch(() => {});
    }, 400);
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      {crudError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg text-[13px] bg-[rgba(229,72,77,0.08)] border border-[rgba(229,72,77,0.2)] text-status-critical">
          <span className="w-1.5 h-1.5 rounded-full bg-status-critical shrink-0" />
          {crudError}
          <button onClick={() => setCrudError(null)} className="ml-auto text-text-tertiary hover:text-text-primary">✕</button>
        </div>
      )}
      <LayerPageHeader
        title="Слой 2 — Сигнатуры"
        subtitle="Быстрое детерминированное сопоставление паттернов для известных атак, PII и секретов."
        status={status}
        onStatusChange={handleStatusChange}
      />
      {status === "DISABLED" && <LayerDisabledBanner />}

      <Tabs
        tabs={["Статистика", "Regex", "Ключевые слова", "Обнаружение PII", "Обнаружение секретов", "Тестирование"]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {loading ? (
        <div className="flex items-center justify-center p-16">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {activeTab === "Статистика" && (
            <StatisticsTab signatures={signatures} />
          )}

          {activeTab === "Regex" && (
            <div className="flex flex-col gap-0 flex-1" style={{ minHeight: "400px" }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] text-text-secondary">
                  {regexSigs.length} regex-паттернов — инъекции промптов, jailbreak и пользовательские правила атак.
                </p>
              </div>
              <SigTable
                signatures={regexSigs}
                onCreate={() => openCreate({ pattern_type: "regex", category: "prompt_injection" })}
                emptyText="Regex-сигнатур пока нет"
                showCategory
                {...tableProps}
              />
            </div>
          )}

          {activeTab === "Ключевые слова" && (
            <div className="flex flex-col gap-0 flex-1" style={{ minHeight: "400px" }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] text-text-secondary">
                  {keywordSigs.length} паттернов по ключевым словам — быстрый поиск точных совпадений без regex.
                </p>
              </div>
              <SigTable
                signatures={keywordSigs}
                onCreate={() => openCreate({ pattern_type: "keyword", category: "prompt_injection" })}
                emptyText="Ключевых слов пока нет"
                showCategory
                {...tableProps}
              />
            </div>
          )}

          {activeTab === "Обнаружение PII" && (
            <div className="flex flex-col gap-6">
              {/* action config */}
              <div className="content-card flex flex-col gap-4">
                <h3 className="text-body-strong">Действие при обнаружении PII</h3>
                <div className="flex gap-3">
                  {(["suspicious", "block", "pass"] as const).map(a => (
                    <label
                      key={a}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border cursor-pointer text-[13px] font-medium capitalize transition-colors ${
                        piiAction === a
                          ? a === "block"
                            ? "bg-[rgba(229,72,77,0.12)] border-status-critical text-status-critical"
                            : a === "suspicious"
                            ? "bg-[rgba(245,166,35,0.12)] border-status-warning text-status-warning"
                            : "bg-[rgba(70,167,88,0.12)] border-status-success text-status-success"
                          : "border-border-default text-text-secondary hover:bg-surface-2"
                      }`}
                    >
                      <input type="radio" className="sr-only" checked={piiAction === a} onChange={() => handlePiiAction(a)} />
                      {{ suspicious: "подозрительно", block: "блок", pass: "пропуск" }[a]}
                    </label>
                  ))}
                </div>
                <p className="text-[12px] text-text-tertiary">
                  <strong>подозрительно</strong> — пометить, но пропустить &nbsp;·&nbsp;
                  <strong>блок</strong> — отклонить запрос немедленно &nbsp;·&nbsp;
                  <strong>пропуск</strong> — только аудит, без действия
                </p>
              </div>

              {/* pii signature table */}
              <div style={{ minHeight: "360px", display: "flex", flexDirection: "column" }}>
                <p className="text-[13px] text-text-secondary mb-3">
                  {piiSigs.length} PII-паттернов — карты, паспорта, ИНН, телефоны.
                </p>
                <SigTable
                  signatures={piiSigs}
                  onCreate={() => openCreate({ pattern_type: "regex", category: "pii" })}
                  emptyText="PII-паттернов нет"
                  showCategory={false}
                  {...tableProps}
                />
              </div>
            </div>
          )}

          {activeTab === "Обнаружение секретов" && (
            <div className="flex flex-col gap-0 flex-1" style={{ minHeight: "400px" }}>
              <p className="text-[13px] text-text-secondary mb-3">
                {secretSigs.length} секретных паттернов — API-ключи, токены, учётные данные, которые не должны попадать в промпты.
              </p>
              <SigTable
                signatures={secretSigs}
                onCreate={() => openCreate({ pattern_type: "regex", category: "secret_leak" })}
                emptyText="Секретных паттернов нет"
                showCategory={false}
                {...tableProps}
              />
            </div>
          )}

          {activeTab === "Тестирование" && (
            <div className="content-card">
              <LayerTestPanel
                layerId={2}
                placeholder="Вставьте текст для проверки по всем сигнатурам (напр. Please ignore all previous instructions)"
              />
            </div>
          )}
        </>
      )}

      {modal.open && (
        <SigModal
          initial={modal.initial}
          onSave={handleSave}
          onClose={() => setModal({ open: false, initial: null })}
        />
      )}
    </div>
  );
}
