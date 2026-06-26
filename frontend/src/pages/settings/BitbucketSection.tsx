import { useSettings } from "./SettingsProvider";
import PasswordInput from "../../components/PasswordInput";
import {
  BTN_DANGER_OUTLINE,
  BTN_PRIMARY,
  CARD_CLASS,
  CardHeader,
  FormSkeleton,
  INPUT_CLASS,
  SAVED_SECRET_PLACEHOLDER,
} from "./shared";

export default function BitbucketSection() {
  const {
    loading,
    bitbucketConfigured,
    bitbucketUsername,
    setBitbucketUsername,
    bitbucketPassword,
    setBitbucketPassword,
    bitbucketGitUsername,
    setBitbucketGitUsername,
    bitbucketGitPassword,
    setBitbucketGitPassword,
    bitbucketGitConfigured,
    bitbucketSaving,
    bitbucketDisconnecting,
    handleBitbucketSubmit,
    revealBitbucketToken,
    revealBitbucketGitPassword,
    disconnectBitbucket,
  } = useSettings();

  return (
    <section className={CARD_CLASS}>
      <CardHeader
        configured={bitbucketConfigured}
        title="Bitbucket"
        description="API access for PRs and branches, plus Git credentials for deployment commands."
        icon={
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        }
      />
      {loading ? (
        <FormSkeleton />
      ) : (
        <form onSubmit={handleBitbucketSubmit} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">API access</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Used for pull requests, branches, and repository API calls.
            </p>
          </div>
          <p className="text-sm text-gray-600">
            Create an API token at{" "}
            <a
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 underline hover:text-blue-700"
            >
              id.atlassian.com
            </a>{" "}
            with Bitbucket repository read/write scopes.
          </p>
          <label className="block space-y-1">
            <span className="text-sm text-gray-700">Atlassian account email</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={bitbucketUsername}
              onChange={(e) => setBitbucketUsername(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <div className="space-y-1">
            <label htmlFor="bitbucket-api-token" className="block text-sm text-gray-700">
              API token
            </label>
            <PasswordInput
              id="bitbucket-api-token"
              required={!bitbucketConfigured}
              autoComplete="new-password"
              placeholder={bitbucketConfigured ? SAVED_SECRET_PLACEHOLDER : "API token"}
              value={bitbucketPassword}
              onChange={(e) => setBitbucketPassword(e.target.value)}
              onReveal={bitbucketConfigured ? revealBitbucketToken : undefined}
              className={INPUT_CLASS}
            />
            {bitbucketConfigured && !bitbucketPassword && (
              <p className="text-xs text-gray-500">Click the eye icon to view the saved token.</p>
            )}
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Git credentials for deployment</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Optional. Leave blank to reuse the API token above for <code className="text-xs">git pull</code>{" "}
                during deployment. If you fill these in, use username{" "}
                <code className="text-xs">x-bitbucket-api-token-auth</code> and your Bitbucket API token — app
                passwords no longer work.
              </p>
            </div>
            <label className="block space-y-1">
              <span className="text-sm text-gray-700">Bitbucket username</span>
              <input
                type="text"
                required={!bitbucketGitConfigured}
                autoComplete="off"
                placeholder="your-bitbucket-username"
                value={bitbucketGitUsername}
                onChange={(e) => setBitbucketGitUsername(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <div className="space-y-1">
              <label htmlFor="bitbucket-git-password" className="block text-sm text-gray-700">
                Git password
              </label>
              <PasswordInput
                id="bitbucket-git-password"
                required={!bitbucketGitConfigured}
                autoComplete="new-password"
                placeholder={bitbucketGitConfigured ? SAVED_SECRET_PLACEHOLDER : "Bitbucket API token"}
                value={bitbucketGitPassword}
                onChange={(e) => setBitbucketGitPassword(e.target.value)}
                onReveal={bitbucketGitConfigured ? revealBitbucketGitPassword : undefined}
                className={INPUT_CLASS}
              />
              {bitbucketGitConfigured && !bitbucketGitPassword && (
                <p className="text-xs text-gray-500">Click the eye icon to view the saved password.</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" disabled={bitbucketSaving} className={BTN_PRIMARY}>
              {bitbucketSaving ? "Saving…" : bitbucketConfigured ? "Update Bitbucket" : "Connect Bitbucket"}
            </button>
            {bitbucketConfigured && (
              <button
                type="button"
                disabled={bitbucketDisconnecting}
                onClick={disconnectBitbucket}
                className={BTN_DANGER_OUTLINE}
              >
                {bitbucketDisconnecting ? "Removing…" : "Remove"}
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
