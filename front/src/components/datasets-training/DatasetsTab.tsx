import { useEffect, useState } from "react";
import { Activity, Database, Plus, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import type { Dataset } from "@/api/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CreateFromAuditModal } from "./CreateFromAuditModal";
import { DatasetDetailModal } from "./DatasetDetailModal";
import { ImportJsonlModal } from "./ImportJsonlModal";

export function DatasetsTab() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFromAudit, setShowFromAudit] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [detail, setDetail] = useState<Dataset | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Dataset | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api
      .get<Dataset[]>("/datasets")
      .then(setDatasets)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCreated = (d: Dataset) => {
    setDatasets((prev) => [d, ...prev.filter((x) => x.id !== d.id)]);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/datasets/${pendingDelete.id}`);
      setDatasets((prev) => prev.filter((d) => d.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (e: any) {
      alert(e?.message ?? "Не удалось удалить");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-secondary">{datasets.length} датасетов</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFromAudit(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-2 border border-border-default text-[13px] font-medium text-text-secondary hover:text-text-primary hover:border-accent transition-colors"
          >
            <Activity className="w-4 h-4" />
            <span>Из аудита</span>
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-accent text-white text-[13px] font-medium hover:opacity-90 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Импорт JSONL</span>
          </button>
        </div>
      </div>

      <div className="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-4 py-3 border-b border-border-subtle">
              <div className="h-4 bg-surface-2 rounded animate-pulse" />
            </div>
          ))
        ) : datasets.length === 0 ? (
          <div className="px-4 py-10 text-center text-text-tertiary text-[13px] flex flex-col items-center gap-2">
            <Database className="w-8 h-8 opacity-20" />
            <span>Датасетов нет</span>
          </div>
        ) : (
          <table className="w-full text-[13px] text-left border-collapse">
            <thead className="bg-surface-2 border-b border-border-subtle">
              <tr>
                <th className="px-4 py-3 font-medium text-text-secondary">ID</th>
                <th className="px-4 py-3 font-medium text-text-secondary">Название</th>
                <th className="px-4 py-3 font-medium text-text-secondary">Образцов</th>
                <th className="px-4 py-3 font-medium text-text-secondary">Train / Val / Test</th>
                <th className="px-4 py-3 font-medium text-text-secondary">Источник</th>
                <th className="px-4 py-3 font-medium text-text-secondary">Создан</th>
                <th className="px-4 py-3 font-medium text-text-secondary w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {datasets.map((ds) => (
                <tr
                  key={ds.id}
                  onClick={() => setDetail(ds)}
                  className="hover:bg-surface-2 transition-colors cursor-pointer group"
                >
                  <td className="px-4 py-3 font-mono text-text-tertiary text-[11px]">{ds.id.slice(0, 8)}</td>
                  <td className="px-4 py-3 font-medium text-text-primary">{ds.name}</td>
                  <td className="px-4 py-3 text-text-secondary font-mono">
                    {ds.sample_count?.toLocaleString() ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-text-tertiary font-mono text-[11px]">
                    {ds.train_count != null && ds.val_count != null && ds.test_count != null
                      ? `${ds.train_count} / ${ds.val_count} / ${ds.test_count}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-[12px]">
                    {ds.source === "from_audit"
                      ? "audit"
                      : ds.source === "imported"
                      ? "jsonl"
                      : ds.source ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {ds.created_at ? new Date(ds.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setPendingDelete(ds)}
                      className="p-1.5 rounded-md text-text-tertiary hover:text-status-critical hover:bg-[rgba(229,72,77,0.1)] opacity-0 group-hover:opacity-100 transition-all"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateFromAuditModal
        open={showFromAudit}
        onClose={() => setShowFromAudit(false)}
        onCreated={handleCreated}
      />
      <ImportJsonlModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onCreated={handleCreated}
      />
      <DatasetDetailModal
        open={!!detail}
        dataset={detail}
        onClose={() => setDetail(null)}
        onChanged={(updated) => {
          setDatasets((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
          setDetail((cur) => (cur && cur.id === updated.id ? { ...cur, ...updated } : cur));
        }}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete ? `Удалить «${pendingDelete.name}»?` : ""}
        body="Связанные training-сэмплы будут удалены. Задачи обучения сохранятся с dataset_id=NULL."
        confirmLabel="Удалить"
        variant="danger"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
