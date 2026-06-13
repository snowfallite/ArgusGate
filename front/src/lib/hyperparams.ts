/**
 * Метаданные гиперпараметров обучения LoRA (см. backend/app/training/lora_trainer.py).
 * Используется в JobWizardModal для рендера полей и tooltip-подсказок.
 *
 * Сохраняем только основные параметры — расширенные (warmup_ratio/weight_decay)
 * не поддерживаются текущим backend и не показываются.
 */
export interface HyperparamMeta {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  recommended: [number, number];
  tooltip: string;
  format?: (v: number) => string;
}

export const HYPERPARAM_KEYS = ["lora_r", "lora_alpha", "epochs", "learning_rate"] as const;
export type HyperparamKey = (typeof HYPERPARAM_KEYS)[number];

export const HYPERPARAMS: Record<HyperparamKey, HyperparamMeta> = {
  lora_r: {
    key: "lora_r",
    label: "LoRA r",
    min: 4,
    max: 64,
    step: 1,
    default: 16,
    recommended: [8, 32],
    tooltip:
      "Размер обучаемой надстройки над базовой моделью. Больше — точнее адаптация под датасет, но дольше обучение и крупнее файл.",
  },
  lora_alpha: {
    key: "lora_alpha",
    label: "LoRA alpha",
    min: 8,
    max: 128,
    step: 1,
    default: 32,
    recommended: [16, 64],
    tooltip:
      "Сила влияния надстройки на ответы модели. Обычно ставят вдвое больше LoRA r.",
  },
  epochs: {
    key: "epochs",
    label: "Epochs",
    min: 1,
    max: 20,
    step: 1,
    default: 3,
    recommended: [2, 5],
    tooltip:
      "Сколько раз модель прочитает обучающую выборку. Меньше — недоучится, больше — начнёт запоминать конкретные примеры.",
  },
  learning_rate: {
    key: "learning_rate",
    label: "Learning rate",
    min: 5e-5,
    max: 5e-3,
    step: 5e-5,
    default: 2e-4,
    recommended: [1e-4, 3e-4],
    tooltip:
      "Шаг изменения весов на каждом обновлении. Слишком большой — обучение нестабильно, слишком маленький — медленное.",
    format: (v) => v.toExponential(1).replace("e-0", "e-").replace("e+0", "e+"),
  },
};

export function defaultHyperparams(): Record<HyperparamKey, number> {
  return HYPERPARAM_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: HYPERPARAMS[key].default }),
    {} as Record<HyperparamKey, number>,
  );
}

export function withinRecommended(meta: HyperparamMeta, value: number): boolean {
  const [lo, hi] = meta.recommended;
  return value >= lo && value <= hi;
}

export function formatHyperparam(meta: HyperparamMeta, value: number): string {
  return meta.format ? meta.format(value) : String(value);
}
