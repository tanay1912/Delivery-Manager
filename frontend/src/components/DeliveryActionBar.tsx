import { ReactNode } from "react";

interface DeliveryActionBarProps {
  primary?: ReactNode;
  secondary?: ReactNode;
  danger?: ReactNode;
}

export default function DeliveryActionBar({ primary, secondary, danger }: DeliveryActionBarProps) {
  if (!primary && !secondary && !danger) return null;

  return (
    <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] mt-6">
      <div className="space-y-3 max-w-3xl mx-auto">
        {primary && <div>{primary}</div>}
        {secondary && (
          <div className="flex flex-wrap gap-2 justify-center sm:justify-start">{secondary}</div>
        )}
        {danger && (
          <div className="pt-3 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            {danger}
          </div>
        )}
      </div>
    </div>
  );
}
