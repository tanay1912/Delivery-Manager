interface DeploymentErrorBannerProps {
  title?: string;
  message: string;
  detail?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  retryDisabled?: boolean;
}

export default function DeploymentErrorBanner({
  title = "Deployment Failed",
  message,
  detail,
  onRetry,
  retrying = false,
  retryDisabled = false,
}: DeploymentErrorBannerProps) {
  return (
    <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">
          ⚠️
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-red-800">{title}</h3>
          <p className="text-sm text-red-700 mt-1">{message}</p>
          {detail && (
            <p className="text-xs text-red-800 mt-2 font-mono whitespace-pre-wrap break-all rounded bg-red-100/60 px-3 py-2">
              {detail}
            </p>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retryDisabled || retrying}
              className="mt-4 w-full sm:w-auto min-w-48 rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-brand hover:bg-brand-700 hover:shadow-brand-md disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              {retrying ? "Retrying…" : "Retry Deployment"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
