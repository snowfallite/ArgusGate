import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface RiskPoint {
  turn: number;
  score: number;
}

interface Props {
  data: RiskPoint[];
  height?: number;
  escalateThreshold?: number;
  quarantineThreshold?: number;
}

/**
 * Кумулятивный риск сессии по ходам — даёт UI видимость работы декея
 * и срабатывания порогов escalate/quarantine (§4.5.4).
 */
export function RiskTimelineChart({
  data,
  height = 140,
  escalateThreshold = 0.6,
  quarantineThreshold = 0.85,
}: Props) {
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center text-text-tertiary text-[12px]"
        style={{ height }}
      >
        Недостаточно данных для построения тренда
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
          <XAxis
            dataKey="turn"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
          />
          <YAxis
            domain={[0, 1]}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
            tickFormatter={(v) => v.toFixed(1)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v: number) => v.toFixed(3)}
            labelFormatter={(l) => `Ход #${l}`}
          />
          <ReferenceLine
            y={escalateThreshold}
            stroke="var(--status-warning)"
            strokeDasharray="3 3"
            strokeOpacity={0.7}
          />
          <ReferenceLine
            y={quarantineThreshold}
            stroke="var(--status-critical)"
            strokeDasharray="3 3"
            strokeOpacity={0.7}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="var(--accent)"
            fill="url(#riskGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
