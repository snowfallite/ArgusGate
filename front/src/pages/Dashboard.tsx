import { useEffect, useState, useCallback } from "react";
import { MetricCard } from "@/components/MetricCard";
import { SectionHeader } from "@/components/SectionHeader";
import { PeriodPicker } from "@/components/PeriodPicker";
import { useStatsPeriod, formatTimeTick } from "@/hooks/useStatsPeriod";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { api } from "@/api/client";
import type {
  OverviewMetrics, TimelinePoint, FunnelEntry,
  CategoryCount, LayerThreatEntry,
} from "@/api/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  prompt_injection: "var(--status-critical)",
  jailbreak:        "var(--status-warning)",
  data_exfil:       "#9758FF",
  pii:              "#E8C000",   // было #FCE300 — плохой контраст в light mode
  multi_turn:       "#F5A623",   // приведено к --status-warning
};

const LAYER_COLORS: Record<number, string> = {
  1: "var(--status-info)",
  2: "var(--status-critical)",
  3: "#9758FF",
  4: "var(--status-warning)",
  5: "#F5A623",   // было #FF7B00 — приведено к --status-warning
  6: "#E8C000",   // было #FCE300 — лучший контраст
  7: "var(--status-success)",
};

function getColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? "var(--text-tertiary)";
}

// ─── Layer threats widget ──────────────────────────────────────────────────────

function LayerThreatsWidget({ threats }: { threats: LayerThreatEntry[] }) {
  if (threats.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-[13px]">
        Угроз за выбранный период не обнаружено
      </div>
    );
  }
  const maxBlocked = Math.max(...threats.map(t => t.blocked), 1);

  return (
    <div className="flex flex-col gap-3 flex-1 overflow-y-auto scrollbar-hide">
      {threats.map((t) => {
        const pct = (t.blocked / maxBlocked) * 100;
        const color = LAYER_COLORS[t.layer] ?? "var(--accent)";
        return (
          <div key={t.layer} className="flex items-center gap-3">
            <span
              className="text-[11px] font-medium shrink-0 w-[26px] text-center px-1 py-0.5 rounded"
              style={{ background: `${color}18`, color }}
            >
              L{t.layer}
            </span>
            <span className="text-[12px] text-text-secondary shrink-0 w-[140px] truncate">
              {t.layer_name}
            </span>
            <div className="flex-1 h-2 bg-surface-3 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
            <span className="text-[12px] font-medium text-text-primary shrink-0 w-[32px] text-right">
              {t.blocked}
            </span>
            {t.top_category && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded shrink-0 max-w-[110px] truncate"
                style={{
                  background: `${getColor(t.top_category)}18`,
                  color: getColor(t.top_category),
                }}
              >
                {t.top_category.replace(/_/g, " ")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function Dashboard() {
  const { period, setPeriod, hours, label } = useStatsPeriod("24h");

  const [metrics, setMetrics]     = useState<OverviewMetrics | null>(null);
  const [timeline, setTimeline]   = useState<TimelinePoint[]>([]);
  const [funnel, setFunnel]       = useState<FunnelEntry[]>([]);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [threats, setThreats]     = useState<LayerThreatEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const q = `?hours=${hours}`;
      const [m, t, f, c, th] = await Promise.all([
        api.get<OverviewMetrics>(`/dashboard/overview${q}`),
        api.get<TimelinePoint[]>(`/dashboard/timeline${q}`),
        api.get<FunnelEntry[]>(`/dashboard/funnel${q}`),
        api.get<CategoryCount[]>(`/dashboard/categories${q}`),
        api.get<LayerThreatEntry[]>(`/dashboard/layer-threats${q}`),
      ]);
      setMetrics(m);
      setTimeline(t);
      setFunnel(f);
      setCategories(c);
      setThreats(th);
    } catch {
      setError("Не удалось загрузить данные дашборда. Проверьте соединение с сервером.");
    }
    setLoading(false);
    setRefreshing(false);
  }, [hours]);

  // Initial load + auto-refresh every 30s (silent)
  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 30000);
    return () => clearInterval(id);
  }, [load]);

  const totalAttacks      = categories.reduce((s, c) => s + c.count, 0);
  const categoryChartData = categories.map((c) => ({
    name: c.category.replace(/_/g, " "),
    value: c.count,
    color: getColor(c.category),
  }));
  const periodCaption = label;

  if (loading) {
    return (
      <div className="flex flex-col gap-6 pb-12">
        <SectionHeader title="Дашборд" subtitle="Обзор конвейера обнаружения в реальном времени" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="content-card h-24 animate-pulse bg-surface-2" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="content-card h-[360px] animate-pulse bg-surface-2" />
          <div className="content-card h-[360px] animate-pulse bg-surface-2" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Header */}
      <SectionHeader title="Дашборд" subtitle="Обзор конвейера обнаружения в реальном времени">
        <div className="flex items-center gap-3">
          <PeriodPicker value={period} onChange={setPeriod} />
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-2 hover:bg-surface-3 transition-colors border border-border-default text-text-primary disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            <span className="text-[13px] font-medium">Обновить</span>
          </button>
        </div>
      </SectionHeader>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-[13px]"
          style={{ background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.2)" }}>
          <AlertTriangle className="w-4 h-4 text-status-warning shrink-0" />
          <span className="text-text-secondary">{error}</span>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Всего запросов"
          value={(metrics?.total_requests ?? 0).toLocaleString()}
          caption={`За ${periodCaption}`}
          captionColor="default"
        >
          <div className="h-[40px] w-full mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline}>
                <Area type="monotone" dataKey="total" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.1} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        <MetricCard
          title="Заблокировано атак"
          value={(metrics?.blocked_requests ?? 0).toLocaleString()}
          caption={`${((metrics?.block_rate ?? 0) * 100).toFixed(2)}% блокировок`}
          captionColor="warning"
        >
          <div className="h-[40px] w-full mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline}>
                <Area type="monotone" dataKey="blocked" stroke="var(--status-critical)" fill="var(--status-critical)" fillOpacity={0.1} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        <MetricCard
          title="Подозрительные"
          value={(metrics?.suspicious_requests ?? 0).toLocaleString()}
          caption="Помечено как подозрительное"
          captionColor="default"
        >
          <div className="h-[40px] w-full mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline}>
                <Area type="step" dataKey="suspicious" stroke="var(--status-warning)" fill="var(--status-warning)" fillOpacity={0.1} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </MetricCard>

        <MetricCard
          title="Средняя задержка"
          value={`${(metrics?.avg_latency_ms ?? 0).toFixed(1)}ms`}
          caption={`${metrics?.active_sessions ?? 0} активных сессий`}
          captionColor="success"
        />
      </div>

      {/* Funnel + Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="content-card flex flex-col h-[360px]">
          <h3 className="text-body-strong mb-4">Воронка обнаружения</h3>
          {funnel.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-text-tertiary text-[13px]">
              Нет данных — отправьте запросы через прокси
            </div>
          ) : (
            <div className="flex-1 -ml-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={funnel.map(f => ({
                    layer: `L${f.layer} ${f.layer_name}`,
                    passed: f.passed,
                    filtered: f.filtered,
                  }))}
                  layout="vertical"
                  margin={{ left: 100, right: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} stroke="var(--border-subtle)" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="layer" type="category" axisLine={false} tickLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
                  <Tooltip
                    cursor={{ fill: "var(--surface-2)" }}
                    contentStyle={{ backgroundColor: "var(--surface-2)", borderColor: "var(--border-default)", borderRadius: "8px", color: "var(--text-primary)" }}
                  />
                  <Bar dataKey="passed" stackId="a" fill="var(--status-info)" radius={[2, 0, 0, 2]} />
                  <Bar dataKey="filtered" stackId="a" fill="var(--status-critical)" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="content-card flex flex-col h-[360px]">
          <h3 className="text-body-strong mb-4">Категории атак</h3>
          {categoryChartData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-text-tertiary text-[13px]">
              Заблокированных событий пока нет
            </div>
          ) : (
            <>
              <div className="flex-1 flex items-center justify-center relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryChartData}
                      cx="50%" cy="50%"
                      innerRadius={80} outerRadius={120}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {categoryChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--surface-2)", borderColor: "var(--border-default)", borderRadius: "8px", color: "var(--text-primary)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-title-h2">{totalAttacks}</span>
                  <span className="text-label">атак</span>
                </div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                {categoryChartData.map((cat, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-[11px] text-text-secondary truncate">{cat.name} ({cat.value})</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="content-card flex flex-col h-[400px]">
        <h3 className="text-body-strong mb-4">Хронология запросов ({label})</h3>
        {timeline.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-text-tertiary text-[13px]">
            Запросов за выбранный период нет
          </div>
        ) : (
          <div className="flex-1 -ml-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline} margin={{ left: 0, right: 10, bottom: 0, top: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
                  dy={10}
                  tickFormatter={(v) => formatTimeTick(v, hours)}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--text-tertiary)", fontSize: 11 }} />
                <Tooltip
                  cursor={{ stroke: "var(--border-default)", strokeWidth: 1, strokeDasharray: "4 4" }}
                  contentStyle={{ backgroundColor: "var(--surface-2)", borderColor: "var(--border-default)", borderRadius: "8px", color: "var(--text-primary)" }}
                  labelFormatter={(v) => formatTimeTick(String(v), hours)}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: "12px", color: "var(--text-secondary)" }} />
                <Area type="monotone" dataKey="total"     name="Всего запросов"  stroke="var(--status-info)"     fill="var(--status-info)"     fillOpacity={0.1} strokeWidth={2} />
                <Area type="monotone" dataKey="blocked"   name="Заблокировано"   stroke="var(--status-critical)" fill="var(--status-critical)" fillOpacity={0.3} strokeWidth={2} />
                <Area type="monotone" dataKey="suspicious" name="Подозрительных" stroke="var(--status-warning)"  fill="var(--status-warning)"  fillOpacity={0.5} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Layer threats widget */}
      <div className="content-card flex flex-col" style={{ minHeight: 240 }}>
        <h3 className="text-body-strong mb-4">Угрозы по слоям ({label})</h3>
        <LayerThreatsWidget threats={threats} />
      </div>
    </div>
  );
}
