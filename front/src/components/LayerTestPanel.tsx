import { useState } from "react";
import { Play, AlertCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { api, layerTestPath } from "@/api/client";
import type { DetectionResult } from "@/api/types";
import { StatusPill } from "@/components/StatusPill";

interface Props {
  layerId: number;
  placeholder?: string;
}

function verdictStatus(v: string): "critical" | "warning" | "info" | "success" {
  if (v === "block") return "critical";
  if (v === "escalate") return "warning";
  if (v === "suspicious") return "warning";
  return "success";
}

const JUDGE_ERROR_MESSAGES: Record<string, { title: string; hint?: string }> = {
  "judge_error:no_api_key": {
    title: "API-ключ не настроен для провайдера",
    hint: "Перейдите в Настройки → Провайдеры LLM и добавьте ключ.",
  },
  "judge_error:auth_failed": {
    title: "API-ключ недействителен (401 Unauthorized)",
    hint: "Проверьте ключ провайдера в разделе Настройки.",
  },
  "judge_error:forbidden": {
    title: "Доступ запрещён (403 Forbidden)",
    hint: "Ключ не имеет доступа к выбранной модели.",
  },
  "judge_error:rate_limited": {
    title: "Превышен лимит запросов (429 Too Many Requests)",
    hint: "Подождите немного или смените модель.",
  },
  "judge_error:provider_down": {
    title: "Сервис провайдера недоступен (5xx)",
    hint: "Попробуйте позже или смените провайдера.",
  },
  "judge_error:network_error": {
    title: "Ошибка сети: не удалось подключиться к провайдеру",
    hint: "Проверьте сетевое соединение и доступность API.",
  },
  "judge_error:timeout": {
    title: "Таймаут запроса (превышено 30 сек.)",
    hint: "Попробуйте ещё раз или выберите более быструю модель.",
  },
  "judge_error:invalid_response": {
    title: "Некорректный ответ модели (не JSON)",
    hint: "Модель вернула ответ не в ожидаемом формате.",
  },
  "judge_unavailable": {
    title: "Судья недоступен (неизвестная ошибка)",
    hint: "Проверьте логи сервера для подробностей.",
  },
};

function isJudgeError(reason: string): boolean {
  return reason.startsWith("judge_error:") || reason === "judge_unavailable";
}

function getJudgeErrorInfo(reason: string): { title: string; hint?: string } {
  return JUDGE_ERROR_MESSAGES[reason] ?? { title: reason };
}

export function LayerTestPanel({ layerId, placeholder }: Props) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // L7 only: слайдер симулируемого score от L4 (по умолчанию 0.75 = зона escalate)
  const [simulatedL4Score, setSimulatedL4Score] = useState(0.75);

  const handleTest = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const body: Record<string, unknown> = { text };
      if (layerId === 7) body.simulated_l4_score = simulatedL4Score;
      const res = await api.post<DetectionResult>(layerTestPath(layerId), body);
      setResult(res);
    } catch (e: any) {
      setError(e.message || "Ошибка теста");
    }
    setLoading(false);
  };

  const judgeError = result && isJudgeError(result.reason)
    ? getJudgeErrorInfo(result.reason)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-[13px] font-medium text-text-secondary">Входной текст</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? "Введите текст для анализа..."}
          className="w-full bg-surface-1 border border-border-default rounded-xl px-4 py-3 text-[13px] font-mono text-text-primary focus:outline-none focus:border-accent min-h-[120px] resize-y"
        />
      </div>

      {/* L7 only: слайдер симулируемого L4 score для управления условием вызова судьи */}
      {layerId === 7 && (
        <div className="flex flex-col gap-1.5 p-3 bg-surface-2 border border-border-subtle rounded-xl">
          <div className="flex items-center justify-between">
            <label className="text-[12px] text-text-secondary font-medium">
              Симулируемый score L4
            </label>
            <span className="text-[12px] font-mono text-text-primary">
              {simulatedL4Score.toFixed(2)}
              {" — "}
              <span className={simulatedL4Score >= 0.85 ? "text-status-critical" : simulatedL4Score >= 0.4 ? "text-status-warning" : "text-status-success"}>
                {simulatedL4Score >= 0.85 ? "block" : simulatedL4Score >= 0.4 ? "escalate → вызов судьи" : "pass (судья не вызовется)"}
              </span>
            </span>
          </div>
          <input
            type="range"
            min={0} max={1} step={0.01}
            value={simulatedL4Score}
            onChange={e => setSimulatedL4Score(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[10px] text-text-tertiary">
            <span>0.0 pass</span>
            <span>0.4 escalate</span>
            <span>0.85 block</span>
          </div>
        </div>
      )}

      <button
        onClick={handleTest}
        disabled={loading || !text.trim()}
        className="self-start flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        Запустить тест
      </button>

      {/* Hard API / network error (request itself failed) */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-[rgba(229,72,77,0.1)] border border-[rgba(229,72,77,0.2)] rounded-lg text-status-critical text-[13px]">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Judge-unavailable error banner (request succeeded but judge couldn't run) */}
      {judgeError && (
        <div className="flex flex-col gap-2 p-4 rounded-xl"
          style={{ background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.25)" }}>
          <div className="flex items-center gap-2 text-[#F5A623]">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="text-[13px] font-semibold">{judgeError.title}</span>
          </div>
          {judgeError.hint && (
            <p className="text-[12px] text-text-secondary pl-6">{judgeError.hint}</p>
          )}
          {judgeError.hint?.includes("Настройки") && (
            <a
              href="/settings"
              className="self-start flex items-center gap-1.5 pl-6 text-[12px] text-accent hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Перейти в Настройки
            </a>
          )}
          <p className="text-[11px] text-text-tertiary pl-6 mt-1">
            Вердикт <strong className="text-text-secondary">PASS</strong> выставлен автоматически (fail-open) — запрос пропущен, не заблокирован.
          </p>
        </div>
      )}

      {/* L4: модель не загружена — показываем предупреждение вместо зелёного PASS */}
      {result && result.verdict === "pass" &&
        (result.reason?.includes("model_not_loaded") || result.reason?.includes("not loaded")) && (
        <div className="flex flex-col gap-1.5 p-4 rounded-xl"
          style={{ background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.25)" }}>
          <div className="flex items-center gap-2 text-[#F5A623]">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="text-[13px] font-semibold">Модель ML не загружена — тест не выполнен</span>
          </div>
          <p className="text-[12px] text-text-secondary pl-6">
            Классификатор вернул PASS автоматически (graceful degradation). Установите модель через вкладку&nbsp;
            <a href="/layers/4" className="text-accent hover:underline">Конфигурации L4</a>.
          </p>
        </div>
      )}

      {result && !judgeError &&
        !(result.verdict === "pass" &&
          (result.reason?.includes("model_not_loaded") || result.reason?.includes("not loaded"))) && (
        <div className="flex flex-col gap-3 p-4 bg-surface-2 border border-border-default rounded-xl">
          <div className="flex items-center gap-3">
            <StatusPill status={verdictStatus(result.verdict)} label={result.verdict.toUpperCase()} />
            <span className="text-[13px] text-text-secondary font-mono">оценка: {result.score.toFixed(4)}</span>
            <span className="ml-auto text-[12px] text-text-tertiary font-mono">{result.latency_ms.toFixed(1)}ms</span>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-[13px]">
            <span className="text-text-secondary">Причина</span>
            <span className="text-text-primary font-mono">{result.reason}</span>

            {result.category && (
              <>
                <span className="text-text-secondary">Категория</span>
                <span className="text-text-primary">{result.category}</span>
              </>
            )}

            {result.matched_rule && (
              <>
                <span className="text-text-secondary">Сработало правило</span>
                <span className="text-text-primary font-mono truncate">{result.matched_rule}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

