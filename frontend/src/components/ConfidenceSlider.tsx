"use client";
import { useId } from "react";
import { Slider } from "@/components/ui/slider";

export function ConfidenceSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const labelId = useId();
  return (
    <div className="confidence-control">
      <div className="flex items-center justify-between gap-4">
        <label id={labelId}>Confidence threshold</label>
        <span className="threshold-value" aria-live="polite">
          {value}
          <small>/100</small>
        </span>
      </div>
      <Slider
        aria-labelledby={labelId}
        min={0}
        max={100}
        step={1}
        value={[value]}
        onValueChange={(values) =>
          onChange(typeof values === "number" ? values : values[0])
        }
        className="my-5"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Explore more</span>
        <span>Higher confidence</span>
      </div>
    </div>
  );
}
