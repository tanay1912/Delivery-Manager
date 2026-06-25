import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";

export default function Login() {
  const navigate = useNavigate();
  const [siteUrl, setSiteUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.connect({ site_url: siteUrl, email, api_token: apiToken });
      navigate("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Could not connect to Jira. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="card shadow-panel p-8 sm:p-10">
          <div className="text-center mb-8">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md mb-5">
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 3L4 8v8l8 5 8-5V8l-8-5z"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinejoin="round"
                />
                <path
                  d="M12 12l8-5M12 12L4 7M12 12v13"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Welcome back
            </h1>
            <p className="mt-2 text-slate-600 text-sm leading-relaxed">
              Connect your Jira Cloud site with an API token. No OAuth app required.
            </p>
          </div>

          {error && <div className="alert-error mb-6">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block space-y-1.5">
              <span className="label">Jira site URL</span>
              <input
                type="text"
                required
                placeholder="yoursite.atlassian.net"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                className="input"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="label">Atlassian account email</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="label">API token</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                className="input"
              />
            </label>
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 mt-2">
              {loading ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Connecting…
                </>
              ) : (
                "Connect to Jira"
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-slate-500 leading-relaxed">
            Create an API token at{" "}
            <a
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 font-medium hover:text-brand-700 hover:underline"
            >
              id.atlassian.com
            </a>
            . Your token is encrypted and stored only for your session.
          </p>
        </div>
      </div>
    </div>
  );
}
