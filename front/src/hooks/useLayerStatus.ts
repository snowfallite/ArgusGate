import { useState } from "react";
import { api } from "@/api/client";

export type LayerStatus = "ACTIVE" | "OBSERVING" | "DISABLED";

export function useLayerStatus(layer: number) {
  const [status, setStatus] = useState<LayerStatus>("ACTIVE");

  /** Вызвать после загрузки конфига — инициализирует статус из backend */
  const initFromConfig = (enabled: boolean | undefined) => {
    setStatus(enabled === false ? "DISABLED" : "ACTIVE");
  };

  /** Async-обработчик для onStatusChange в LayerPageHeader */
  const handleStatusChange = async (newStatus: LayerStatus) => {
    const prev = status;
    setStatus(newStatus); // оптимистично
    try {
      const enabled = newStatus !== "DISABLED";
      await api.put(`/layers/${layer}/config`, { enabled });
      // Немедленно обновить точки в TopBar без ожидания следующего polling-цикла
      window.dispatchEvent(
        new CustomEvent("argus:layerStatusChanged", { detail: { layer, enabled } })
      );
    } catch {
      setStatus(prev); // откат при ошибке
    }
  };

  return { status, initFromConfig, handleStatusChange };
}
