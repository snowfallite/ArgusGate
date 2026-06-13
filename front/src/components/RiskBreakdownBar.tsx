export interface RiskBreakdown {
  crescendo?: number;
  post_refusal?: number;
  self_reference?: number;
  cumulative_delta?: number;
  cumulative_total?: number;
}

const DETECTORS = [
  { key: "crescendo", label: "Crescendo", color: "#E5484D" },
  { key: "post_refusal", label: "Перефраз. после отказа", color: "#F5A623" },
  { key: "self_reference", label: "Саморефлексия", color: "#9758FF" },
  { key: "cumulative_delta", label: "Δ накопит.", color: "#4A9EFF" },
] as const;

interface Props {
  breakdown: RiskBreakdown | null | undefined;
}

/**
 * Stacked-bar разбивки вклада 4 детекторов L5 на ПОСЛЕДНЕМ ходе.
 * Используется в дровере ActiveSessions и в Audit Log при L5-событиях.
 */
export function RiskBreakdownBar({ breakdown }: Props) {
  if (!breakdown) {
    return (
      <div className="text-[12px] text-text-tertiary">Нет данных по последнему ходу</div>
    );
  }

  const values = DETECTORS.map((d) => ({
    ...d,
    value: Number(breakdown[d.key as keyof RiskBreakdown] ?? 0),
  }));
  const total = values.reduce((s, v) => s + v.value, 0);

  if (total === 0) {
    return (
      <div className="text-[12px] text-text-tertiary">Все детекторы вернули 0 на последнем ходе</div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-3 w-full rounded-md overflow-hidden bg-surface-3 border border-border-subtle">
        {values.map((v) =>
          v.value > 0 ? (
            <div
              key={v.key}
              title={`${v.label}: ${v.value.toFixed(3)}`}
              style={{
                width: `${(v.value / total) * 100}%`,
                backgroundColor: v.color,
              }}
            />
          ) : null
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {values.map((v) => (
          <div key={v.key} className="flex items-center gap-2 text-[11px]">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: v.color }}
            />
            <span className="text-text-secondary flex-1 truncate">{v.label}</span>
            <span className="font-mono text-text-primary">{v.value.toFixed(3)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
