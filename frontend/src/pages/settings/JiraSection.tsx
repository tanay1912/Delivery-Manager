import { useSettings } from "./SettingsProvider";
import { BTN_DANGER_OUTLINE, BTN_OUTLINE_BLUE, CARD_CLASS, CardHeader, FormSkeleton } from "./shared";

export default function JiraSection() {
  const { loading, jiraConnected, siteName, siteUrl, user, handleJiraDisconnect } = useSettings();

  return (
    <section className={CARD_CLASS}>
      <CardHeader
        configured={jiraConnected}
        title="Jira connection"
        description="Your Atlassian OAuth session powers ticket loading, comments, and status transitions."
        icon={
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
        }
      />
      {loading ? (
        <FormSkeleton />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Signed in via Atlassian OAuth. Your Jira session is used for tickets, comments, and status transitions.
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-4">
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Site</dt>
              <dd className="mt-1 font-medium text-gray-900">{siteName || "—"}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-4">
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Account</dt>
              <dd className="mt-1 font-medium text-gray-900 truncate">{user?.display_name || "—"}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            {siteUrl && (
              <a href={siteUrl} target="_blank" rel="noopener noreferrer" className={BTN_OUTLINE_BLUE}>
                Open Jira ↗
              </a>
            )}
            <button type="button" onClick={handleJiraDisconnect} className={BTN_DANGER_OUTLINE}>
              Disconnect
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
