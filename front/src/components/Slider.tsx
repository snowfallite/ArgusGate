import React from "react";
import { cn } from "@/lib/utils";

interface SliderProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChangeValue?: (value: number) => void;
  className?: string;
}

export function Slider({ value, min, max, step = 1, onChangeValue, className, ...rest }: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={cn("relative w-full h-5 flex items-center", className)}>
      <div className="absolute inset-0 h-1.5 my-auto bg-surface-3 rounded-full overflow-hidden">
        <div 
          className="absolute inset-y-0 left-0 bg-accent rounded-full transition-all duration-100" 
          style={{ width: `${percentage}%` }}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChangeValue?.(Number(e.target.value))}
        className="absolute inset-0 w-full opacity-0 cursor-pointer"
        {...rest}
      />
      <div 
        className="absolute h-4 w-4 bg-white border border-border-default rounded-full shadow pointer-events-none transition-all duration-100"
        style={{ left: `calc(${percentage}% - 8px)` }}
      />
    </div>
  );
}
