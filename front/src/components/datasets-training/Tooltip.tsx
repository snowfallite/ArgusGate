import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type Placement = "top" | "bottom";

interface Props {
  content: React.ReactNode;
  children: React.ReactElement;
  maxWidth?: number;
  delay?: number;
  className?: string;
}

interface Coords {
  top: number;
  left: number;
  arrowLeft: number;
  placement: Placement;
}

const MARGIN = 8;
const ARROW_HALF = 6;

/**
 * Tooltip через React-portal: позиционируется относительно триггера во viewport,
 * умеет авто-flip top/bottom, стрелка указывает на trigger.
 */
export function Tooltip({ content, children, maxWidth = 280, delay = 250, className }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popperRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const compute = () => {
    const trigger = triggerRef.current;
    const popper = popperRef.current;
    if (!trigger || !popper) return;

    const tRect = trigger.getBoundingClientRect();
    const pRect = popper.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spaceBelow = vh - tRect.bottom;
    const spaceAbove = tRect.top;
    const placement: Placement =
      spaceBelow >= pRect.height + MARGIN || spaceBelow >= spaceAbove ? "bottom" : "top";

    const top =
      placement === "bottom" ? tRect.bottom + MARGIN : tRect.top - pRect.height - MARGIN;

    const desiredLeft = tRect.left + tRect.width / 2 - pRect.width / 2;
    const left = Math.max(8, Math.min(vw - pRect.width - 8, desiredLeft));
    const triggerCenter = tRect.left + tRect.width / 2;
    const arrowLeft = Math.max(
      ARROW_HALF + 4,
      Math.min(pRect.width - ARROW_HALF - 4, triggerCenter - left),
    );

    setCoords({ top, left, arrowLeft, placement });
  };

  useLayoutEffect(() => {
    if (!open) return;
    compute();
  }, [open, content]);

  useEffect(() => {
    if (!open) return;
    const onUpdate = () => compute();
    window.addEventListener("scroll", onUpdate, true);
    window.addEventListener("resize", onUpdate);
    return () => {
      window.removeEventListener("scroll", onUpdate, true);
      window.removeEventListener("resize", onUpdate);
    };
  }, [open]);

  useEffect(() => () => {
    if (showTimer.current) clearTimeout(showTimer.current);
  }, []);

  const show = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    setOpen(false);
  };

  if (!isValidElement(children)) return children as any;

  const setRef = (el: HTMLElement | null) => {
    triggerRef.current = el;
    const existing = (children as any).ref;
    if (typeof existing === "function") existing(el);
    else if (existing && typeof existing === "object") {
      (existing as React.MutableRefObject<HTMLElement | null>).current = el;
    }
  };

  const trigger = cloneElement(children, {
    ref: setRef,
    onMouseEnter: (e: React.MouseEvent) => {
      (children.props as any).onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      (children.props as any).onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      (children.props as any).onFocus?.(e);
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      (children.props as any).onBlur?.(e);
      hide();
    },
  } as any);

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={popperRef}
            role="tooltip"
            className={cn(
              "fixed z-[1000] pointer-events-none transition-opacity duration-150",
              coords ? "opacity-100" : "opacity-0",
              className,
            )}
            style={{
              top: coords?.top ?? 0,
              left: coords?.left ?? 0,
              maxWidth,
            }}
          >
            <div className="relative rounded-lg bg-surface-3 border border-border-default text-text-primary text-[12px] leading-snug px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
              {content}
              {coords && (
                <span
                  aria-hidden
                  className="absolute w-3 h-3 rotate-45 bg-surface-3"
                  style={{
                    left: coords.arrowLeft - ARROW_HALF,
                    top: coords.placement === "bottom" ? -6 : undefined,
                    bottom: coords.placement === "top" ? -6 : undefined,
                    borderTop:
                      coords.placement === "bottom" ? "1px solid var(--border-default)" : undefined,
                    borderLeft:
                      coords.placement === "bottom" ? "1px solid var(--border-default)" : undefined,
                    borderRight:
                      coords.placement === "top" ? "1px solid var(--border-default)" : undefined,
                    borderBottom:
                      coords.placement === "top" ? "1px solid var(--border-default)" : undefined,
                  }}
                />
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
