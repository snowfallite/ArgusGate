import { SectionHeader } from "./SectionHeader";
import { cn } from "@/lib/utils";

interface LayerPageHeaderProps {
  title: string;
  subtitle: string;
  status: "ACTIVE" | "OBSERVING" | "DISABLED";
  onStatusChange: (status: "ACTIVE" | "OBSERVING" | "DISABLED") => void;
}

export function LayerPageHeader({ title, subtitle, status, onStatusChange }: LayerPageHeaderProps) {
  return (
    <SectionHeader title={title} subtitle={subtitle}>
      <div className="flex items-center bg-[rgba(0,0,0,0.1)] dark:bg-[rgba(255,255,255,0.05)] p-0.5 rounded-lg border border-border-subtle">
        {(["ACTIVE", "OBSERVING", "DISABLED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => onStatusChange(s as any)}
            className={cn(
              "px-3 py-1 rounded-md text-[12px] font-medium transition-colors",
              status === s
                ? "bg-surface-1 shadow-sm text-text-primary flex items-center gap-1.5"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {status === s && s === "ACTIVE" && <span className="w-1.5 h-1.5 rounded-full bg-status-success"></span>}
            {status === s && s === "OBSERVING" && <span className="w-1.5 h-1.5 rounded-full bg-status-warning"></span>}
            {status === s && s === "DISABLED" && <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary"></span>}
            {{ ACTIVE: "АКТИВЕН", OBSERVING: "НАБЛЮДЕНИЕ", DISABLED: "ОТКЛЮЧЁН" }[s]}
          </button>
        ))}
      </div>
    </SectionHeader>
  );
}

export function LayerDisabledBanner() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[rgba(245,166,35,0.30)] bg-[rgba(245,166,35,0.06)] text-[13px] text-text-secondary">
      <span className="w-2 h-2 rounded-full bg-status-warning shrink-0" />
      Слой отключён — запросы проходят без проверки этим слоем.
      Переключите в АКТИВЕН, чтобы включить обнаружение.
    </div>
  );
}
