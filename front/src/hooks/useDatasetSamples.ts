import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { DatasetSamplePage } from "@/api/types";
import { useDebouncedValue } from "./useDebouncedValue";

export interface SampleFilters {
  split?: "train" | "val" | "test" | "";
  label?: "attack" | "benign" | "";
  category?: string;
  q?: string;
}

interface State {
  data: DatasetSamplePage | null;
  loading: boolean;
  error: string | null;
}

export function useDatasetSamples(
  datasetId: string | null,
  filters: SampleFilters,
  page: number,
  pageSize = 50,
  reloadKey: number = 0,
): State {
  const [state, setState] = useState<State>({ data: null, loading: false, error: null });
  const debouncedQ = useDebouncedValue(filters.q ?? "", 300);

  useEffect(() => {
    if (!datasetId) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    if (filters.split) params.set("split", filters.split);
    if (filters.label) params.set("label", filters.label);
    if (filters.category) params.set("category", filters.category);
    if (debouncedQ) params.set("q", debouncedQ);

    api
      .get<DatasetSamplePage>(`/datasets/${datasetId}/samples?${params.toString()}`)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ data, loading: false, error: null });
      })
      .catch((e: any) => {
        if (controller.signal.aborted) return;
        setState({ data: null, loading: false, error: e?.message ?? "Failed to load samples" });
      });

    return () => controller.abort();
  }, [datasetId, filters.split, filters.label, filters.category, debouncedQ, page, pageSize, reloadKey]);

  return state;
}
