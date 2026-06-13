import { useState } from "react";
import type { Period } from "@/api/types";

export type { Period };

const PERIOD_HOURS: Record<Period, number> = {
  "24h": 24,
  "7d": 168,
  "30d": 720,
  "all": 0,
};

const PERIOD_LABELS: Record<Period, string> = {
  "24h": "24ч",
  "7d": "7д",
  "30d": "30д",
  "all": "Всё время",
};

export const PERIODS: Period[] = ["24h", "7d", "30d", "all"];

export function useStatsPeriod(defaultPeriod: Period = "24h") {
  const [period, setPeriod] = useState<Period>(defaultPeriod);
  return {
    period,
    setPeriod,
    hours: PERIOD_HOURS[period],
    label: PERIOD_LABELS[period],
  };
}

/** Format an ISO datetime tick label based on the selected period. */
export function formatTimeTick(iso: string, hours: number): string {
  const d = new Date(iso);
  if (hours === 0 || hours > 48) {
    return d.toLocaleDateString("ru", { day: "2-digit", month: "2-digit" });
  }
  return d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
}
