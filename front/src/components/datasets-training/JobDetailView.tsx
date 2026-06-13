import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronLeft, RotateCcw, Square, Trash2, TrendingUp } from "lucide-react";
import type { TrainingJob } from "@/api/types";
import { useJobMetricsPolling } from "@/hooks/useJobMetricsPolling";
import { canDeleteJob, canRestartJob, formatDuration } from "@/lib/trainingStatus";
import { TrainingLogPanel } from "./TrainingLogPanel";
import { HyperparamBadges } from "./HyperparamBadges";
import { JobProgressBar, JobStatusBadge } from "./JobStatusBadge";

interface Props {
  job: TrainingJob;
  onBack: () => void;
  onRestart: (job: TrainingJob) => void;
  onDelete: (job: TrainingJob) => void;
  onCancel?: (job: TrainingJob) => void;
}

export function JobDetailView({ job, onBack, onRestart, onDelete, onCancel }: Props) {
  const metrics = useJobMetricsPolling(job);

  const allowDelete  = canDeleteJob(job.status);
  const allowRestart = canRestartJob(job.status);
  const isRunning    = job.status === "running";

  return (
    <div className="flex flex-col gap-5">
      {/* Навигация и действия */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text-primary"
        >
          <ChevronLeft className="w-4 h-4" /> К задачам
        </button>

        <div className="flex items-center gap-1.5">
          {/* Остановить (только для running) */}
          {isRunning && onCancel && (
            <button
              onClick={() => onCancel(job)}
              title="Остановить обучение"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-surface-2
                         border border-border-default text-[12px] text-text-secondary
                         hover:text-status-warning hover:border-status-warning transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Остановить</span>
            </button>
          )}

          {/* Перезапустить */}
          <button
            onClick={() => onRestart(job)}
            disabled={!allowRestart}
            title={allowRestart ? "Перезапустить с теми же параметрами" : "Доступно только для completed/failed/cancelled"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-surface-2
                       border border-border-default text-[12px] text-text-secondary
                       hover:text-text-primary hover:border-accent
                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Перезапустить</span>
          </button>

          {/* Удалить */}
          <button
            onClick={() => onDelete(job)}
            disabled={!allowDelete}
            title={allowDelete ? "Удалить задачу" : "Нельзя удалить выполняющуюся задачу"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-surface-2
                       border border-border-default text-[12px] text-text-secondary
                       hover:text-status-critical hover:border-status-critical
                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Удалить</span>
          </button>
        </div>
      </div>

      {/* ID + статус + прогресс */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-[14px] text-text-primary">{job.id}</h1>
        <JobStatusBadge status={job.status} />
        {(isRunning || job.progress_percent > 0) && (
          <div className="w-60">
            <JobProgressBar percent={job.progress_percent} thickness="regular" />
          </div>
        )}
      </div>

      {/* График метрик по эпохам */}
      {metrics.length > 0 && (
        <div className="bg-surface-1 border border-border-subtle rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
            <TrendingUp className="w-4 h-4" />
            Метрики по эпохам ({metrics.length})
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--border-subtle)"
                />
                <XAxis dataKey="epoch" tick={{ fill: "var(--text-tertiary)", fontSize: 11 }} />
                <YAxis domain={[0, 1]} tick={{ fill: "var(--text-tertiary)", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone" dataKey="precision" stroke="#4A9EFF"
                  strokeWidth={2} dot={{ r: 3 }} name="Precision"
                />
                <Line
                  type="monotone" dataKey="recall" stroke="#F5A623"
                  strokeWidth={2} dot={{ r: 3 }} name="Recall"
                />
                <Line
                  type="monotone" dataKey="f1" stroke="#46A758"
                  strokeWidth={2} dot={{ r: 3 }} name="F1"
                />
                <Line
                  type="monotone" dataKey="eval_loss" stroke="#E5484D"
                  strokeWidth={2} dot={{ r: 3 }} name="Loss"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Параметры + Журнал */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Параметры */}
        <div className="bg-surface-1 border border-border-subtle rounded-xl p-5 flex flex-col gap-4">
          <h3 className="text-[13px] font-semibold text-text-primary">Параметры</h3>
          <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[12px]">
            <span className="text-text-secondary">Датасет</span>
            <span className="font-mono text-text-primary text-[11px]">
              {job.dataset_id ?? "—"}
            </span>
            <span className="text-text-secondary">Метод</span>
            <span className="text-text-primary font-mono">{job.method ?? "—"}</span>
            <span className="text-text-secondary">Базовая модель</span>
            <span
              className="font-mono text-text-primary text-[11px] truncate"
              title={job.base_model ?? ""}
            >
              {job.base_model ?? "—"}
            </span>
            <span className="text-text-secondary">Гиперпараметры</span>
            <span>
              <HyperparamBadges hyperparameters={job.hyperparameters} />
            </span>
            <span className="text-text-secondary">Запущена</span>
            <span className="text-text-primary">
              {job.started_at
                ? new Date(job.started_at).toLocaleString()
                : "—"}
            </span>
            <span className="text-text-secondary">Завершена</span>
            <span className="text-text-primary">
              {job.completed_at
                ? new Date(job.completed_at).toLocaleString()
                : "—"}
            </span>
            <span className="text-text-secondary">Длительность</span>
            <span className="font-mono text-text-primary">
              {formatDuration(job.duration_seconds)}
            </span>
          </div>

          {job.final_metrics && Object.keys(job.final_metrics).length > 0 && (
            <div className="border-t border-border-subtle pt-4">
              <div className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-3">
                Финальные метрики
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(job.final_metrics).map(([k, v]) => (
                  <div key={k} className="bg-surface-2 rounded-lg p-2.5">
                    <div className="text-[10px] text-text-tertiary uppercase">{k}</div>
                    <div className="text-[16px] font-bold font-mono text-text-primary">
                      {typeof v === "number" ? v.toFixed(4) : String(v)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Журнал обучения (SSE / log_text) */}
        <TrainingLogPanel job={job} />
      </div>
    </div>
  );
}
