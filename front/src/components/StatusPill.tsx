import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export type StatusType = "critical" | "warning" | "success" | "info";

interface StatusPillProps {
  status: StatusType;
  label: string;
  className?: string;
  iconOnly?: boolean;
}

export function StatusPill({ status, label, className, iconOnly = false }: StatusPillProps) {
  const styles = {
    critical: "bg-[rgba(229,72,77,0.12)] text-status-critical",
    warning: "bg-[rgba(245,166,35,0.12)] text-status-warning",
    success: "bg-[rgba(70,167,88,0.12)] text-status-success",
    info: "bg-[rgba(74,158,255,0.12)] text-status-info",
  };

  const icons = {
    critical: XCircle,
    warning: AlertTriangle,
    success: CheckCircle2,
    info: Info,
  };

  const Icon = icons[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-label font-medium whitespace-nowrap",
        styles[status],
        iconOnly && "p-1 rounded-full",
        className
      )}
      title={iconOnly ? label : undefined}
    >
      <Icon className="w-3.5 h-3.5" />
      {!iconOnly && <span>{label}</span>}
    </span>
  );
}
