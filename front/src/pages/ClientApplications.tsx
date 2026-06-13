import { useState, useEffect, useCallback } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import {
  Plus, Trash2, RotateCw, Copy, Check, Eye, EyeOff, AppWindow, X,
  Power, Pencil, Clock, Hash, Key, Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface ClientApp {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  last_used_at: string | null;
  gateway_key_masked: string | null;
}

interface ClientAppCreated extends ClientApp {
  gateway_key: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  api_key_masked: string | null;
}

// ─── small UI atoms ──────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-surface-2 hover:bg-surface-3 border border-border-default text-[12px] text-text-secondary transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
      {label && <span>{copied ? "Скопировано" : label}</span>}
    </button>
  );
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} дн назад`;
  return new Date(iso).toLocaleDateString();
}

// ─── New token banner (one-time reveal) ──────────────────────────────────────

function NewKeyBanner({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid rgba(70,167,88,0.3)" }}
    >
      <div className="h-1 w-full" style={{ background: "var(--status-success)", opacity: 0.7 }} />
      <div className="px-5 py-4 flex flex-col gap-3 bg-[rgba(70,167,88,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "rgba(70,167,88,0.12)", color: "var(--status-success)", border: "1px solid rgba(70,167,88,0.25)" }}
            >
              <Key className="w-4 h-4" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[14px] font-semibold text-status-success">Gateway-токен выдан</span>
              <span className="text-[11px] text-text-secondary">Скопируйте сейчас — повторно показан не будет.</span>
            </div>
          </div>
          <button onClick={onDismiss} className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-3">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-surface-1 border border-border-default rounded-md text-[12px] font-mono text-text-primary break-all">
            {token}
          </code>
          <CopyButton value={token} label="Скопировать" />
        </div>
      </div>
    </div>
  );
}

// ─── Create modal ────────────────────────────────────────────────────────────

function CreateModal({
  open,
  onCreated,
  onClose,
}: {
  open: boolean;
  onCreated: (app: ClientAppCreated) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setName(""); setDescription(""); setError("");
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await api.post<ClientAppCreated>("/client-apps", {
        name: name.trim(),
        description: description.trim() || null,
      });
      onCreated(res);
    } catch (e: any) {
      setError(e.message ?? "Ошибка создания");
    }
    setSubmitting(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ paddingTop: "var(--topbar-h, 72px)", paddingBottom: "16px", paddingLeft: "calc(var(--sidebar-w, 280px) + 16px)", paddingRight: "16px" }}
    >
      <div className="absolute inset-0 bg-black/50" style={{ backdropFilter: "blur(3px)" }} onClick={!submitting ? onClose : undefined} />

      <div className="relative w-full max-w-[520px] bg-surface-1 rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ border: "1px solid var(--border-subtle)" }}>
        <div className="h-1 w-full" style={{ background: "var(--accent)", opacity: 0.7 }} />

        <div className="flex items-start justify-between px-5 py-4 bg-surface-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[rgba(74,158,255,0.1)] border border-[rgba(74,158,255,0.25)]">
              <AppWindow className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-[14px] font-semibold text-text-primary pt-0.5">Новое приложение</h3>
          </div>
          <button onClick={onClose} disabled={submitting} className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-3 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Название</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              maxLength={200}
              autoFocus
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Описание</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-accent resize-y"
            />
          </div>
          {error && (
            <div className="text-[12px] px-3 py-2 rounded-md bg-[rgba(229,72,77,0.08)] text-status-critical">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-surface-2 border-t border-border-subtle">
          <button onClick={onClose} disabled={submitting} className="px-3.5 py-1.5 rounded-md text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-3 disabled:opacity-40">
            Отмена
          </button>
          <button onClick={submit} disabled={submitting || !name.trim()} className="px-4 py-1.5 rounded-md bg-accent text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-50">
            {submitting ? "Создание..." : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit modal ──────────────────────────────────────────────────────────────

function EditModal({
  app, onSaved, onClose,
}: {
  app: ClientApp;
  onSaved: (a: ClientApp) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const updated = await api.put<ClientApp>(`/client-apps/${app.id}`, {
        name: name.trim(),
        description: description.trim() || null,
      });
      onSaved(updated);
    } catch (e: any) {
      setError(e.message ?? "Ошибка сохранения");
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ paddingTop: "var(--topbar-h, 72px)", paddingBottom: "16px", paddingLeft: "calc(var(--sidebar-w, 280px) + 16px)", paddingRight: "16px" }}>
      <div className="absolute inset-0 bg-black/50" style={{ backdropFilter: "blur(3px)" }} onClick={!submitting ? onClose : undefined} />

      <div className="relative w-full max-w-[520px] bg-surface-1 rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ border: "1px solid var(--border-subtle)" }}>
        <div className="h-1 w-full" style={{ background: "var(--accent)", opacity: 0.7 }} />

        <div className="flex items-start justify-between px-5 py-4 bg-surface-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[rgba(74,158,255,0.1)] border border-[rgba(74,158,255,0.25)]">
              <Pencil className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-[14px] font-semibold text-text-primary pt-0.5">Редактирование</h3>
          </div>
          <button onClick={onClose} disabled={submitting} className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-3 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Название</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              maxLength={200}
              autoFocus
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-secondary">Описание</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-accent resize-y"
            />
          </div>
          {error && (
            <div className="text-[12px] px-3 py-2 rounded-md bg-[rgba(229,72,77,0.08)] text-status-critical">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-surface-2 border-t border-border-subtle">
          <button onClick={onClose} disabled={submitting} className="px-3.5 py-1.5 rounded-md text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-3 disabled:opacity-40">
            Отмена
          </button>
          <button onClick={submit} disabled={submitting || !name.trim()} className="px-4 py-1.5 rounded-md bg-accent text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-50">
            {submitting ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Provider key card ───────────────────────────────────────────────────────

function ProviderKeyCard({
  provider,
  onSaved,
}: {
  provider: ProviderInfo;
  onSaved: () => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState(!provider.configured);

  const save = async () => {
    if (!newKey.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      await api.put(`/settings/providers/${provider.id}`, { api_key: newKey });
      setMsg({ type: "success", text: "Сохранено" });
      setNewKey("");
      setEditing(false);
      onSaved();
      setTimeout(() => setMsg(null), 2000);
    } catch (e: any) {
      setMsg({ type: "error", text: e.message ?? "Ошибка" });
    }
    setSaving(false);
  };

  const brand = provider.id === "openai"
    ? { color: "#10A37F", bg: "rgba(16,163,127,0.12)", border: "rgba(16,163,127,0.25)" }
    : { color: "#9758FF", bg: "rgba(151,88,255,0.12)", border: "rgba(151,88,255,0.25)" };

  return (
    <div className="rounded-2xl overflow-hidden bg-surface-1" style={{ border: "1px solid var(--border-subtle)" }}>
      <div className="h-1 w-full" style={{ background: brand.color, opacity: provider.configured ? 0.7 : 0.3 }} />

      <div className="px-5 py-4 flex items-start justify-between gap-3 bg-surface-2">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-[14px] font-bold shrink-0"
            style={{ background: brand.bg, color: brand.color, border: `1px solid ${brand.border}` }}
          >
            {provider.name[0]}
          </div>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[14px] font-semibold text-text-primary">{provider.name}</h3>
            {provider.configured ? (
              <p className="text-[11px] font-mono text-text-tertiary">{provider.api_key_masked}</p>
            ) : (
              <p className="text-[11px] text-status-warning">Ключ не задан</p>
            )}
          </div>
        </div>

        {provider.configured ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[rgba(70,167,88,0.1)] text-status-success border border-[rgba(70,167,88,0.2)]">
            <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
            настроен
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-3 text-text-tertiary border border-border-default">
            не настроен
          </span>
        )}
      </div>

      <div className="px-5 py-4 flex flex-col gap-2">
        {editing ? (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={show ? "text" : "password"}
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && save()}
                  placeholder={provider.configured ? "Новый ключ" : `${provider.name} API key`}
                  className="w-full bg-surface-1 border border-border-default rounded-md pl-3 pr-10 py-2 text-[13px] font-mono focus:outline-none focus:border-accent"
                />
                <button type="button" onClick={() => setShow(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button onClick={save} disabled={saving || !newKey.trim()} className="px-3 py-1.5 bg-accent text-white rounded-md text-[12px] font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap">
                {saving ? "..." : "Сохранить"}
              </button>
              {provider.configured && (
                <button onClick={() => { setEditing(false); setNewKey(""); }} className="px-3 py-1.5 rounded-md text-[12px] text-text-secondary hover:bg-surface-3">
                  Отмена
                </button>
              )}
            </div>
          </>
        ) : (
          <button onClick={() => setEditing(true)} className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-2 hover:bg-surface-3 border border-border-default text-[12px] text-text-secondary">
            <Pencil className="w-3.5 h-3.5" />
            Изменить ключ
          </button>
        )}

        {msg && (
          <div className={cn(
            "text-[12px] px-3 py-1.5 rounded-md",
            msg.type === "success" ? "bg-[rgba(70,167,88,0.1)] text-status-success" : "bg-[rgba(229,72,77,0.1)] text-status-critical"
          )}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Hero app card (main info + actions) ─────────────────────────────────────

function AppHeroCard({
  app,
  onEdit,
  onAskRegenerate,
  onAskToggle,
  onAskDelete,
}: {
  app: ClientApp;
  onEdit: () => void;
  onAskRegenerate: () => void;
  onAskToggle: () => void;
  onAskDelete: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const accent = app.is_active ? "var(--status-success)" : "var(--text-tertiary)";

  return (
    <div className="rounded-2xl shadow-sm overflow-hidden bg-surface-1" style={{ border: "1px solid var(--border-subtle)" }}>
      <div className="h-1 w-full" style={{ background: accent, opacity: app.is_active ? 0.7 : 0.35 }} />

      {/* Header */}
      <div className="flex items-start justify-between px-6 py-5 bg-surface-2 gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
              app.is_active
                ? "bg-[rgba(74,158,255,0.1)] border border-[rgba(74,158,255,0.25)]"
                : "bg-surface-3 border border-border-subtle"
            )}
          >
            <AppWindow className={cn("w-6 h-6", app.is_active ? "text-accent" : "text-text-tertiary")} />
          </div>
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[18px] font-semibold text-text-primary truncate">{app.name}</h2>
              {app.is_active ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[rgba(70,167,88,0.1)] text-status-success border border-[rgba(70,167,88,0.2)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
                  активно
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-3 text-text-tertiary border border-border-default">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />
                  отключено
                </span>
              )}
            </div>
            {app.description && (
              <p className="text-[13px] text-text-secondary leading-relaxed">{app.description}</p>
            )}
          </div>
        </div>

        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-1 hover:bg-surface-3 border border-border-default text-[12px] text-text-secondary transition-colors shrink-0"
        >
          <Pencil className="w-3.5 h-3.5" />
          Редактировать
        </button>
      </div>

      {/* Meta grid */}
      <div className="px-6 py-4 grid grid-cols-3 gap-3">
        {[
          { icon: <Hash className="w-3.5 h-3.5" />, label: "ID", value: app.id, mono: true },
          { icon: <Clock className="w-3.5 h-3.5" />, label: "Создано", value: relativeTime(app.created_at) },
          { icon: <Clock className="w-3.5 h-3.5" />, label: "Использовано", value: app.last_used_at ? relativeTime(app.last_used_at) : "никогда" },
        ].map(({ icon, label, value, mono }) => (
          <div
            key={label}
            className="flex flex-col gap-1 rounded-xl px-3 py-2.5"
            style={{ background: "rgba(255,255,255,0.025)", border: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center gap-1.5 text-text-tertiary">
              {icon}
              <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
            </div>
            <span className={cn("text-[13px] text-text-primary truncate", mono && "font-mono")}>{value}</span>
          </div>
        ))}
      </div>

      {/* Gateway token */}
      <div className="px-6 py-4 flex flex-col gap-2 border-t border-border-subtle">
        <div className="flex items-center gap-1.5 text-text-tertiary">
          <Key className="w-3 h-3" />
          <span className="text-[10px] uppercase tracking-wider font-medium">Gateway-токен</span>
        </div>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 px-3 py-2 rounded-md text-[12px] font-mono truncate"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", color: revealed ? "var(--text-primary)" : "var(--text-tertiary)" }}
          >
            {revealed && app.gateway_key_masked ? app.gateway_key_masked : "•".repeat(32)}
          </code>
          <button
            onClick={() => setRevealed(v => !v)}
            className="p-2 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-3"
            title={revealed ? "Скрыть" : "Показать маску"}
          >
            {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onAskRegenerate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-surface-2 hover:bg-surface-3 border border-border-default text-[12px] text-text-secondary transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Перевыпустить
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="px-6 py-4 flex items-center justify-between gap-3 bg-surface-2 border-t border-border-subtle">
        <button
          onClick={onAskToggle}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[12px] transition-colors",
            app.is_active
              ? "bg-surface-1 hover:bg-[rgba(245,166,35,0.1)] border-border-default text-status-warning"
              : "bg-surface-1 hover:bg-[rgba(70,167,88,0.1)] border-border-default text-status-success"
          )}
        >
          <Power className="w-3.5 h-3.5" />
          {app.is_active ? "Отключить" : "Включить"}
        </button>

        <button
          onClick={onAskDelete}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-1 hover:bg-[rgba(229,72,77,0.1)] border border-border-default text-status-critical text-[12px] transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Удалить
        </button>
      </div>
    </div>
  );
}

// ─── Endpoint info card ──────────────────────────────────────────────────────

function EndpointInfoCard({ token }: { token: string | null }) {
  const endpoint = `${window.location.origin}/v1/chat/completions`;
  const authExample = token ? `Bearer ${token.slice(0, 14)}...` : "Bearer <gateway-token>";

  return (
    <div className="rounded-2xl overflow-hidden bg-surface-1" style={{ border: "1px solid var(--border-subtle)" }}>
      <div className="h-1 w-full" style={{ background: "var(--accent)", opacity: 0.5 }} />
      <div className="px-5 py-4 bg-surface-2 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[rgba(74,158,255,0.1)] border border-[rgba(74,158,255,0.25)]">
          <Link2 className="w-4 h-4 text-accent" />
        </div>
        <h3 className="text-[14px] font-semibold text-text-primary">Endpoint</h3>
      </div>
      <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">POST</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-1.5 rounded-md bg-surface-2 border border-border-subtle font-mono text-[12px] text-text-primary truncate">
              {endpoint}
            </code>
            <CopyButton value={endpoint} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">Authorization</span>
          <code className="px-3 py-1.5 rounded-md bg-surface-2 border border-border-subtle font-mono text-[12px] text-text-tertiary truncate">
            {authExample}
          </code>
        </div>
      </div>
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

function SubsectionHeader({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1">
      <h2 className="text-[15px] font-semibold text-text-primary flex items-center gap-2">
        {icon}
        {title}
      </h2>
      {hint && <span className="text-[11px] text-text-tertiary">{hint}</span>}
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="rounded-2xl flex flex-col items-center justify-center gap-4 py-20 px-6 text-center"
      style={{ border: "1px dashed var(--border-default)", background: "var(--surface-1)" }}
    >
      <div className="w-14 h-14 rounded-2xl bg-[rgba(74,158,255,0.08)] border border-[rgba(74,158,255,0.2)] flex items-center justify-center">
        <AppWindow className="w-7 h-7 text-accent opacity-70" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold text-text-primary">Приложение не создано</span>
        <span className="text-[12px] text-text-tertiary max-w-md">
          Создайте приложение, получите gateway-токен и подключите его в клиентском коде вместо прямого ключа OpenAI / Anthropic.
        </span>
      </div>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-md text-[13px] font-medium hover:opacity-90"
      >
        <Plus className="w-4 h-4" />
        Создать приложение
      </button>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

type ConfirmAction =
  | { kind: "delete"; app: ClientApp }
  | { kind: "regenerate"; app: ClientApp }
  | { kind: "toggle"; app: ClientApp }
  | null;

export function ClientApplications() {
  const [apps, setApps] = useState<ClientApp[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingApp, setEditingApp] = useState<ClientApp | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appsRes, provRes] = await Promise.all([
        api.get<ClientApp[]>("/client-apps"),
        api.get<ProviderInfo[]>("/settings/providers"),
      ]);
      setApps(appsRes);
      setProviders(provRes);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const reloadProviders = async () => {
    try {
      const provRes = await api.get<ProviderInfo[]>("/settings/providers");
      setProviders(provRes);
    } catch {}
  };

  const onCreated = (app: ClientAppCreated) => {
    setApps([app]);
    setNewToken(app.gateway_key);
    setShowCreate(false);
  };

  const onUpdated = (updated: ClientApp) => {
    setApps(prev => prev.map(a => (a.id === updated.id ? updated : a)));
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.kind === "delete") {
        await api.delete(`/client-apps/${confirm.app.id}`);
        setApps(prev => prev.filter(a => a.id !== confirm.app.id));
      } else if (confirm.kind === "regenerate") {
        const res = await api.post<ClientAppCreated>(`/client-apps/${confirm.app.id}/regenerate-key`);
        onUpdated(res);
        setNewToken(res.gateway_key);
      } else if (confirm.kind === "toggle") {
        const updated = await api.put<ClientApp>(`/client-apps/${confirm.app.id}`, {
          is_active: !confirm.app.is_active,
        });
        onUpdated(updated);
      }
      setConfirm(null);
    } catch {}
    setConfirmBusy(false);
  };

  const confirmConfig = (() => {
    if (!confirm) return null;
    if (confirm.kind === "delete") {
      return {
        variant: "danger" as const,
        title: `Удалить «${confirm.app.name}»?`,
        body: <>Действие необратимо. Gateway-токен перестанет работать.</>,
        confirmLabel: "Удалить",
      };
    }
    if (confirm.kind === "regenerate") {
      return {
        variant: "warning" as const,
        title: "Перевыпустить токен?",
        body: <>Старый токен перестанет работать сразу. Новый отобразится один раз.</>,
        confirmLabel: "Перевыпустить",
      };
    }
    if (confirm.kind === "toggle") {
      const action = confirm.app.is_active ? "Отключить" : "Включить";
      return {
        variant: (confirm.app.is_active ? "warning" : "info") as "warning" | "info",
        title: `${action} «${confirm.app.name}»?`,
        body: confirm.app.is_active
          ? <>Токен временно перестанет принимать запросы.</>
          : <>Токен снова начнёт принимать запросы.</>,
        confirmLabel: action,
      };
    }
    return null;
  })();

  const app = apps[0] ?? null;

  return (
    <div className="flex flex-col h-full gap-5 pb-6">
      <SectionHeader title="Клиентское приложение" />

      {loading ? (
        <div className="h-64 bg-surface-2 rounded-2xl animate-pulse" />
      ) : !app ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : (
        <div className="flex flex-col gap-6">
          {newToken && <NewKeyBanner token={newToken} onDismiss={() => setNewToken(null)} />}

          {/* Hero card */}
          <AppHeroCard
            app={app}
            onEdit={() => setEditingApp(app)}
            onAskRegenerate={() => setConfirm({ kind: "regenerate", app })}
            onAskToggle={() => setConfirm({ kind: "toggle", app })}
            onAskDelete={() => setConfirm({ kind: "delete", app })}
          />

          {/* Endpoint */}
          <EndpointInfoCard token={newToken} />

          {/* Providers */}
          <div className="flex flex-col gap-3">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {providers.map(p => (
                <ProviderKeyCard key={p.id} provider={p} onSaved={reloadProviders} />
              ))}
            </div>
          </div>
        </div>
      )}

      <CreateModal open={showCreate} onCreated={onCreated} onClose={() => setShowCreate(false)} />

      {editingApp && (
        <EditModal
          app={editingApp}
          onSaved={(a) => { onUpdated(a); setEditingApp(null); }}
          onClose={() => setEditingApp(null)}
        />
      )}

      {confirmConfig && (
        <ConfirmDialog
          open
          variant={confirmConfig.variant}
          title={confirmConfig.title}
          body={confirmConfig.body}
          confirmLabel={confirmConfig.confirmLabel}
          busy={confirmBusy}
          onConfirm={handleConfirm}
          onCancel={() => !confirmBusy && setConfirm(null)}
        />
      )}
    </div>
  );
}
