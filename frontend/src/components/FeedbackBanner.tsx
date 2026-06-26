import { ReactNode } from "react";

export function SuccessBanner({ children }: { children: ReactNode }) {
  return (
    <div className="alert-success flex items-start gap-3">
      <svg className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
      </svg>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
  retryLabel = "Retry",
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="alert-error flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <svg className="h-5 w-5 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
        </svg>
        <span className="break-words">{message}</span>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary btn-sm flex-shrink-0 text-red-700 border-red-200 hover:bg-red-50">
          {retryLabel}
        </button>
      )}
    </div>
  );
}
