import { Link } from "react-router-dom";
import { useSettings } from "./SettingsProvider";

interface SetupCardProps {
  to: string;
  title: string;
  description: string;
  configured: boolean;
  detail?: string;
  step: number;
}

function SetupCard({ to, title, description, configured, detail, step }: SetupCardProps) {
  return (
    <Link
      to={to}
      className="group block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-blue-200 hover:shadow-md hover:ring-1 hover:ring-blue-100"
    >
      <div className="flex items-start gap-4">
        <div
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
            configured
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
          }`}
        >
          {configured ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            step
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">{title}</h3>
            <span
              className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                configured
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-amber-50 text-amber-700 border border-amber-200"
              }`}
            >
              {configured ? "Ready" : "Setup needed"}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">{description}</p>
          {detail && <p className="text-xs text-slate-400 mt-2 font-medium">{detail}</p>}
        </div>
        <svg
          className="h-5 w-5 flex-shrink-0 text-slate-300 group-hover:text-blue-500 transition-colors mt-1"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

export default function SettingsOverview() {
  const {
    loading,
    jiraConnected,
    bitbucketConfigured,
    openaiConfigured,
    cursorConfigured,
    mappingsCount,
    siteName,
    user,
  } = useSettings();

  const aiConfigured = openaiConfigured || cursorConfigured;
  const setupComplete =
    jiraConnected && bitbucketConfigured && aiConfigured && mappingsCount > 0;
  const completedSteps = [
    jiraConnected,
    bitbucketConfigured,
    aiConfigured,
    mappingsCount > 0,
  ].filter(Boolean).length;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 skeleton rounded-xl" />
        <div className="h-32 skeleton rounded-xl" />
        <div className="h-32 skeleton rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className={`rounded-2xl border p-6 ${
          setupComplete
            ? "bg-gradient-to-br from-emerald-50 to-white border-emerald-200"
            : "bg-gradient-to-br from-blue-50 to-white border-blue-200"
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ${
              setupComplete ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
            }`}
          >
            {setupComplete ? (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.75}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {setupComplete ? "You're all set!" : "Get started with Delivery Manager"}
            </h2>
            <p className="text-sm text-slate-600 mt-1 max-w-xl">
              {setupComplete
                ? "All integrations are connected. Head to My tickets to start delivering work."
                : "Complete these steps to connect your tools. Each step unlocks part of the delivery pipeline."}
            </p>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1 max-w-xs h-2 rounded-full bg-white/80 border border-slate-200 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${setupComplete ? "bg-emerald-500" : "bg-blue-500"}`}
                  style={{ width: `${(completedSteps / 4) * 100}%` }}
                />
              </div>
              <span className="text-sm font-medium text-slate-600 tabular-nums">
                {completedSteps} of 4 complete
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <SetupCard
          step={1}
          to="/settings/jira"
          title="Jira connection"
          description="Sign in via Atlassian OAuth to load your assigned tickets and post updates back to Jira."
          configured={jiraConnected}
          detail={jiraConnected ? `${siteName} · ${user?.display_name}` : undefined}
        />
        <SetupCard
          step={2}
          to="/settings/bitbucket"
          title="Bitbucket credentials"
          description="API access for pull requests, branches, and git commands during deployment."
          configured={bitbucketConfigured}
          detail={bitbucketConfigured ? "API token saved" : undefined}
        />
        <SetupCard
          step={3}
          to="/settings/ai"
          title="AI provider"
          description="Connect Cursor or OpenAI for code generation, estimation, and verification during delivery."
          configured={aiConfigured}
          detail={
            cursorConfigured && openaiConfigured
              ? "Cursor and OpenAI connected"
              : cursorConfigured
                ? "Cursor connected"
                : openaiConfigured
                  ? "OpenAI connected"
                  : undefined
          }
        />
        <SetupCard
          step={4}
          to="/admin/mappings"
          title="Project mappings"
          description="Link each Jira project to its Bitbucket repo, branches, and deployment settings."
          configured={mappingsCount > 0}
          detail={mappingsCount > 0 ? `${mappingsCount} project${mappingsCount === 1 ? "" : "s"} configured` : undefined}
        />
      </div>
    </div>
  );
}
