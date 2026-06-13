import { cn } from "@/lib/utils";
import { PERIODS, type Period } from "@/hooks/useStatsPeriod";

const LABELS: Record<Period, string> = {
  "24h": "24ч",
  "7d":  "7д",
  "30d": "30д",
  "all": "Всё время",
};

interface PeriodPickerProps {
  value: Period;
  onChange: (p: Period) => void;
  className?: string;
}

export function PeriodPicker({ value, onChange, className }: PeriodPickerProps) {
  return (
    <div className={cn("flex items-center gap-1 p-1 bg-surface-2 rounded-lg", className)}>
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={cn(
            "px-3 py-1 rounded-md text-[13px] transition-colors select-none",
            value === p
              ? "bg-surface-base text-text-primary font-medium shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          {LABELS[p]}
        </button>
      ))}
    </div>
  );
}
