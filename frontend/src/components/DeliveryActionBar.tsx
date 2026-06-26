import { ReactNode } from "react";

interface DeliveryActionBarProps {
  left?: ReactNode;
  right?: ReactNode;
  bottom?: ReactNode;
}

export default function DeliveryActionBar({ left, right, bottom }: DeliveryActionBarProps) {
  if (!left && !right && !bottom) return null;

  return (
    <div className="sticky bottom-0 z-30 bg-white border-t border-gray-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] px-6 py-4 -mx-6">
      <div className="space-y-3">
        {(left || right) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">{left}</div>
            <div className="flex flex-wrap gap-2 justify-end">{right}</div>
          </div>
        )}
        {bottom && <div>{bottom}</div>}
      </div>
    </div>
  );
}
