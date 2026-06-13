import { useState, useEffect, useRef } from "react";
import { LayerPageHeader, LayerDisabledBanner } from "@/components/LayerPageHeader";
import { useLayerStatus } from "@/hooks/useLayerStatus";
import { PeriodPicker } from "@/components/PeriodPicker";
import { useStatsPeriod, formatTimeTick } from "@/hooks/useStatsPeriod";
import { Tabs } from "@/components/Tabs";
import { Slider } from "@/components/Slider";
import { StatusPill } from "@/components/StatusPill";
import { LayerTestPanel } from "@/components/LayerTestPanel";
import { api } from "@/api/client";
import type { LayerStatsResponse } from "@/api/types";
import { Database, Trash2, Plus, Upload, TrendingUp, Shield, CheckCircle, AlertTriangle } from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ─── types ────────────────────────────────────────────────────────────────────

interface Layer3Config {
  enabled?: boolean;
  similarity_threshold: number;
}

interface VectorEntry {
  id: string;
  original_text?: string;
  category?: string;
  source?: string;
  created_at?: string;
}

const DEFAULT_CONFIG: Layer3Config = { similarity_threshold: 0.92 };

const CAT_COLORS: Record<string, string> = {
  prompt_injection: "#E5484D",
  jailbreak: "#F5A623",
  exfiltration: "#9758FF",
  harmful_content: "#4A9EFF",
};

// ─── stat card ────────────────────────────────────────────────────────────────

function StatCard({ title, value, sub, icon, accent = false }: {
  title: string; value: string | number; sub?: string; icon: React.ReactNode; accent?: boolean;
}) {
  return (
    <div className="content-card flex items-start gap-4 p-5">
      <div className={`p-2.5 rounded-xl ${accent ? "bg-[rgba(229,72,77,0.12)] text-status-critical" : "bg-surface-3 text-accent"}`}>
        {icon}
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] text-text-secondary">{title}</span>
        <span className="text-[24px] font-bold text-text-primary leading-tight">{value}</span>
        {sub && <span className="text-[12px] text-text-tertiary mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

// ─── statistics tab ───────────────────────────────────────────────────────────

function StatisticsTab() {
  const { period, setPeriod, hours, label } = useStatsPeriod();
  const [stats, setStats]   = useState<LayerStatsResponse | null>(null);
  const [vecCount, setVecCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<LayerStatsResponse>(`/layers/3/stats?hours=${hours}`).catch(() => null),
      api.get<VectorEntry[]>("/vectors?limit=1000").catch(() => []),
    ]).then(([s, vecs]) => {
      setStats(s);
      setVecCount(Array.isArray(vecs) ? vecs.length : 0);
    }).finally(() => setLoading(false));
  }, [hours]);

  const totals  = stats?.totals;
  const total   = totals?.total ?? 0;
  const blocked = totals?.blocked ?? 0;
  const passed  = totals?.passed ?? 0;
  const avgScore = totals?.avg_score ?? null;

  const timelineData = (stats?.timeline ?? []).map(p => ({
    time: p.time,
    blocked: p.blocked,
    passed:  p.passed,
  }));

  const byCat = (stats?.by_category ?? []).map(c => ({
    name:  c.category.replace(/_/g, " "),
    count: c.count,
    raw:   c.category,
  }));

  const empty = (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-text-tertiary">
      <span className="text-[13px]">Данных пока нет</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Period picker */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-secondary">Статистика за период</span>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Запросов проверено"
              value={total.toLocaleString()}
              sub={label}
              icon={<Shield className="w-5 h-5" />}
            />
            <StatCard
              title="Совпадений векторов"
              value={blocked.toLocaleString()}
              sub={total ? `${((blocked / total) * 100).toFixed(1)}% от всех` : "—"}
              icon={<AlertTriangle className="w-5 h-5" />}
              accent={blocked > 0}
            />
            <StatCard
              title="Ср. сходство"
              value={avgScore != null ? avgScore.toFixed(3) : "—"}
              sub="косинусная мера"
              icon={<TrendingUp className="w-5 h-5" />}
            />
            <StatCard
              title="Векторов в БД"
              value={vecCount.toLocaleString()}
              sub="образцы атак"
              icon={<Database className="w-5 h-5" />}
            />
          </div>

          {/* Timeline + Categories */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
            <div className="content-card flex flex-col">
              <h3 className="text-body-strong mb-4">График обнаружений ({label})</h3>
              {timelineData.length === 0 ? empty : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="gradBlock3" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#E5484D" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#E5484D" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
                      <XAxis
                        dataKey="time"
                        axisLine={false} tickLine={false}
                        tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
                        tickFormatter={(v) => formatTimeTick(v, hours)}
                      />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--text-tertiary)", fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }}
                        labelFormatter={(v) => formatTimeTick(String(v), hours)}
                      />
                      <Area type="monotone" dataKey="blocked" stroke="#E5484D" fill="url(#gradBlock3)" strokeWidth={2} name="Заблокировано" />
                      <Area type="monotone" dataKey="passed" stroke="var(--accent)" fill="none" strokeWidth={1.5} strokeDasharray="4 3" name="Прошло" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="content-card flex flex-col">
              <h3 className="text-body-strong mb-4">По категориям ({label})</h3>
              {byCat.length === 0 ? empty : (
                <div style={{ height: Math.max(byCat.length * 44, 100) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byCat} layout="vertical" margin={{ left: 0, right: 36, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "var(--text-tertiary)", fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" width={130} axisLine={false} tickLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="count" barSize={18} radius={[0, 4, 4, 0]}>
                        {byCat.map((entry, i) => (
                          <Cell key={i} fill={CAT_COLORS[entry.raw] ?? "#8E96A3"} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Similarity breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="content-card flex flex-col gap-3">
              <h3 className="text-body-strong">Итоги периода</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Заблокировано", value: blocked, color: "var(--status-critical)" },
                  { label: "Прошло", value: passed, color: "var(--status-success)" },
                  { label: "Подозрительных", value: totals?.suspicious ?? 0, color: "var(--status-warning)" },
                  { label: "Эскалировано", value: totals?.escalated ?? 0, color: "var(--accent)" },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between p-3 bg-surface-2 rounded-xl">
                    <span className="text-[12px] text-text-secondary">{item.label}</span>
                    <span className="text-[14px] font-bold" style={{ color: item.color }}>{item.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="content-card flex flex-col gap-3">
              <h3 className="text-body-strong">Порог косинусного сходства</h3>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-text-secondary">Ср. сходство заблокированных</span>
                  <span className="font-mono font-medium text-status-critical">
                    {avgScore != null ? avgScore.toFixed(3) : "—"}
                  </span>
                </div>
                {avgScore != null && (
                  <div className="w-full h-2 bg-surface-3 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-status-critical transition-all duration-500"
                      style={{ width: `${Math.min(avgScore * 100, 100)}%` }}
                    />
                  </div>
                )}
                <p className="text-[11px] text-text-tertiary mt-1">
                  Значения ≥ порогу (по умолчанию 0.92) вызывают блокировку.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── vector database tab ──────────────────────────────────────────────────────

const CATEGORIES = ["prompt_injection", "jailbreak", "exfiltration", "harmful_content", "other"];

function VectorDatabaseTab() {
  const [vectors, setVectors] = useState<VectorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [addText, setAddText] = useState("");
  const [addCategory, setAddCategory] = useState("prompt_injection");
  const [adding, setAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    api.get<VectorEntry[]>("/vectors?limit=200")
      .then(setVectors)
      .catch(() => setVectors([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!addText.trim()) return;
    setAdding(true);
    setError("");
    try {
      await api.post("/vectors", { text: addText.trim(), category: addCategory, source: "manual" });
      setAddText("");
      load();
    } catch (e: any) {
      setError(e.message ?? "Failed to add vector");
    }
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    setDeleteId(id);
    try {
      await api.delete(`/vectors/${id}`);
      setVectors(prev => prev.filter(v => v.id !== id));
    } catch {}
    setDeleteId(null);
  };

  const handleImport = async () => {
    setImporting(true);
    setError("");
    try {
      const res = await api.post<{ imported: number }>("/vectors/import", {});
      load();
      setError(`Imported ${res.imported} vectors from public attack dataset`);
    } catch (e: any) {
      setError(e.message ?? "Import failed");
    }
    setImporting(false);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* add form */}
      <div className="content-card flex flex-col gap-4">
        <h3 className="text-body-strong">Добавить образец атаки</h3>
        <div className="flex flex-col gap-3">
          <textarea
            value={addText}
            onChange={e => setAddText(e.target.value)}
            placeholder="Введите текст атаки для встраивания в векторную базу данных…"
            rows={3}
            className="w-full bg-surface-1 border border-border-default rounded-xl px-4 py-3 text-[13px] font-mono focus:outline-none focus:border-accent resize-y"
          />
          <div className="flex items-center gap-3">
            <select
              value={addCategory}
              onChange={e => setAddCategory(e.target.value)}
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px]"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              onClick={handleAdd}
              disabled={adding || !addText.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {adding
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Встраивание…</>
                : <><Plus className="w-4 h-4" /> Добавить в БД</>
              }
            </button>
            <button
              onClick={handleImport}
              disabled={importing}
              className="flex items-center gap-2 px-4 py-2 bg-surface-2 border border-border-default text-text-secondary rounded-lg text-[13px] hover:bg-surface-3 disabled:opacity-50 transition-colors ml-auto"
            >
              {importing
                ? <><div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" /> Импорт…</>
                : <><Upload className="w-4 h-4" /> Импортировать датасет</>
              }
            </button>
          </div>
          {error && (
            <p className={`text-[12px] ${error.startsWith("Imported") ? "text-status-success" : "text-status-critical"}`}>
              {error}
            </p>
          )}
        </div>
      </div>

      {/* vector list */}
      <div className="content-card flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-body-strong flex-1">Библиотека векторов атак</h3>
          <span className="text-[12px] text-text-tertiary">{vectors.length} записей</span>
          <button onClick={load} className="text-[12px] text-accent hover:underline">Обновить</button>
        </div>
        {loading ? (
          <div className="flex justify-center p-8">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : vectors.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-text-tertiary">
            <Database className="w-8 h-8 opacity-20" />
            <span className="text-[13px]">Векторов пока нет — добавьте образцы выше или импортируйте датасет</span>
          </div>
        ) : (
          <div className="overflow-auto border border-border-subtle rounded-xl">
            <table className="w-full text-[13px] text-left border-collapse">
              <thead className="bg-surface-2">
                <tr>
                  <th className="px-4 py-2.5 font-medium text-text-secondary border-b border-border-subtle">Текст</th>
                  <th className="px-4 py-2.5 font-medium text-text-secondary border-b border-border-subtle w-36">Категория</th>
                  <th className="px-4 py-2.5 font-medium text-text-secondary border-b border-border-subtle w-24">Источник</th>
                  <th className="px-4 py-2.5 font-medium text-text-secondary border-b border-border-subtle w-14 text-center">Удал.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {vectors.map(v => (
                  <tr key={v.id} className="hover:bg-surface-2">
                    <td className="px-4 py-2.5 text-text-primary max-w-sm">
                      <span className="block truncate">{v.original_text ?? <span className="text-text-tertiary italic">no text</span>}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border"
                        style={{
                          background: (CAT_COLORS[v.category ?? ""] ?? "#8E96A3") + "1A",
                          borderColor: (CAT_COLORS[v.category ?? ""] ?? "#8E96A3") + "40",
                          color: CAT_COLORS[v.category ?? ""] ?? "#8E96A3",
                        }}
                      >
                        {v.category ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-text-tertiary">{v.source ?? "—"}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => handleDelete(v.id)}
                        disabled={deleteId === v.id}
                        className="p-1 rounded hover:bg-[rgba(229,72,77,0.1)] text-text-tertiary hover:text-status-critical transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── configuration tab ────────────────────────────────────────────────────────

function ConfigurationTab({ config, onConfigChange }: {
  config: Layer3Config;
  onConfigChange: (partial: Partial<Layer3Config>) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="content-card flex flex-col gap-6">
        <h3 className="text-body-strong">Модель встраивания</h3>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-text-secondary">Модель</label>
            <select disabled className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[14px] opacity-50 cursor-not-allowed">
              <option>all-MiniLM-L6-v2 (384 измерения)</option>
            </select>
            <span className="text-[11px] text-text-tertiary">Загружается при старте через sentence-transformers.</span>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-text-secondary">Метрика расстояния</label>
            <select disabled className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[14px] opacity-50 cursor-not-allowed">
              <option>Косинусное сходство</option>
            </select>
          </div>
        </div>

        <div className="mt-2">
          <h4 className="text-[13px] font-medium text-text-secondary mb-2">Векторные базы данных</h4>
          <div className="border border-border-default rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-1">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-text-secondary" />
                <span className="text-[13px] font-medium">Qdrant — attack_signatures</span>
              </div>
              <StatusPill status="success" label="Подключено" />
            </div>
          </div>
        </div>
      </div>

      <div className="content-card flex flex-col gap-6">
        <h3 className="text-body-strong">Порог сходства</h3>
        <p className="text-[13px] text-text-secondary leading-relaxed">
          Минимальное косинусное сходство для блокировки запроса. Запрос блокируется, если его
          вектор не дальше этого значения от любого атакующего вектора в базе данных.
        </p>
        <div className="flex items-center gap-4">
          <Slider
            min={0.5} max={1.0} step={0.01}
            value={config.similarity_threshold}
            onChangeValue={v => onConfigChange({ similarity_threshold: v })}
          />
          <span className="font-mono bg-surface-2 px-3 py-1.5 border border-border-default rounded-lg text-text-primary text-[13px] tabular-nums shrink-0">
            {config.similarity_threshold.toFixed(2)}
          </span>
        </div>
        <div className="flex flex-wrap gap-3 text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-success inline-block" />
            <span className="text-text-secondary">Высокий (≥0.95) → только почти точные совпадения</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-warning inline-block" />
            <span className="text-text-secondary">Средний (0.92) → рекомендуется</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-status-critical inline-block" />
            <span className="text-text-secondary">Низкий (≤0.85) → больше ложных срабатываний</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export function Layer3VectorSimilarity() {
  const { status, initFromConfig, handleStatusChange } = useLayerStatus(3);
  const [activeTab, setActiveTab] = useState("Статистика");
  const [config, setConfig] = useState<Layer3Config>(DEFAULT_CONFIG);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get<Partial<Layer3Config>>("/layers/3/config")
      .then(cfg => { setConfig({ ...DEFAULT_CONFIG, ...cfg }); initFromConfig((cfg as any).enabled); })
      .catch(() => {});
  }, []);

  const handleConfigChange = (partial: Partial<Layer3Config>) => {
    setConfig(prev => {
      const next = { ...prev, ...partial };
      if (saveRef.current) clearTimeout(saveRef.current);
      saveRef.current = setTimeout(() => {
        api.put("/layers/3/config", next).catch(() => {});
      }, 500);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      <LayerPageHeader
        title="Слой 3 — Векторный поиск"
        subtitle="Встраивает промпты и сравнивает их с известными векторами атак по косинусному сходству."
        status={status}
        onStatusChange={handleStatusChange}
      />
      {status === "DISABLED" && <LayerDisabledBanner />}

      <Tabs
        tabs={["Статистика", "Конфигурация", "База векторов", "Тестирование"]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "Статистика"      && <StatisticsTab />}
      {activeTab === "Конфигурация"    && <ConfigurationTab config={config} onConfigChange={handleConfigChange} />}
      {activeTab === "База векторов"   && <VectorDatabaseTab />}
      {activeTab === "Тестирование"    && (
        <div className="content-card">
          <LayerTestPanel layerId={3} placeholder="Введите промпт для проверки по векторной базе атак…" />
        </div>
      )}
    </div>
  );
}
