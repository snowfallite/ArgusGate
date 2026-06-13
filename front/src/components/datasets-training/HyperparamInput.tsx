import { type HyperparamMeta, formatHyperparam, withinRecommended } from "@/lib/hyperparams";
import { InfoTooltip } from "./InfoTooltip";
import { cn } from "@/lib/utils";

interface Props {
  meta: HyperparamMeta;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

export function HyperparamInput({ meta, value, onChange, disabled }: Props) {
  const inRange = withinRecommended(meta, value);
  const [lo, hi] = meta.recommended;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[12px] font-medium text-text-secondary">{meta.label}</label>
        <InfoTooltip text={meta.tooltip} />
      </div>
      <input
        type="number"
        value={value}
        min={meta.min}
        max={meta.max}
        step={meta.step}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (!Number.isNaN(next)) onChange(next);
        }}
        className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-accent disabled:opacity-50"
      />
      <span
        className={cn(
          "text-[11px] font-mono",
          inRange ? "text-text-tertiary" : "text-status-warning",
        )}
      >
        rec. {formatHyperparam(meta, lo)} – {formatHyperparam(meta, hi)}
      </span>
    </div>
  );
}
