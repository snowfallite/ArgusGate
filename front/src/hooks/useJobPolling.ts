import { useEffect, useRef } from "react";
import { api } from "@/api/client";
import type { TrainingJob } from "@/api/types";

const ACTIVE_STATUSES = new Set(["running", "queued"]);
const JOB_POLL_INTERVAL_MS = 2000;

/**
 * Поллит список задач обучения, пока среди них есть running/queued.
 * При отсутствии активных — останавливается сам.
 */
export function useJobPolling(
  jobs: TrainingJob[],
  setJobs: (next: TrainingJob[]) => void,
  intervalMs = JOB_POLL_INTERVAL_MS,
): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Храним jobs в ref, чтобы не перезапускать эффект при каждом обновлении
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const setJobsRef = useRef(setJobs);
  setJobsRef.current = setJobs;

  useEffect(() => {
    function tick() {
      const hasActive = jobsRef.current.some(j => ACTIVE_STATUSES.has(j.status));
      if (!hasActive) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }
      if (!intervalRef.current) {
        intervalRef.current = setInterval(async () => {
          try {
            const fresh = await api.get<TrainingJob[]>("/training/jobs");
            setJobsRef.current(fresh);
          } catch {
            // тихо — следующий тик попробует снова
          }
        }, intervalMs);
      }
    }

    tick();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // Намеренно не включаем jobs — используем jobsRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
}
