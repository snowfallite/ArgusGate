import { getJobStatusMeta } from "@/lib/trainingStatus";
import { cn } from "@/lib/utils";

interface Props {
  status: string | null | undefined;
  className?: string;
}

export function JobStatusBadge({ status, className }: Props) {
  const meta = getJobStatusMeta(status);
  const Icon = meta.icon;
  return (
    <div className={cn("flex items-center gap-1.5", meta.className, className)}>
      <Icon className={cn("w-3.5 h-3.5", meta.pulse && "animate-pulse")} />
      <span className="font-medium text-[12px] uppercase">{meta.label}</span>
    </div>
  );
}

interface ProgressProps {
  percent: number;
  className?: string;
  thickness?: "thin" | "regular";
}

export function JobProgressBar({ percent, className, thickness = "thin" }: ProgressProps) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn(
        "flex-1 bg-surface-3 rounded-full overflow-hidden",
        thickness === "thin" ? "h-1.5" : "h-2",
      )}>
        <div
          className="h-full bg-accent rounded-full transition-all duration-500"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="font-mono text-[10px] text-text-tertiary w-8 text-right">
        {Math.round(clamped)}%
      </span>
    </div>
  );
}
