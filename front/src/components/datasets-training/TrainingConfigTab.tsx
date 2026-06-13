import { DeviceCard } from "@/components/layer4/DeviceCard";

/**
 * Вкладка «Конфигурация» в «Датасеты и обучение».
 * Управляет настройками устройства для LoRA-обучения (training_device).
 * Изменения применяются при следующем запуске задачи.
 */
export function TrainingConfigTab() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <DeviceCard target="training" title="Устройство для обучения" />
    </div>
  );
}
