interface DeploymentErrorBannerProps {
  title?: string;
  message: string;
  detail?: string | null;
}

export default function DeploymentErrorBanner({
  title = "Deployment Failed",
  message,
  detail,
}: DeploymentErrorBannerProps) {
  return (
    <div className="bg-red-50 border border-red-200 border-l-4 border-l-red-500 rounded-lg p-4 mb-4">
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0" aria-hidden="true">
          ⚠️
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-red-800">{title}</h3>
          <p className="text-sm text-red-700 mt-1">{message}</p>
          {detail && (
            <p className="text-xs text-red-800 mt-2 font-mono whitespace-pre-wrap break-all rounded bg-red-100/60 px-3 py-2">
              {detail}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
