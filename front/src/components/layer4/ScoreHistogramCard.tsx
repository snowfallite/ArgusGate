import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { TrendingUp } from "lucide-react";

export interface HistogramBin {
  bin_low: number;
  bin_high: number;
  count: number;
}

export interface DistributionData {
  total: number;
  verdicts: Record<string, number>;
  histogram: HistogramBin[];
  current_thresholds: { threshold_pass: number; threshold_block: number };
  avg_score: number | null;
  p50: number | null;
  p95: number | null;
  hours: number;
}

interface Props {
  data: DistributionData | null;
  loading: boolean;
  /** Текущее положение ползунков (для preview) */
  pendingThresholds: [number, number];
}

function colorForBin(midpoint: number, tPass: number, tBlock: number): string {
  if (midpoint < tPass) return "#46A758";       // success / pass
  if (midpoint < tBlock) return "#F5A623";      // warning / escalate
  return "#E5484D";                              // critical / block
}

/**
 * Histogram L4 scores за 24ч с overlay цветных зон по pendingThresholds.
 * При движении ползунков (родителем) бары мгновенно перекрашиваются + preview-цифры пересчитываются.
 */
export function ScoreHistogramCard({ data, loading, pendingThresholds }: Props) {
  const [tPass, tBlock] = pendingThresholds;

  // Preview: пересчитываем сколько событий попадёт в каждую зону при новых порогах
  const preview = useMemo(() => {
    if (!data) return { pass: 0, escalate: 0, block: 0 };
    let pass = 0, escalate = 0, block = 0;
    for (const b of data.histogram) {
      const mid = (b.bin_low + b.bin_high) / 2;
      if (mid < tPass) pass += b.count;
      else if (mid < tBlock) escalate += b.count;
      else block += b.count;
    }
    return { pass, escalate, block };
  }, [data, tPass, tBlock]);

  const currentVerdicts = data?.verdicts ?? {};
  const currentPass = currentVerdicts.pass ?? 0;
  const currentEsc = currentVerdicts.escalate ?? 0;
  const currentBlock = currentVerdicts.block ?? 0;

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.histogram.map(b => ({
      mid: (b.bin_low + b.bin_high) / 2,
      label: b.bin_low.toFixed(2),
      count: b.count,
    }));
  }, [data]);

  return (
    <div className="content-card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-body-strong flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Распределение L4-скоров за {data?.hours ?? 24}ч
        </h3>
        {data && (
          <div className="flex items-center gap-3 text-[11px] text-text-tertiary font-mono">
            <span>n={data.total.toLocaleString()}</span>
            {data.avg_score !== null && <span>avg={data.avg_score.toFixed(2)}</span>}
            {data.p50 !== null && <span>p50={data.p50.toFixed(2)}</span>}
            {data.p95 !== null && <span>p95={data.p95.toFixed(2)}</span>}
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-44 bg-surface-2 rounded-lg animate-pulse" />
      ) : !data || data.total === 0 ? (
        <div className="h-44 flex flex-col items-center justify-center gap-2 text-text-tertiary text-[12px]">
          <TrendingUp className="w-8 h-8 opacity-20" />
          За последние 24 часа нет инференсов L4 — отправьте запросы через прокси
        </div>
      ) : (
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
              <XAxis
                dataKey="mid"
                tickFormatter={(v) => v.toFixed(2)}
                tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
                ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
                type="number" domain={[0, 1]}
              />
              <YAxis tick={{ fill: "var(--text-tertiary)", fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v) => `Score ${Number(v).toFixed(2)}–${(Number(v) + 0.05).toFixed(2)}`}
                formatter={(v: number) => [v, "Событий"]}
              />
              <ReferenceLine x={tPass} stroke="var(--status-warning)" strokeDasharray="3 3" strokeWidth={2} />
              <ReferenceLine x={tBlock} stroke="var(--status-critical)" strokeDasharray="3 3" strokeWidth={2} />
              <Bar dataKey="count" isAnimationActive={false}>
                {chartData.map((c, i) => (
                  <Cell key={i} fill={colorForBin(c.mid, tPass, tBlock)} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Threshold preview: было / станет */}
      {data && data.total > 0 && (
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border-subtle">
          {[
            { label: "Pass", was: currentPass, now: preview.pass, color: "var(--status-success)" },
            { label: "Escalate", was: currentEsc, now: preview.escalate, color: "var(--status-warning)" },
            { label: "Block", was: currentBlock, now: preview.block, color: "var(--status-critical)" },
          ].map(({ label, was, now, color }) => {
            const diff = now - was;
            return (
              <div key={label} className="bg-surface-2 border border-border-subtle rounded-md px-3 py-2 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">{label}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[16px] font-mono font-bold" style={{ color }}>{now}</span>
                  {diff !== 0 && (
                    <span className={`text-[11px] font-mono ${diff > 0 ? "text-status-warning" : "text-text-tertiary"}`}>
                      {diff > 0 ? "+" : ""}{diff}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-text-tertiary">было {was}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
