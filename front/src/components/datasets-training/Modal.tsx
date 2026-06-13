import { useEffect, useRef, useId } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  closeOnBackdrop?: boolean;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = "max-w-2xl",
  closeOnBackdrop = true,
  className,
}: Props) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Escape key + focus trap
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const el = containerRef.current;
        if (!el) return;
        const focusable = Array.from(
          el.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
          )
        ).filter((n) => !n.closest("[aria-hidden]"));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", onKey);

    // Фокус на первый интерактивный элемент при открытии
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      const first = el.querySelector<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    });

    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        paddingTop: "var(--topbar-h, 72px)",
        paddingBottom: "16px",
        paddingLeft: "calc(var(--sidebar-w, 280px) + 16px)",
        paddingRight: "16px",
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        style={{ backdropFilter: "blur(3px)" }}
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative w-full bg-surface-1 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-border-subtle",
          maxWidth,
          className,
        )}
        style={{ maxHeight: "calc(100vh - var(--topbar-h, 72px) - 32px)" }}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle shrink-0">
          <h2 id={titleId} className="text-[14px] font-semibold text-text-primary truncate pr-3">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-border-subtle bg-surface-2 flex items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
