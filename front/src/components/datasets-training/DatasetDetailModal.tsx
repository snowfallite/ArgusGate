import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "@/api/client";
import type { Dataset } from "@/api/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "./Modal";
import { DatasetDistributionPanel } from "./DatasetDistributionPanel";
import { DatasetSamplesTable } from "./DatasetSamplesTable";

interface Props {
  open: boolean;
  dataset: Dataset | null;
  onClose: () => void;
  onChanged?: (dataset: Dataset) => void;
}

interface BulkDeleteResult {
  deleted: number;
  dataset: Dataset;
}

export function DatasetDetailModal({ open, dataset, onClose, onChanged }: Props) {
  const [full, setFull] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !dataset) {
      setFull(null);
      setSelection(new Set());
      setError(null);
      return;
    }
    setFull(dataset);
    setLoading(true);
    api
      .get<Dataset>(`/datasets/${dataset.id}`)
      .then(setFull)
      .catch(() => setFull(dataset))
      .finally(() => setLoading(false));
  }, [open, dataset?.id]);

  if (!dataset) return null;
  const view = full ?? dataset;
  const selectedCount = selection.size;

  const handleDelete = async () => {
    if (selectedCount === 0) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await api.post<BulkDeleteResult>(
        `/datasets/${view.id}/samples/delete`,
        { sample_ids: Array.from(selection) },
      );
      setFull(res.dataset);
      setSelection(new Set());
      setReloadKey((k) => k + 1);
      setPendingDelete(false);
      onChanged?.(res.dataset);
    } catch (e: any) {
      setError(e?.message ?? "Не удалось удалить");
      setPendingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={view.name}
      maxWidth="max-w-5xl"
      footer={
        <>
          {selectedCount > 0 && (
            <button
              onClick={() => setPendingDelete(true)}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] text-status-critical border border-status-critical/40 hover:bg-status-critical/10 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Удалить выбранные ({selectedCount})
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-3"
          >
            Закрыть
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <DatasetDistributionPanel dataset={view} />
        {loading && !full?.labels && (
          <div className="text-[11px] text-text-tertiary font-mono">обновление…</div>
        )}
        {error && (
          <div className="text-[12px] text-status-critical px-3 py-2 rounded-md bg-[rgba(229,72,77,0.08)] border border-[rgba(229,72,77,0.25)]">
            {error}
          </div>
        )}
        <div className="border-t border-border-subtle pt-4">
          <DatasetSamplesTable
            datasetId={view.id}
            selection={selection}
            onSelectionChange={setSelection}
            reloadKey={reloadKey}
          />
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete}
        title={`Удалить ${selectedCount} сэмплов?`}
        body="Сэмплы будут удалены, а train/val/test и распределение по категориям пересчитаны."
        confirmLabel="Удалить"
        variant="danger"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(false)}
      />
    </Modal>
  );
}
