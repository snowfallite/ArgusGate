import { Activity, AlertCircle, CheckCircle2, Clock, XCircle, type LucideIcon } from "lucide-react";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobStatusMeta {
  label: string;
  icon: LucideIcon;
  className: string;
  pulse?: boolean;
}

const STATUS_META: Record<JobStatus, JobStatusMeta> = {
  queued:    { label: "В очереди",   icon: Clock,         className: "text-text-tertiary" },
  running:   { label: "Выполняется", icon: Activity,      className: "text-accent",           pulse: true },
  completed: { label: "Завершено",   icon: CheckCircle2,  className: "text-status-success" },
  failed:    { label: "Ошибка",      icon: AlertCircle,   className: "text-status-critical" },
  cancelled: { label: "Отменено",    icon: XCircle,       className: "text-status-warning" },
};

export function getJobStatusMeta(status: string | null | undefined): JobStatusMeta {
  return STATUS_META[(status ?? "queued") as JobStatus] ?? STATUS_META.queued;
}

export function canDeleteJob(status: string | null | undefined): boolean {
  return status !== "running";
}

export function canRestartJob(status: string | null | undefined): boolean {
  return (
    status === "failed" ||
    status === "completed" ||
    status === "cancelled"
  );
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}
