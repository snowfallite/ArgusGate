import { useEffect, useRef } from "react";

export interface SessionEventPayload {
  type: "session_created" | "turn_added" | "session_deleted";
  session_id: string;
  client_app?: string | null;
  turn_count: number;
  cumulative_risk_score: number;
  status: string;
  timestamp: string;
  breakdown?: Record<string, number> | null;
}

/**
 * SSE-подписка на /api/sessions/stream. JWT передаётся в query, потому что
 * нативный EventSource не поддерживает кастомные заголовки.
 *
 * onEvent вызывается на каждое сообщение. Подписка переоткрывается
 * автоматически — на это EventSource рассчитан by-design.
 */
export function useSessionsStream(onEvent: (event: SessionEventPayload) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const url = `/api/sessions/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as SessionEventPayload;
        handlerRef.current(payload);
      } catch {
        // некорректный JSON — пропускаем
      }
    };

    es.onerror = () => {
      // EventSource сам ретраит соединение. Просто молча — UI не блокируем.
    };

    return () => es.close();
  }, []);
}
