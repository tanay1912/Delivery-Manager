export const SAVED_SECRET_PLACEHOLDER = "••••••••";

export const INPUT_CLASS =
  "block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500";

export const CARD_CLASS = "bg-white rounded-xl border border-gray-200 shadow-sm p-5";

export const BTN_PRIMARY =
  "inline-flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 transition-colors";

export const BTN_OUTLINE_BLUE =
  "inline-flex items-center justify-center border border-gray-300 text-blue-600 hover:bg-gray-50 rounded-lg px-4 py-2 text-sm transition-colors";

export const BTN_DANGER_OUTLINE =
  "inline-flex items-center justify-center border border-red-300 text-red-600 hover:bg-red-50 rounded-lg px-4 py-2 text-sm disabled:opacity-50 transition-colors";

export function StatusBadge({ configured }: { configured: boolean }) {
  if (configured) {
    return (
      <span className="flex-shrink-0 bg-green-50 text-green-700 border border-green-200 text-xs font-medium px-2.5 py-0.5 rounded-full">
        Connected
      </span>
    );
  }
  return (
    <span className="flex-shrink-0 bg-gray-100 text-gray-500 text-xs px-2.5 py-0.5 rounded-full">
      Not configured
    </span>
  );
}

export function CardHeader({
  icon,
  title,
  description,
  configured,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  configured?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="text-gray-500 flex-shrink-0 mt-0.5">{icon}</span>
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
        </div>
      </div>
      {configured !== undefined && <StatusBadge configured={configured} />}
    </div>
  );
}

export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="text-xs text-gray-400 uppercase tracking-wide border-t border-gray-100 pt-3 mt-3 flex items-center gap-2">
      <span className="flex-shrink-0">{label}</span>
      <span className="flex-1 border-t border-gray-100" aria-hidden="true" />
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-10 skeleton" />
      <div className="h-10 skeleton" />
    </div>
  );
}
