import { useEffect, useState, useCallback } from "react";
import { api } from "@/api/client";

const LAYER_COUNT = 7;
const POLL_INTERVAL_MS = 60_000;

export interface LayerStatus {
  n: number;
  enabled: boolean | null; // null = загружается
}

export interface SystemStatus {
  healthy: boolean | null; // null = загружается
  layers: LayerStatus[];
}

/**
 * Получает статус здоровья системы и состояние всех 7 слоёв обнаружения.
 * Обновляется каждые 60 секунд.
 */
export function useSystemStatus(): SystemStatus {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [layers, setLayers] = useState<LayerStatus[]>(
    Array.from({ length: LAYER_COUNT }, (_, i) => ({ n: i + 1, enabled: null }))
  );

  const fetchAll = useCallback(async () => {
    // Health check через /api/system/device
    try {
      await api.get("/system/device");
      setHealthy(true);
    } catch {
      setHealthy(false);
    }

    // Статусы слоёв — параллельно
    const results = await Promise.allSettled(
      Array.from({ length: LAYER_COUNT }, (_, i) =>
        api.get<{ enabled?: boolean }>(`/layers/${i + 1}/config`)
      )
    );

    setLayers(
      results.map((result, i) => ({
        n: i + 1,
        enabled: result.status === "fulfilled" ? (result.value.enabled ?? true) : null,
      }))
    );
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  // Слушаем событие от useLayerStatus — обновляем точку мгновенно при переключении
  useEffect(() => {
    const handler = (e: Event) => {
      const { layer: n, enabled } = (e as CustomEvent<{ layer: number; enabled: boolean }>).detail;
      setLayers(prev => prev.map(l => l.n === n ? { ...l, enabled } : l));
    };
    window.addEventListener("argus:layerStatusChanged", handler);
    return () => window.removeEventListener("argus:layerStatusChanged", handler);
  }, []);

  return { healthy, layers };
}
