import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { TrainingJob, TrainingJobMetric } from "@/api/types";

/**
 * Загружает per-epoch метрики задачи. Поллит каждые intervalMs пока job в running/queued.
 */
export function useJobMetricsPolling(
  job: TrainingJob | null,
  intervalMs = 3000,
): TrainingJobMetric[] {
  const [metrics, setMetrics] = useState<TrainingJobMetric[]>([]);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (ref.current) {
      clearInterval(ref.current);
      ref.current = null;
    }
    if (!job) {
      setMetrics([]);
      return;
    }

    const load = async () => {
      try {
        const m = await api.get<TrainingJobMetric[]>(`/training/jobs/${job.id}/metrics`);
        setMetrics(m);
      } catch {
        setMetrics([]);
      }
    };
    load();

    if (job.status === "running" || job.status === "queued") {
      ref.current = setInterval(load, intervalMs);
    }
    return () => {
      if (ref.current) {
        clearInterval(ref.current);
        ref.current = null;
      }
    };
  }, [job?.id, job?.status, intervalMs]);

  return metrics;
}
