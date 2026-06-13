import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import type { Dataset, TrainingJob } from "@/api/types";
import { useJobPolling } from "@/hooks/useJobPolling";
import { canDeleteJob, canRestartJob } from "@/lib/trainingStatus";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { JobProgressBar, JobStatusBadge } from "./JobStatusBadge";
import { JobWizardModal } from "./JobWizardModal";
import { JobDetailView } from "./JobDetailView";

interface Props {
  initialJobId?: string | null;
  onActiveJobChange?: (jobId: string | null) => void;
}

export function JobsTab({ initialJobId, onActiveJobChange }: Props) {
  const [jobs, setJobs]             = useState<TrainingJob[]>([]);
  const [datasets, setDatasets]     = useState<Dataset[]>([]);
  const [loading, setLoading]       = useState(true);
  const [view, setView]             = useState<"list" | "detail">("list");
  const [activeJob, setActiveJob]   = useState<TrainingJob | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [restartFrom, setRestartFrom] = useState<TrainingJob | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TrainingJob | null>(null);
  const [deleting, setDeleting]     = useState(false);

  useJobPolling(jobs, setJobs);

  // Начальная загрузка
  useEffect(() => {
    Promise.all([
      api.get<TrainingJob[]>("/training/jobs").then(setJobs).catch(() => {}),
      api.get<Dataset[]>("/datasets").then(setDatasets).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  // Открытие задачи через URL-параметр
  const initialApplied = useRef(false);
  useEffect(() => {
    if (initialApplied.current || !initialJobId || jobs.length === 0) return;
    const found = jobs.find((j) => j.id === initialJobId);
    if (found) {
      openDetail(found);
      initialApplied.current = true;
    }
  }, [initialJobId, jobs]);

  /**
   * Синхронизация activeJob с обновлёнными данными из poll.
   * Список-endpoint НЕ возвращает log_text — сохраняем его из предыдущего состояния,
   * чтобы TrainingLogPanel не потерял накопленный лог завершённой задачи.
   */
  useEffect(() => {
    if (!activeJob) return;
    const fresh = jobs.find((j) => j.id === activeJob.id);
    if (!fresh || fresh === activeJob) return;

    setActiveJob((prev) =>
      prev
        ? {
            ...fresh,
            // Сохраняем log_text: poll не возвращает его (TrainingJobListItem),
            // но SSE-hook получает его через detail-endpoint при открытии.
            log_text: prev.log_text ?? fresh.log_text,
          }
        : fresh,
    );
  }, [jobs]);

  // Сигнализируем родителю об изменении активной задачи (для URL sync)
  useEffect(() => {
    onActiveJobChange?.(view === "detail" ? (activeJob?.id ?? null) : null);
  }, [view, activeJob?.id, onActiveJobChange]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  /**
   * Открывает detail-view.
   * Для завершённых/упавших задач — делает fetch полной записи с log_text,
   * т.к. list-endpoint его не возвращает.
   */
  const openDetail = async (job: TrainingJob) => {
    setActiveJob(job);
    setView("detail");

    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      try {
        const full = await api.get<TrainingJob>(`/training/jobs/${job.id}`);
        setActiveJob(full);
      } catch {
        // Если fetch не удался — показываем то что есть
      }
    }
  };

  const handleCreated = (job: TrainingJob) => {
    setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
    setActiveJob(job);
    setView("detail");
    setRestartFrom(null);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/training/jobs/${pendingDelete.id}`);
      setJobs((prev) => prev.filter((j) => j.id !== pendingDelete.id));
      if (activeJob?.id === pendingDelete.id) {
        setActiveJob(null);
        setView("list");
      }
      setPendingDelete(null);
    } catch (e: any) {
      alert(e?.message ?? "Не удалось удалить");
    } finally {
      setDeleting(false);
    }
  };

  const handleCancel = async (job: TrainingJob) => {
    try {
      await api.post(`/training/jobs/${job.id}/cancel`, {});
      // Статус обновится через polling (~2s)
    } catch (e: any) {
      alert(e?.message ?? "Не удалось отменить задачу");
    }
  };

  // ------------------------------------------------------------------
  // Detail view
  // ------------------------------------------------------------------

  if (view === "detail" && activeJob) {
    return (
      <>
        <JobDetailView
          job={activeJob}
          onBack={() => setView("list")}
          onRestart={(j) => {
            setRestartFrom(j);
            setWizardOpen(true);
          }}
          onDelete={(j) => setPendingDelete(j)}
          onCancel={handleCancel}
        />
        <JobWizardModal
          open={wizardOpen}
          onClose={() => {
            setWizardOpen(false);
            setRestartFrom(null);
          }}
          onCreated={handleCreated}
          datasets={datasets}
          initialFromJob={restartFrom}
        />
        <ConfirmDialog
          open={!!pendingDelete}
          title={pendingDelete ? `Удалить задачу ${pendingDelete.id.slice(0, 8)}?` : ""}
          body="Лог и per-epoch метрики удалятся. Связанные модели сохранятся (training_job_id обнулится)."
          confirmLabel="Удалить"
          variant="danger"
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      </>
    );
  }

  // ------------------------------------------------------------------
  // List view
  // ------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <button
          onClick={() => {
            setRestartFrom(null);
            setWizardOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-accent text-white
                     text-[13px] font-medium hover:opacity-90 shadow-sm"
        >
          <Play className="w-4 h-4 fill-current" />
          <span>Новая задача</span>
        </button>
      </div>

      <div className="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-4 py-3 border-b border-border-subtle">
              <div className="h-4 bg-surface-2 rounded animate-pulse" />
            </div>
          ))
        ) : jobs.length === 0 ? (
          <div className="px-4 py-10 text-center text-text-tertiary text-[13px]">
            Задач нет
          </div>
        ) : (
          <table className="w-full text-[13px] text-left border-collapse">
            <thead className="bg-surface-2 border-b border-border-subtle">
              <tr>
                <th className="px-4 py-3 font-medium text-text-secondary">ID</th>
                <th className="px-4 py-3 font-medium text-text-secondary">Датасет</th>
                <th className="px-4 py-3 font-medium text-text-secondary">Статус</th>
                <th className="px-4 py-3 font-medium text-text-secondary">Запущена</th>
                <th className="px-4 py-3 font-medium text-text-secondary">Завершена</th>
                <th className="px-4 py-3 font-medium text-text-secondary w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => openDetail(job)}
                  className="hover:bg-surface-2 transition-colors cursor-pointer group"
                >
                  <td className="px-4 py-3 font-mono text-text-tertiary text-[11px]">
                    {job.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary font-mono text-[11px]">
                    {job.dataset_id ? job.dataset_id.slice(0, 8) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <JobStatusBadge status={job.status} />
                      {(job.status === "running" ||
                        (job.progress_percent > 0 && job.progress_percent < 100)) && (
                        <div className="w-40">
                          <JobProgressBar percent={job.progress_percent} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {job.started_at
                      ? new Date(job.started_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {job.completed_at
                      ? new Date(job.completed_at).toLocaleString()
                      : "—"}
                  </td>
                  <td
                    className="px-4 py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setRestartFrom(job);
                          setWizardOpen(true);
                        }}
                        disabled={!canRestartJob(job.status)}
                        title="Перезапустить"
                        className="p-1.5 rounded-md text-text-tertiary hover:text-accent
                                   hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setPendingDelete(job)}
                        disabled={!canDeleteJob(job.status)}
                        title={
                          canDeleteJob(job.status)
                            ? "Удалить"
                            : "Нельзя удалить выполняющуюся"
                        }
                        className="p-1.5 rounded-md text-text-tertiary
                                   hover:text-status-critical hover:bg-[rgba(229,72,77,0.1)]
                                   disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <JobWizardModal
        open={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
          setRestartFrom(null);
        }}
        onCreated={handleCreated}
        datasets={datasets}
        initialFromJob={restartFrom}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        title={
          pendingDelete ? `Удалить задачу ${pendingDelete.id.slice(0, 8)}?` : ""
        }
        body="Лог и per-epoch метрики удалятся. Связанные модели сохранятся (training_job_id обнулится)."
        confirmLabel="Удалить"
        variant="danger"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
