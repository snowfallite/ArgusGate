import React, { useState, useRef, useEffect, useCallback } from "react";
import { LayerPageHeader, LayerDisabledBanner } from "@/components/LayerPageHeader";
import { useLayerStatus } from "@/hooks/useLayerStatus";
import { PeriodPicker } from "@/components/PeriodPicker";
import { useStatsPeriod, formatTimeTick } from "@/hooks/useStatsPeriod";
import { Tabs } from "@/components/Tabs";
import { Info, TrendingUp, Shield, AlertTriangle, CheckCircle, Activity, Cpu, RefreshCw, Play } from "lucide-react";
import { LayerTestPanel } from "@/components/LayerTestPanel";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import type { LayerStatsResponse } from "@/api/types";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { ScoreHistogramCard, DistributionData } from "@/components/layer4/ScoreHistogramCard";
import { QualityCard, QualityData } from "@/components/layer4/QualityCard";
import { type RuntimeInfo } from "@/components/layer4/AdapterInfoCard";
import { ActiveModelCard } from "@/components/layer4/ActiveModelCard";
import { DeviceCard } from "@/components/layer4/DeviceCard";

interface Layer4Config {
  enabled?: boolean;
  threshold_pass: number;
  threshold_block: number;
}

const DEFAULT_CONFIG: Layer4Config = { threshold_pass: 0.4, threshold_block: 0.85 };

interface MLModelOut {
  id: string;
  name: string;
  type: string | null;
  base_model: string | null;
  target_layer: number | null;
  file_path: string | null;
  size_mb: number | null;
  metrics: { precision?: number; recall?: number; f1?: number } | null;
  is_active: boolean;
  created_at: string | null;
}

interface ActivationResult {
  success: boolean;
  error?: string | null;
  fallback?: string | null;
  active_path?: string | null;
}

interface ActivateResponse {
  activated: boolean;
  model_id: string;
  activation_result: ActivationResult;
}

interface EvalResult {
  precision?: number;
  recall?: number;
  f1?: number;
  accuracy?: number;
  sample_count?: number;
}

// ─── Adapter Selector card (§4.4.1) ───────────────────────────────────────────

function AdapterSelectorCard({ refreshKey = 0, onActivated }: { refreshKey?: number; onActivated?: () => void | Promise<void> }) {
  const [models, setModels] = useState<MLModelOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.get<MLModelOut[]>("/models");
      setModels(all.filter(m => m.target_layer === 4));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const activeModel = models.find(m => m.is_active);

  const deactivate = async () => {
    setActivating("__base__");
    setMsg(null);
    try {
      await api.post("/layers/4/deactivate-adapter");
      setMsg({ type: "success", text: "Переключено на базовую модель" });
      load();
      await onActivated?.();
    } catch (e: any) {
      setMsg({ type: "error", text: e.message ?? "Не удалось переключить" });
    }
    setActivating(null);
  };

  const activate = async (modelId: string) => {
    setActivating(modelId);
    setMsg(null);
    try {
      const res = await api.post<ActivateResponse>(`/models/${modelId}/activate`);
      if (res.activation_result.success) {
        setMsg({ type: "success", text: "Адаптер активирован" });
        await onActivated?.();
      } else {
        setMsg({
          type: "error",
          text: `Ошибка: ${res.activation_result.error}. Откат на ${res.activation_result.fallback ?? "?"}`,
        });
      }
      load();
    } catch (e: any) {
      setMsg({ type: "error", text: e.message ?? "Не удалось активировать" });
    }
    setActivating(null);
  };

  const runEval = async () => {
    setEvaluating(true);
    setEvalResult(null);
    try {
      const params = activeModel ? `?model_id=${activeModel.id}` : "";
      const res = await api.post<EvalResult>(`/models/eval${params}`);
      setEvalResult(res);
    } catch (e: any) {
      setMsg({ type: "error", text: e.message ?? "Eval упал" });
    }
    setEvaluating(false);
  };

  return (
    <div className="content-card flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-body-strong flex items-center gap-2">
          <Cpu className="w-4 h-4" /> Адаптеры
        </h3>
        <button onClick={load} disabled={loading} className="p-1 rounded-md hover:bg-surface-3 text-text-tertiary">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <p className="text-[12px] text-text-secondary">
        Выберите обученный LoRA-адаптер для использования в Слое 4. По умолчанию работает базовая модель.
      </p>

      {loading ? (
        <div className="h-24 bg-surface-2 rounded-lg animate-pulse" />
      ) : models.length === 0 ? (
        <div className="text-[12px] text-text-tertiary italic px-3 py-4 bg-surface-2 rounded-md text-center">
          Нет обученных адаптеров. Запустите обучение на странице «Датасеты и обучение».
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
          {/* Base model option */}
          <div className={cn(
            "flex items-center justify-between px-3 py-2 rounded-md border",
            !activeModel ? "border-accent bg-[rgba(74,158,255,0.08)]" : "border-border-default bg-surface-2"
          )}>
            <div className="flex items-center gap-2">
              {!activeModel && <CheckCircle className="w-3.5 h-3.5 text-accent" />}
              <div className="flex flex-col">
                <span className="text-[12px] font-medium">Базовая модель (без адаптера)</span>
                <span className="text-[10px] text-text-tertiary font-mono">protectai/deberta-v3-base-prompt-injection-v2</span>
              </div>
            </div>
            {!activeModel
              ? <span className="text-[10px] uppercase text-accent font-bold">активна</span>
              : (
                <button
                  onClick={deactivate}
                  disabled={activating !== null}
                  className="px-2.5 py-1 text-[11px] bg-surface-2 border border-border-default text-text-secondary rounded hover:border-accent hover:text-text-primary disabled:opacity-50 shrink-0"
                >
                  {activating === "__base__" ? "..." : "Активировать"}
                </button>
              )
            }
          </div>

          {/* Adapters */}
          {models.map(m => {
            const isActive = m.is_active;
            const f1 = m.metrics?.f1;
            return (
              <div key={m.id} className={cn(
                "flex items-center justify-between px-3 py-2 rounded-md border",
                isActive ? "border-accent bg-[rgba(74,158,255,0.08)]" : "border-border-default bg-surface-2"
              )}>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {isActive && <CheckCircle className="w-3.5 h-3.5 text-accent shrink-0" />}
                  <div className="flex flex-col min-w-0">
                    <span className="text-[12px] font-medium truncate">{m.name}</span>
                    <span className="text-[10px] text-text-tertiary">
                      {m.created_at ? new Date(m.created_at).toLocaleDateString() : "—"} ·
                      {m.size_mb ? ` ${m.size_mb.toFixed(1)} MB` : ""}
                      {f1 !== undefined ? ` · F1=${f1.toFixed(3)}` : ""}
                    </span>
                  </div>
                </div>
                {isActive ? (
                  <span className="text-[10px] uppercase text-accent font-bold ml-2 shrink-0">активен</span>
                ) : (
                  <button
                    onClick={() => activate(m.id)}
                    disabled={activating !== null}
                    className="px-2.5 py-1 text-[11px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-50 shrink-0"
                  >
                    {activating === m.id ? "..." : "Активировать"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {msg && (
        <div className={cn(
          "text-[12px] px-3 py-2 rounded-md",
          msg.type === "success" ? "bg-[rgba(70,167,88,0.1)] text-status-success" : "bg-[rgba(229,72,77,0.1)] text-status-critical"
        )}>
          {msg.text}
        </div>
      )}

      {/* Eval button */}
      <div className="pt-3 border-t border-border-subtle">
        <button
          onClick={runEval}
          disabled={evaluating}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-3 border border-border-default rounded-md text-[12px] disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" />
          {evaluating ? "Запуск eval…" : `Eval на встроенном наборе ${activeModel ? "(адаптер)" : "(базовая)"}`}
        </button>

        {evalResult && (
          <div className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
            {[
              { label: "Precision", value: evalResult.precision },
              { label: "Recall", value: evalResult.recall },
              { label: "F1", value: evalResult.f1 },
              { label: "Accuracy", value: evalResult.accuracy },
            ].map(({ label, value }) => (
              <div key={label} className="bg-surface-2 px-2 py-1.5 rounded border border-border-subtle">
                <div className="text-text-tertiary">{label}</div>
                <div className="font-mono font-bold">{value !== undefined ? value.toFixed(3) : "—"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface AuditEvent {
  id: string;
  timestamp: string;
  request_text: string;
  verdict: string;
  category: string | null;
  score: number | null;
  latency_ms: number | null;
}

// ─── dual threshold slider ────────────────────────────────────────────────────

function ThresholdBands({
  value,
  onChange,
}: {
  value: [number, number];
  onChange: (val: [number, number]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<number | null>(null);

  const handlePointerDown = (index: number, e: React.PointerEvent) => {
    setIsDragging(index);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging === null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newVal = [...value] as [number, number];
    newVal[isDragging] = Math.round(percent * 100) / 100;
    if (isDragging === 0 && newVal[0] > value[1] - 0.05) newVal[0] = value[1] - 0.05;
    if (isDragging === 1 && newVal[1] < value[0] + 0.05) newVal[1] = value[0] + 0.05;
    onChange(newVal);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(null);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-[11px] font-mono text-text-tertiary">
        <span>0.0</span><span>0.5</span><span>1.0</span>
      </div>
      <div ref={containerRef} className="relative h-6 w-full rounded-md mt-1 mb-6 flex items-stretch select-none">
        <div className="absolute left-0 top-0 bottom-0 bg-[rgba(70,167,88,0.2)] border-y border-l border-status-success rounded-l-md" style={{ width: `${value[0] * 100}%` }} />
        <div className="absolute top-0 bottom-0 bg-[rgba(245,166,35,0.2)] border-y border-status-warning" style={{ left: `${value[0] * 100}%`, width: `${(value[1] - value[0]) * 100}%` }} />
        <div className="absolute right-0 top-0 bottom-0 bg-[rgba(229,72,77,0.2)] border-y border-r border-status-critical rounded-r-md" style={{ width: `${(1 - value[1]) * 100}%` }} />

        {[0, 1].map(idx => (
          <div
            key={idx}
            onPointerDown={(e) => handlePointerDown(idx, e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={cn(
              "absolute top-1/2 -mt-[14px] w-3 h-7 bg-surface-1 border border-border-default rounded cursor-ew-resize shadow-md flex flex-col items-center justify-center gap-[2px] transition-colors z-10",
              isDragging === idx ? "border-accent bg-surface-2" : "hover:border-text-secondary"
            )}
            style={{ left: `calc(${value[idx] * 100}% - 6px)` }}
          >
            <div className="w-[1px] h-3 bg-text-tertiary" /><div className="w-[1px] h-3 bg-text-tertiary" />
            <div className="absolute -bottom-6 text-[10px] font-mono whitespace-nowrap bg-surface-3 px-1 rounded">{value[idx].toFixed(2)}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-subtle">
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-status-success" /><span className="text-[12px] text-text-secondary">Пропуск (0–{value[0].toFixed(2)})</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-status-warning" /><span className="text-[12px] text-text-secondary">Эскалация ({value[0].toFixed(2)}–{value[1].toFixed(2)})</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-status-critical" /><span className="text-[12px] text-text-secondary">Блок ({value[1].toFixed(2)}–1.00)</span></div>
      </div>
    </div>
  );
}

// ─── stat card ────────────────────────────────────────────────────────────────

function StatCard({ title, value, sub, icon, accent = false, warn = false }: {
  title: string; value: string | number; sub?: string; icon: React.ReactNode; accent?: boolean; warn?: boolean;
}) {
  const bg = accent ? "bg-[rgba(229,72,77,0.12)] text-status-critical"
           : warn   ? "bg-[rgba(245,166,35,0.12)] text-status-warning"
           : "bg-surface-3 text-accent";
  return (
    <div className="content-card flex items-start gap-4 p-5">
      <div className={`p-2.5 rounded-xl ${bg}`}>{icon}</div>
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] text-text-secondary">{title}</span>
        <span className="text-[24px] font-bold text-text-primary leading-tight">{value}</span>
        {sub && <span className="text-[12px] text-text-tertiary mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

// ─── statistics tab ───────────────────────────────────────────────────────────

const CAT_COLORS_L4: Record<string, string> = {
  prompt_injection: "#E5484D",
  jailbreak: "#F5A623",
  data_exfil: "#9758FF",
  pii: "#FCE300",
  multi_turn: "#FF7B00",
};

function StatisticsTab() {
  const { period, setPeriod, hours, label } = useStatsPeriod();
  const [stats, setStats] = useState<LayerStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<LayerStatsResponse>(`/layers/4/stats?hours=${hours}`)
      .then(setStats).catch(() => setStats(null)).finally(() => setLoading(false));
  }, [hours]);

  const totals   = stats?.totals;
  const total    = totals?.total ?? 0;
  const blocked  = totals?.blocked ?? 0;
  const escalated = totals?.escalated ?? 0;
  const passed   = totals?.passed ?? 0;
  const avgScore = totals?.avg_score ?? null;

  const timelineData = (stats?.timeline ?? []).map(p => ({
    time: p.time, blocked: p.blocked, escalated: p.escalated, passed: p.passed,
  }));

  const byCat = (stats?.by_category ?? []).map(c => ({
    name: c.category.replace(/_/g, " "),
    count: c.count,
    raw: c.category,
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
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard title="Всего проанализировано" value={total.toLocaleString()} sub={label} icon={<Shield className="w-5 h-5" />} />
            <StatCard title="Заблокировано" value={blocked.toLocaleString()} sub={total ? `${((blocked/total)*100).toFixed(1)}%` : "—"} icon={<AlertTriangle className="w-5 h-5" />} accent={blocked > 0} />
            <StatCard title="Эскалировано" value={escalated.toLocaleString()} sub="в очередь разметки" icon={<Activity className="w-5 h-5" />} warn={escalated > 0} />
            <StatCard title="Пропущено" value={passed.toLocaleString()} sub="ниже порога" icon={<CheckCircle className="w-5 h-5" />} />
            <StatCard title="Средний ML-скор" value={avgScore != null ? avgScore.toFixed(3) : "—"} sub="0 = чисто, 1 = атака" icon={<TrendingUp className="w-5 h-5" />} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
            <div className="content-card flex flex-col">
              <h3 className="text-body-strong mb-4">График обнаружений ({label})</h3>
              {timelineData.length === 0 ? empty : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="gradBlock4" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#E5484D" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#E5484D" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
                      <XAxis
                        dataKey="time" axisLine={false} tickLine={false}
                        tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
                        tickFormatter={(v) => formatTimeTick(v, hours)}
                      />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--text-tertiary)", fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }}
                        labelFormatter={(v) => formatTimeTick(String(v), hours)}
                      />
                      <Area type="monotone" dataKey="blocked" stroke="#E5484D" fill="url(#gradBlock4)" strokeWidth={2} name="Заблокировано" />
                      <Area type="monotone" dataKey="escalated" stroke="#F5A623" fill="none" strokeWidth={1.5} name="Эскалировано" />
                      <Area type="monotone" dataKey="passed" stroke="var(--accent)" fill="none" strokeWidth={1} strokeDasharray="4 3" name="Прошло" />
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
                          <Cell key={i} fill={CAT_COLORS_L4[entry.raw] ?? "#8E96A3"} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export function Layer4MLClassifier() {
  const { status, initFromConfig, handleStatusChange } = useLayerStatus(4);
  const [activeTab, setActiveTab] = useState("Статистика");
  const [config, setConfig] = useState<Layer4Config>(DEFAULT_CONFIG);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Конфиг-вкладочные данные: distribution / quality / runtime
  const [distribution, setDistribution] = useState<DistributionData | null>(null);
  const [loadingDistribution, setLoadingDistribution] = useState(false);
  const [quality, setQuality] = useState<QualityData | null>(null);
  const [loadingQuality, setLoadingQuality] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [runtimeStale, setRuntimeStale] = useState(false);
  const [adapterRefreshKey, setAdapterRefreshKey] = useState(0);

  useEffect(() => {
    api.get<Partial<Layer4Config>>("/layers/4/config")
      .then(cfg => { setConfig({ ...DEFAULT_CONFIG, ...cfg }); initFromConfig((cfg as any).enabled); })
      .catch(() => {});
  }, []);

  // Загружаем 3 эндпоинта при открытии «Конфигурация»; обновляем периодически (60с).
  useEffect(() => {
    if (activeTab !== "Конфигурация" && activeTab !== "Тестирование") return;
    let cancelled = false;

    const loadAll = async () => {
      setLoadingDistribution(true);
      setLoadingQuality(true);
      setLoadingRuntime(true);
      try {
        const [d, q, r] = await Promise.all([
          api.get<DistributionData>("/layers/4/distribution?hours=24").catch(() => null),
          api.get<QualityData>("/layers/4/quality").catch(() => null),
          api.get<RuntimeInfo>("/layers/4/runtime").catch(() => "__err__" as const),
        ]);
        if (cancelled) return;
        setDistribution(d);
        setQuality(q);
        // Сохраняем последний удачный runtime при ошибке — не обнуляем, ставим stale.
        if (r === "__err__") {
          setRuntimeStale(true);
        } else {
          setRuntime(r);
          setRuntimeStale(false);
        }
      } finally {
        if (!cancelled) {
          setLoadingDistribution(false);
          setLoadingQuality(false);
          setLoadingRuntime(false);
        }
      }
    };

    loadAll();
    const id = setInterval(loadAll, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeTab]);

  const handleThresholds = (val: [number, number]) => {
    setConfig(prev => {
      const next = { ...prev, threshold_pass: val[0], threshold_block: val[1] };
      if (saveRef.current) clearTimeout(saveRef.current);
      saveRef.current = setTimeout(() => {
        api.put("/layers/4/config", next).catch(() => {});
      }, 500);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      <LayerPageHeader
        title="Слой 4 — ML-классификатор"
        subtitle="Модель, обученная классифицировать вредоносные намерения."
        status={status}
        onStatusChange={handleStatusChange}
      />
      {status === "DISABLED" && <LayerDisabledBanner />}

      <Tabs tabs={["Статистика", "Конфигурация", "Тестирование"]} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "Статистика" && <StatisticsTab />}

      {activeTab === "Конфигурация" && (
        <div className="flex flex-col gap-6">
          {/* Row 1: список адаптеров + текущая активная модель с runtime-сводкой */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AdapterSelectorCard
              refreshKey={adapterRefreshKey}
              onActivated={async () => {
                try {
                  const fresh = await api.get<RuntimeInfo>("/layers/4/runtime");
                  setRuntime(fresh);
                  setRuntimeStale(false);
                } catch {
                  setRuntimeStale(true);
                }
                setAdapterRefreshKey((k) => k + 1);
              }}
            />
            <ActiveModelCard
              runtime={runtime}
              loading={loadingRuntime}
              stale={runtimeStale}
              onDeactivated={async () => {
                try {
                  const fresh = await api.get<RuntimeInfo>("/layers/4/runtime");
                  setRuntime(fresh);
                  setRuntimeStale(false);
                } catch {
                  setRuntimeStale(true);
                }
                setAdapterRefreshKey((k) => k + 1);
              }}
              onRetry={async () => {
                try {
                  const fresh = await api.get<RuntimeInfo>("/layers/4/runtime");
                  setRuntime(fresh);
                  setRuntimeStale(false);
                } catch {
                  setRuntimeStale(true);
                }
              }}
            />
          </div>

          {/* Row 2: ТРЕД-управление (full-width) */}
          <div className="content-card flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-body-strong">Пороги принятия решений</h3>
              <span className="text-[11px] text-text-tertiary">
                Двигайте ползунки — histogram и счётчики «было/станет» обновляются live
              </span>
            </div>
            <ThresholdBands
              value={[config.threshold_pass, config.threshold_block]}
              onChange={handleThresholds}
            />
            <ScoreHistogramCard
              data={distribution}
              loading={loadingDistribution}
              pendingThresholds={[config.threshold_pass, config.threshold_block]}
            />
            <div className="bg-[rgba(74,158,255,0.05)] border border-[rgba(74,158,255,0.2)] rounded-lg p-3 text-[12px] text-text-secondary flex items-start gap-2">
              <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              События в зоне <strong className="text-status-warning">Эскалация</strong> уходят к Слою 7 (судье) для финального решения. Блок — сразу.
            </div>
          </div>

          {/* Row 3: Quality на разметке */}
          <QualityCard data={quality} loading={loadingQuality} />

          {/* Row 4: устройство (CPU/GPU) для inference Layer 4 */}
          <DeviceCard
            target="layer4"
            title="Устройство для Layer 4"
            onApplied={async () => {
              try {
                const fresh = await api.get<RuntimeInfo>("/layers/4/runtime");
                setRuntime(fresh);
                setRuntimeStale(false);
              } catch {
                setRuntimeStale(true);
              }
            }}
          />
        </div>
      )}

      {activeTab === "Тестирование" && (
        <div className="flex flex-col gap-4">
          {runtime && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-2 border border-border-subtle text-[12px]">
              <Cpu className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
              <span className="text-text-secondary">Тест на:</span>
              {runtime.active_adapter_path ? (
                <>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-[rgba(70,167,88,0.1)] text-status-success border border-[rgba(70,167,88,0.2)]">LoRA</span>
                  <span className="font-mono text-text-primary truncate">
                    {runtime.adapter_meta?.name ?? runtime.active_adapter_path.split("/").pop()}
                  </span>
                </>
              ) : (
                <>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-surface-3 text-text-secondary border border-border-default">base</span>
                  <span className="font-mono text-text-tertiary truncate">
                    {runtime.base_model ?? "protectai/deberta-v3-base-prompt-injection-v2"}
                  </span>
                </>
              )}
              {loadingRuntime && <RefreshCw className="w-3 h-3 animate-spin text-text-tertiary ml-auto" />}
            </div>
          )}
          <div className="content-card">
            <LayerTestPanel layerId={4} placeholder="Введите текст для проверки через ML-классификатор" />
          </div>
        </div>
      )}
    </div>
  );
}
