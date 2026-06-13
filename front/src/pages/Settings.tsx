import { useState, useEffect, useCallback } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import {
  Check, AlertCircle, Bell, Users, Plus, Pencil, Trash2, Key,
  ShieldCheck, Eye, EyeOff,
} from "lucide-react";
import { api } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Switch } from "@/components/Switch";

// ── Shared Alert ─────────────────────────────────────────────────────────────

function Alert({ type, msg }: { type: "success" | "error"; msg: string }) {
  return (
    <div className={`flex items-center gap-2 p-3 rounded-lg text-[13px] ${
      type === "success"
        ? "bg-[rgba(70,167,88,0.1)] border border-[rgba(70,167,88,0.2)] text-status-success"
        : "bg-[rgba(229,72,77,0.1)] border border-[rgba(229,72,77,0.2)] text-status-critical"
    }`}>
      {type === "success" ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
      {msg}
    </div>
  );
}

// ── Notification preferences section ─────────────────────────────────────────

interface NotificationPrefs {
  training: boolean;
  training_progress: boolean;
  security: boolean;
  system_health: boolean;
}

function NotificationPreferencesSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    api.get<NotificationPrefs>("/notifications/preferences")
      .then(setPrefs)
      .catch(() => setPrefs({ training: true, training_progress: false, security: true, system_health: true }));
  }, []);

  const toggle = async (key: keyof NotificationPrefs) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(true);
    setMsg(null);
    try {
      const updated = await api.put<NotificationPrefs>("/notifications/preferences", next);
      setPrefs(updated);
      setMsg({ type: "success", msg: "Настройки сохранены" });
    } catch (e: any) {
      setMsg({ type: "error", msg: e.message ?? "Ошибка сохранения" });
      setPrefs(prefs);
    }
    setSaving(false);
  };

  if (!prefs) {
    return <div className="h-32 bg-surface-2 rounded-lg animate-pulse" />;
  }

  const items: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
    { key: "training", label: "Обучение моделей", desc: "Старт, завершение, ошибка тренировки" },
    { key: "training_progress", label: "Прогресс обучения по эпохам", desc: "Может порождать множество уведомлений" },
    { key: "security", label: "Уведомления безопасности", desc: "L5 карантин, L6 утечки canary/PII/exfil, L7 BLOCK" },
    { key: "system_health", label: "Состояние системы", desc: "Активация моделей, сбои LLM-провайдера, ошибки судьи" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-body-strong flex items-center gap-2 pb-2 border-b border-border-subtle">
        <Bell className="w-5 h-5 text-accent" /> Уведомления
      </h3>
      <div className="content-card flex flex-col">
        {items.map((it, idx) => (
          <div
            key={it.key}
            className={`flex items-center justify-between gap-4 py-3 ${idx > 0 ? "border-t border-border-subtle" : ""}`}
          >
            <div className="flex flex-col">
              <span className="text-[13px] font-medium text-text-primary">{it.label}</span>
              <span className="text-[11px] text-text-secondary">{it.desc}</span>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs[it.key]}
                disabled={saving}
                onChange={() => toggle(it.key)}
                className="w-4 h-4 accent-accent"
              />
            </label>
          </div>
        ))}
        {msg && <Alert type={msg.type} msg={msg.msg} />}
      </div>
    </div>
  );
}

// ── User Management ───────────────────────────────────────────────────────────

interface UserItem {
  id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  viewer: "Наблюдатель",
  operator: "Оператор",
};

const ROLE_OPTIONS = [
  { value: "admin", label: "Администратор" },
  { value: "viewer", label: "Наблюдатель" },
  { value: "operator", label: "Оператор" },
];

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

function validateUsername(v: string): string {
  if (v.length < 3) return "Минимум 3 символа";
  if (v.length > 100) return "Максимум 100 символов";
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) return "Разрешены только буквы, цифры и символы . _ -";
  return "";
}

function validateEmail(v: string): string {
  if (!v) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Некорректный формат email";
  return "";
}

function validatePassword(v: string): string {
  if (v.length < 8) return "Минимум 8 символов";
  return "";
}

// ── Create user modal ──────────────────────────────────────────────────────

interface CreateUserModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (user: UserItem) => void;
}

function CreateUserModal({ open, onClose, onCreated }: CreateUserModalProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("admin");
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUsername(""); setPassword(""); setEmail(""); setFullName("");
      setRole("admin"); setIsActive(true); setError(null); setShowPw(false);
    }
  }, [open]);

  const usernameErr = username ? validateUsername(username) : "";
  const emailErr = email ? validateEmail(email) : "";
  const passwordErr = password ? validatePassword(password) : "";
  const canSubmit = username && !usernameErr && password && !passwordErr && !emailErr && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const user = await api.post<UserItem>("/users", {
        username: username.trim(),
        password,
        email: email.trim() || null,
        full_name: fullName.trim() || null,
        role,
        is_active: isActive,
      });
      onCreated(user);
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Ошибка создания пользователя");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" style={{ backdropFilter: "blur(3px)" }}>
      <div className="w-full max-w-md bg-surface-1 rounded-2xl border border-border-subtle shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-[14px] font-semibold text-text-primary">Новый пользователь</h2>
          <button onClick={onClose} disabled={busy} className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors" aria-label="Закрыть">✕</button>
        </div>
        <div className="flex flex-col gap-4 p-5 overflow-y-auto">
          <FieldRow label="Имя пользователя *">
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={busy}
              placeholder="login_name"
              className="w-full bg-surface-1 border border-border-default rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
            {usernameErr && <FieldError msg={usernameErr} />}
          </FieldRow>

          <FieldRow label="Пароль *">
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={busy}
                placeholder="Минимум 8 символов"
                className="w-full bg-surface-1 border border-border-default rounded-md px-3 pr-10 py-2 text-[13px] focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {passwordErr && <FieldError msg={passwordErr} />}
            {password && !passwordErr && (
              <p className="text-[11px] text-text-tertiary">{password.length} символов</p>
            )}
          </FieldRow>

          <FieldRow label="Email">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={busy}
              placeholder="user@example.com"
              className="w-full bg-surface-1 border border-border-default rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
            {emailErr && <FieldError msg={emailErr} />}
          </FieldRow>

          <FieldRow label="Полное имя">
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              disabled={busy}
              maxLength={255}
              placeholder="Иванов Иван"
              className="w-full bg-surface-1 border border-border-default rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
          </FieldRow>

          <FieldRow label="Роль">
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              disabled={busy}
              className="w-full bg-surface-1 border border-border-default rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            >
              {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FieldRow>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">Активен</span>
            <Switch checked={isActive} onChange={setIsActive} disabled={busy} />
          </div>

          {error && <Alert type="error" msg={error} />}
        </div>
        <div className="px-5 py-3 border-t border-border-subtle bg-surface-2 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-3.5 py-1.5 rounded-md text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-3 disabled:opacity-40">
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-1.5 rounded-md text-[13px] font-medium bg-accent text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Создание…" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit user modal ────────────────────────────────────────────────────────

interface EditUserModalProps {
  user: UserItem | null;
  onClose: () => void;
  onUpdated: (user: UserItem) => void;
  currentUserId: string;
}

function EditUserModal({ user, onClose, onUpdated, currentUserId }: EditUserModalProps) {
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState(user?.role ?? "admin");
  const [isActive, setIsActive] = useState(user?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name ?? "");
      setEmail(user.email ?? "");
      setRole(user.role);
      setIsActive(user.is_active);
      setError(null);
    }
  }, [user]);

  if (!user) return null;

  const emailErr = email ? validateEmail(email) : "";
  const isSelf = user.id === currentUserId;

  const handleSubmit = async () => {
    if (emailErr || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<UserItem>(`/users/${user.id}`, {
        email: email.trim() || null,
        full_name: fullName.trim() || null,
        role,
        is_active: isActive,
      });
      onUpdated(updated);
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Ошибка обновления");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" style={{ backdropFilter: "blur(3px)" }}>
      <div className="w-full max-w-md bg-surface-1 rounded-2xl border border-border-subtle shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-[14px] font-semibold text-text-primary">Редактировать: {user.username}</h2>
          <button onClick={onClose} disabled={busy} className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors" aria-label="Закрыть">✕</button>
        </div>
        <div className="flex flex-col gap-4 p-5 overflow-y-auto">
          <FieldRow label="Email">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={busy}
              placeholder="user@example.com"
              className="w-full bg-surface-1 border border-border-default rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
            {emailErr && <FieldError msg={emailErr} />}
          </FieldRow>

          <FieldRow label="Полное имя">
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              disabled={busy}
              maxLength={255}
              className="w-full bg-surface-1 border border-border-default rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
            />
          </FieldRow>

          <FieldRow label="Роль">
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              disabled={busy || isSelf}
              className="w-full bg-surface-1 border border-border-default rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-accent disabled:opacity-60"
            >
              {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {isSelf && <p className="text-[11px] text-text-tertiary">Нельзя изменить роль собственной учётной записи</p>}
          </FieldRow>

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[13px] text-text-secondary">Активен</span>
              {isSelf && <span className="text-[11px] text-text-tertiary">Нельзя деактивировать себя</span>}
            </div>
            <Switch checked={isActive} onChange={setIsActive} disabled={busy || isSelf} />
          </div>

          {error && <Alert type="error" msg={error} />}
        </div>
        <div className="px-5 py-3 border-t border-border-subtle bg-surface-2 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-3.5 py-1.5 rounded-md text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-3 disabled:opacity-40">
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={!!emailErr || busy}
            className="px-4 py-1.5 rounded-md text-[13px] font-medium bg-accent text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Change password modal ──────────────────────────────────────────────────

interface ChangePasswordModalProps {
  user: UserItem | null;
  onClose: () => void;
  isSelf: boolean;
}

function ChangePasswordModal({ user, onClose, isSelf }: ChangePasswordModalProps) {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!user) {
      setCurrentPw(""); setNewPw(""); setError(null); setSuccess(false);
      setShowCurrent(false); setShowNew(false);
    }
  }, [user]);

  if (!user) return null;

  const newPwErr = newPw ? validatePassword(newPw) : "";
  const canSubmit = (!isSelf || currentPw) && newPw && !newPwErr && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/users/${user.id}/password`, {
        current_password: isSelf ? currentPw : undefined,
        new_password: newPw,
      });
      setSuccess(true);
    } catch (e: any) {
      setError(e.message ?? "Ошибка смены пароля");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" style={{ backdropFilter: "blur(3px)" }}>
      <div className="w-full max-w-sm bg-surface-1 rounded-2xl border border-border-subtle shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-[14px] font-semibold text-text-primary">Смена пароля: {user.username}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-2 hover:text-text-primary" aria-label="Закрыть">✕</button>
        </div>
        <div className="flex flex-col gap-4 p-5">
          {success ? (
            <Alert type="success" msg="Пароль успешно изменён" />
          ) : (
            <>
              {isSelf && (
                <FieldRow label="Текущий пароль">
                  <PasswordInput value={currentPw} onChange={setCurrentPw} show={showCurrent} onToggle={() => setShowCurrent(v => !v)} disabled={busy} placeholder="Текущий пароль" />
                </FieldRow>
              )}
              <FieldRow label="Новый пароль">
                <PasswordInput value={newPw} onChange={setNewPw} show={showNew} onToggle={() => setShowNew(v => !v)} disabled={busy} placeholder="Минимум 8 символов" />
                {newPwErr && <FieldError msg={newPwErr} />}
                {newPw && !newPwErr && <p className="text-[11px] text-text-tertiary">{newPw.length} символов</p>}
              </FieldRow>
              {error && <Alert type="error" msg={error} />}
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border-subtle bg-surface-2 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-1.5 rounded-md text-[13px] text-text-secondary hover:text-text-primary hover:bg-surface-3">
            {success ? "Закрыть" : "Отмена"}
          </button>
          {!success && (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-4 py-1.5 rounded-md text-[13px] font-medium bg-accent text-white hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Сохранение…" : "Изменить"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small shared helpers ───────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function FieldError({ msg }: { msg: string }) {
  return <p className="text-[11px] text-status-critical">{msg}</p>;
}

function PasswordInput({ value, onChange, show, onToggle, disabled, placeholder }: {
  value: string; onChange: (v: string) => void; show: boolean;
  onToggle: () => void; disabled?: boolean; placeholder?: string;
}) {
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full bg-surface-1 border border-border-default rounded-md px-3 pr-10 py-2 text-[13px] focus:outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? "Скрыть пароль" : "Показать пароль"}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

// ── Users table ────────────────────────────────────────────────────────────

function UserManagementSection() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [changePwUser, setChangePwUser] = useState<UserItem | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.get<UserItem[]>("/users");
      setUsers(list);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Не удалось загрузить пользователей");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!deleteUser) return;
    setDeleting(true);
    try {
      await api.delete(`/users/${deleteUser.id}`);
      setUsers(prev => prev.filter(u => u.id !== deleteUser.id));
      setDeleteUser(null);
    } catch (e: any) {
      // Показываем ошибку через ConfirmDialog body — перезапишем deleteUser ошибкой
      alert(e.message ?? "Ошибка удаления");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
        <h3 className="text-body-strong flex items-center gap-2">
          <Users className="w-5 h-5 text-accent" /> Пользователи
        </h3>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-[12px] font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-3.5 h-3.5" />
          Создать
        </button>
      </div>

      {loading && <div className="h-32 bg-surface-2 rounded-lg animate-pulse" />}
      {error && <Alert type="error" msg={error} />}

      {!loading && !error && (
        <div className="content-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border-subtle">
                {["Логин", "Роль", "Статус", "Последний вход", ""].map((h, i) => (
                  <th key={i} className="text-left px-4 py-2.5 text-[11px] font-medium text-text-tertiary uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u, idx) => {
                const isSelf = u.id === currentUser?.user_id;
                return (
                  <tr key={u.id} className={`${idx > 0 ? "border-t border-border-subtle" : ""} hover:bg-surface-2 transition-colors`}>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-text-primary font-mono">{u.username}</span>
                        {u.full_name && <span className="text-[11px] text-text-secondary">{u.full_name}</span>}
                        {u.email && <span className="text-[11px] text-text-tertiary">{u.email}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                      {u.role === "admin" && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[rgba(74,158,255,0.1)] text-accent border border-[rgba(74,158,255,0.2)]">
                          <ShieldCheck className="w-3 h-3" />
                          {ROLE_LABELS[u.role] ?? u.role}
                        </span>
                      )}
                      {u.role !== "admin" && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-3 text-text-secondary border border-border-subtle">
                          {ROLE_LABELS[u.role] ?? u.role}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 text-[12px] ${u.is_active ? "text-status-success" : "text-text-tertiary"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? "bg-status-success" : "bg-surface-3 border border-border-default"}`} />
                        {u.is_active ? "Активен" : "Деактивирован"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-tertiary whitespace-nowrap">
                      {relativeTime(u.last_login_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setEditUser(u)}
                          className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-3 transition-colors"
                          title="Редактировать"
                          aria-label={`Редактировать ${u.username}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setChangePwUser(u)}
                          className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-3 transition-colors"
                          title="Сменить пароль"
                          aria-label={`Сменить пароль ${u.username}`}
                        >
                          <Key className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteUser(u)}
                          disabled={isSelf}
                          className="p-1.5 rounded text-text-tertiary hover:text-status-critical hover:bg-[rgba(229,72,77,0.08)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          title={isSelf ? "Нельзя удалить свою учётную запись" : "Удалить"}
                          aria-label={`Удалить ${u.username}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-tertiary text-[13px]">
                    Пользователи не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={user => setUsers(prev => [...prev, user])}
      />
      <EditUserModal
        user={editUser}
        onClose={() => setEditUser(null)}
        onUpdated={updated => setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))}
        currentUserId={currentUser?.user_id ?? ""}
      />
      <ChangePasswordModal
        user={changePwUser}
        onClose={() => setChangePwUser(null)}
        isSelf={changePwUser?.id === currentUser?.user_id}
      />
      <ConfirmDialog
        open={!!deleteUser}
        variant="danger"
        title="Удалить пользователя"
        body={deleteUser ? (
          <p className="text-[13px] text-text-secondary">
            Пользователь <span className="font-mono font-medium text-text-primary">{deleteUser.username}</span> будет удалён безвозвратно.
          </p>
        ) : undefined}
        confirmLabel="Удалить"
        onConfirm={handleDelete}
        onCancel={() => setDeleteUser(null)}
        busy={deleting}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Settings() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col h-full gap-6 pb-6 max-h-[100dvh]">
      <SectionHeader title="Настройки" />

      <div className="flex-1 overflow-y-auto min-h-0 bg-surface-base px-1">
        <div className="flex flex-col gap-10 max-w-4xl pb-12">

          {/* ── User Management (admin only) ────────────────────────────────── */}
          {user?.role === "admin" && <UserManagementSection />}

          <NotificationPreferencesSection />

        </div>
      </div>
    </div>
  );
}
