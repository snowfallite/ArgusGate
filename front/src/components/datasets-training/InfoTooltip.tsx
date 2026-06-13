import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./Tooltip";

interface Props {
  text: React.ReactNode;
  className?: string;
  maxWidth?: number;
}

/**
 * Иконка с подсказкой. Текст подсказки показывается в Tooltip-портале,
 * не подвержен overflow родителя и подсвечивается при focus/hover.
 */
export function InfoTooltip({ text, className, maxWidth = 280 }: Props) {
  return (
    <Tooltip content={text} maxWidth={maxWidth}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center justify-center w-4 h-4 rounded-full text-text-tertiary hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent",
          className,
        )}
        aria-label="info"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
  );
}
