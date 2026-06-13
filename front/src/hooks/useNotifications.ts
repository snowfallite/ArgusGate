import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/api/client";

export type NotificationSeverity = "info" | "warning" | "error" | "critical";
export type NotificationCategory = "training" | "security" | "system_health";

export interface NotificationItem {
  id: string;
  created_at: string;
  type: string;
  severity: NotificationSeverity;
  category: NotificationCategory;
  title: string;
  body?: string | null;
  payload?: Record<string, any> | null;
  read_at: string | null;
}

interface Options {
  /** Сколько последних держать в локальном state. */
  maxItems?: number;
  /** Префетчить список при mount (через REST). */
  prefetch?: boolean;
}

/**
 * SSE-подписка на /api/notifications/stream + локальный state с последними N.
 * Используется в TopBar (popover) и на странице /notifications.
 */
export function useNotifications(options: Options = {}) {
  const maxItems = options.maxItems ?? 50;
  const prefetch = options.prefetch ?? true;

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sseError, setSseError] = useState<string | null>(null);
  const sseRetryRef = useRef(0);

  const refreshUnread = useCallback(async () => {
    try {
      const res = await api.get<{ count: number }>("/notifications/unread-count");
      setUnreadCount(res.count);
    } catch {}
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const list = await api.get<NotificationItem[]>(`/notifications?limit=${maxItems}`);
      setItems(list);
    } catch {}
  }, [maxItems]);

  const markRead = useCallback(async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {}
  }, []);

  const markAllRead = useCallback(async (category?: NotificationCategory) => {
    try {
      const q = category ? `?category=${category}` : "";
      await api.post(`/notifications/mark-all-read${q}`);
      const now = new Date().toISOString();
      setItems(prev => prev.map(n =>
        (!category || n.category === category) && !n.read_at
          ? { ...n, read_at: now }
          : n
      ));
      await refreshUnread();
    } catch {}
  }, [refreshUnread]);

  // Initial prefetch
  useEffect(() => {
    if (prefetch) {
      refreshList();
      refreshUnread();
    }
  }, [prefetch, refreshList, refreshUnread]);

  // SSE
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const es = new EventSource(`/api/notifications/stream?token=${encodeURIComponent(token)}`);
    es.onmessage = (event) => {
      try {
        const note = JSON.parse(event.data) as NotificationItem;
        setItems(prev => {
          // Dedupe by id
          if (prev.some(n => n.id === note.id)) return prev;
          return [note, ...prev].slice(0, maxItems);
        });
        if (!note.read_at) {
          setUnreadCount(prev => prev + 1);
        }
      } catch {}
    };
    es.onopen = () => {
      setSseError(null);
      sseRetryRef.current = 0;
    };
    es.onerror = () => {
      sseRetryRef.current += 1;
      if (sseRetryRef.current >= 3) {
        setSseError("Поток уведомлений недоступен");
      }
    };
    return () => es.close();
  }, [maxItems]);

  return {
    items,
    unreadCount,
    markRead,
    markAllRead,
    refreshList,
    sseError,
  };
}
