/**
 * useTrainingLogStream — SSE-стрим лог-строк обучения.
 *
 * Поведение:
 * - running/queued: подключается к SSE /api/training/jobs/{id}/logs/stream.
 *   Сервер сначала воспроизводит catch-up строки из БД, затем отдаёт live.
 *   При onopen — сбрасывает entries (сервер всё переиграет с нуля).
 *   При event:close — переходит в streaming=false.
 * - completed/failed: использует job.log_text из пропсов.
 *   Если entries уже накоплены через SSE — сохраняет их.
 * - Реконнект: 5 попыток с задержкой 3s.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TrainingJob } from "@/api/types";

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

export type LogLevel =
  | "info"
  | "device"
  | "data"
  | "model"
  | "train"
  | "step"
  | "epoch"
  | "eval"
  | "done"
  | "warn"
  | "error";

export interface LogEntry {
  /** Монотонный счётчик — React key */
  id: number;
  /** Исходная строка целиком */
  line: string;
  /** HH:MM:SS */
  ts: string;
  level: LogLevel;
  /** Сообщение — всё после '| LEVEL |' */
  message: string;
}

// ---------------------------------------------------------------------------
// Парсинг строки лога
// ---------------------------------------------------------------------------

const LEVEL_MAP: Record<string, LogLevel> = {
  INFO:   "info",
  DEVICE: "device",
  DATA:   "data",
  MODEL:  "model",
  TRAIN:  "train",
  STEP:   "step",
  EPOCH:  "epoch",
  EVAL:   "eval",
  DONE:   "done",
  WARN:   "warn",
  ERROR:  "error",
};

// Формат: "2025-05-26 10:00:00 | INFO   | message"
const LOG_PATTERN = /^(\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})) \| (\w+)\s*\| (.+)$/;

function parseLine(raw: string, id: number): LogEntry {
  const m = LOG_PATTERN.exec(raw.trim());
  if (m) {
    const level = LEVEL_MAP[m[3].trim().toUpperCase()] ?? "info";
    return { id, line: raw, ts: m[2], level, message: m[4].trim() };
  }
  // Fallback для строк без структуры
  return { id, line: raw, ts: "", level: "info", message: raw.trim() };
}

function parseLogText(text: string, counterRef: { current: number }): LogEntry[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => parseLine(l, counterRef.current++));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTrainingLogStream(job: TrainingJob | null): {
  entries: LogEntry[];
  streaming: boolean;
} {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [streaming, setStreaming] = useState(false);

  const counterRef    = useRef(0);
  const esRef         = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Идентификатор задачи, для которой последний раз открывался SSE */
  const sseJobIdRef   = useRef<string | null>(null);

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const closeSSE = useCallback(
    (es?: EventSource | null) => {
      clearRetry();
      const target = es ?? esRef.current;
      if (target) {
        target.close();
        if (esRef.current === target) esRef.current = null;
      }
      setStreaming(false);
    },
    [clearRetry],
  );

  /** Открывает SSE-соединение для job_id. */
  const openSSE = useCallback(
    (jobId: string) => {
      const token = localStorage.getItem("token");
      if (!token) return;

      const url = `/api/training/jobs/${jobId}/logs/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;
      sseJobIdRef.current = jobId;

      es.onopen = () => {
        setStreaming(true);
        retryCountRef.current = 0;
        // Сервер воспроизведёт все catch-up строки с нуля → сбрасываем entries
        counterRef.current = 0;
        setEntries([]);
      };

      es.onmessage = (event) => {
        try {
          const line: string = JSON.parse(event.data as string);
          const id = counterRef.current++;
          setEntries((prev) => [...prev, parseLine(line, id)]);
        } catch {
          // ignore
        }
      };

      es.addEventListener("close", () => {
        // Сервер завершил стрим (training finished)
        setStreaming(false);
        es.close();
        if (esRef.current === es) esRef.current = null;
      });

      es.onerror = () => {
        setStreaming(false);
        es.close();
        if (esRef.current === es) esRef.current = null;

        if (retryCountRef.current < 5) {
          retryCountRef.current += 1;
          const attempt = retryCountRef.current;
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            // Переподключаемся только если задача та же и SSE не открыт
            if (sseJobIdRef.current === jobId && esRef.current === null) {
              console.debug(`[TrainingLog] retry #${attempt} for job ${jobId}`);
              openSSE(jobId);
            }
          }, 3000);
        }
      };
    },
    [closeSSE],
  );

  // ------------------------------------------------------------------
  // Main effect
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!job) {
      closeSSE();
      setEntries([]);
      counterRef.current = 0;
      sseJobIdRef.current = null;
      return;
    }

    const isActive =
      job.status === "running" || job.status === "queued";

    // При смене задачи — сбрасываем всё
    const jobChanged = sseJobIdRef.current !== null && sseJobIdRef.current !== job.id;
    if (jobChanged) {
      closeSSE();
      setEntries([]);
      counterRef.current = 0;
    }

    if (!isActive) {
      // Завершённая/упавшая задача: источник — job.log_text
      closeSSE();
      setEntries((current) => {
        // Если entries уже есть (накоплены через SSE) — сохраняем
        if (current.length > 0) return current;
        // Иначе парсим из хранимого log_text
        counterRef.current = 0;
        return parseLogText(job.log_text ?? "", counterRef);
      });
      return;
    }

    // Активная задача: SSE
    if (esRef.current !== null) return; // уже подключены
    openSSE(job.id);

    return () => {
      // Cleanup при unmount или следующем запуске effect
      closeSSE();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status, job?.log_text]);

  // Cleanup при unmount
  useEffect(() => {
    return () => {
      clearRetry();
      esRef.current?.close();
    };
  }, [clearRetry]);

  return { entries, streaming };
}
