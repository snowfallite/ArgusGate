import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Приводит вердикт к нормализованной форме (blocked → block) */
export function normalizeVerdict(v: string | null): string | null {
  return v === "blocked" ? "block" : v;
}

/** Маппинг вердикта на статус StatusPill */
export function verdictToStatus(v: string | null): "critical" | "warning" | "success" | "info" {
  const n = normalizeVerdict(v);
  if (n === "block")                           return "critical";
  if (n === "escalate" || n === "suspicious")  return "warning";
  if (n === "pass")                            return "success";
  return "info";
}
