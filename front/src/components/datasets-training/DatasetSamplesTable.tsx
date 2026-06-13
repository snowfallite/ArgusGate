import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useDatasetSamples, type SampleFilters } from "@/hooks/useDatasetSamples";
import { fetchAuditCategories } from "@/lib/auditCategoryFetch";
import { cn } from "@/lib/utils";

interface Props {
  datasetId: string;
  selection: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  reloadKey?: number;
}

const PAGE_SIZE = 50;

export function DatasetSamplesTable({
  datasetId,
  selection,
  onSelectionChange,
  reloadKey = 0,
}: Props) {
  const [filters, setFilters] = useState<SampleFilters>({});
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<string[]>([]);
  const { data, loading, error } = useDatasetSamples(
    datasetId,
    filters,
    page,
    PAGE_SIZE,
    reloadKey,
  );

  useEffect(() => {
    fetchAuditCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filters.split, filters.label, filters.category, filters.q]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const pageIds = useMemo(() => data?.items.map((s) => s.id) ?? [], [data]);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selection.has(id));
  const someOnPageSelected = pageIds.some((id) => selection.has(id));

  const toggleOne = (id: string) => {
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const togglePage = () => {
    const next = new Set(selection);
    if (allOnPageSelected) {
      pageIds.forEach((id) => next.delete(id));
    } else {
      pageIds.forEach((id) => next.add(id));
    }
    onSelectionChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filters.split ?? ""}
          onChange={(e) =>
            setFilters({ ...filters, split: (e.target.value || "") as any })
          }
          className="bg-surface-2 border border-border-default rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-accent"
        >
          <option value="">split: any</option>
          <option value="train">train</option>
          <option value="val">val</option>
          <option value="test">test</option>
        </select>

        <select
          value={filters.label ?? ""}
          onChange={(e) =>
            setFilters({ ...filters, label: (e.target.value || "") as any })
          }
          className="bg-surface-2 border border-border-default rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-accent"
        >
          <option value="">label: any</option>
          <option value="attack">attack</option>
          <option value="benign">benign</option>
        </select>

        <select
          value={filters.category ?? ""}
          onChange={(e) =>
            setFilters({ ...filters, category: e.target.value || undefined })
          }
          className="bg-surface-2 border border-border-default rounded-md px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-accent"
        >
          <option value="">category: any</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
          <input
            type="text"
            value={filters.q ?? ""}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            placeholder="поиск по тексту"
            maxLength={200}
            className="w-full bg-surface-2 border border-border-default rounded-md pl-8 pr-3 py-1.5 text-[12px] focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] text-left border-collapse">
            <thead className="bg-surface-2 border-b border-border-subtle">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected;
                    }}
                    onChange={togglePage}
                    className="accent-accent cursor-pointer"
                    aria-label="выбрать страницу"
                  />
                </th>
                <th className="px-3 py-2 font-medium text-text-secondary w-20">label</th>
                <th className="px-3 py-2 font-medium text-text-secondary w-16">split</th>
                <th className="px-3 py-2 font-medium text-text-secondary w-40">category</th>
                <th className="px-3 py-2 font-medium text-text-secondary">text</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {loading && !data ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={5} className="px-3 py-2.5">
                      <div className="h-3 bg-surface-2 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-status-critical">
                    {error}
                  </td>
                </tr>
              ) : !data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-text-tertiary">
                    Нет сэмплов
                  </td>
                </tr>
              ) : (
                data.items.map((s) => {
                  const checked = selection.has(s.id);
                  return (
                    <tr
                      key={s.id}
                      className={cn(
                        "hover:bg-surface-2 transition-colors",
                        checked && "bg-accent/5",
                      )}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(s.id)}
                          className="accent-accent cursor-pointer"
                          aria-label="выбрать сэмпл"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-mono uppercase",
                            s.label === "attack"
                              ? "bg-[rgba(229,72,77,0.12)] text-status-critical"
                              : "bg-[rgba(70,167,88,0.12)] text-status-success",
                          )}
                        >
                          {s.label ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-text-tertiary text-[11px]">
                        {s.split ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-text-secondary text-[11px]">
                        {s.category ?? "—"}
                      </td>
                      <td
                        className="px-3 py-2 text-text-primary truncate max-w-[480px]"
                        title={s.text}
                      >
                        {s.text}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-text-tertiary font-mono">
        <span>
          {data ? `${data.total.toLocaleString()} всего · стр. ${page}/${totalPages}` : "—"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="p-1.5 rounded-md hover:bg-surface-2 disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="p-1.5 rounded-md hover:bg-surface-2 disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
