import { cn } from "@/lib/utils";
import { ChevronDown, X } from "lucide-react";

interface FilterChipProps {
  label: string;
  value: string;
  onClick?: () => void;
  onClear?: () => void;
  className?: string;
  active?: boolean;
}

export function FilterChip({ label, value, onClick, onClear, className, active }: FilterChipProps) {
  return (
    <div 
      className={cn(
        "flex items-center rounded-lg border text-[12px] transition-colors whitespace-nowrap",
        active 
          ? "bg-surface-2 border-border-default text-text-primary shadow-sm" 
          : "bg-surface-1 border-transparent text-text-secondary hover:bg-surface-2 hover:border-border-subtle hover:text-text-primary",
        className
      )}
    >
      <button onClick={onClick} className="flex items-center gap-1.5 px-2.5 py-1.5 outline-none rounded-l-lg hover:text-text-primary">
        <span className="font-medium text-text-tertiary">{label}:</span>
        <span className={cn("font-medium", active && "text-text-primary")}>{value}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-50 ml-0.5" />
      </button>
      {active && onClear && (
        <button 
          onClick={onClear}
          className="px-1.5 py-1.5 hover:bg-surface-3 hover:text-text-primary transition-colors rounded-r-lg"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
