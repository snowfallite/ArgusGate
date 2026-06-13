import { api } from "@/api/client";

interface CategoriesResponse {
  categories: string[];
}

const TTL_MS = 5 * 60 * 1000;

let cache: { value: string[]; ts: number } | null = null;
let inflight: Promise<string[]> | null = null;

export async function fetchAuditCategories(force = false): Promise<string[]> {
  const now = Date.now();
  if (!force && cache && now - cache.ts < TTL_MS) {
    return cache.value;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await api.get<CategoriesResponse | string[]>("/audit/categories");
      const list = Array.isArray(res) ? res : res.categories;
      cache = { value: list, ts: Date.now() };
      return list;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function clearAuditCategoryCache(): void {
  cache = null;
}
