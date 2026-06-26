import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, ModelOption, User } from "../api/client";
import Layout from "../components/Layout";
import PasswordInput from "../components/PasswordInput";
import { useToast } from "../context/ToastContext";

const SAVED_SECRET_PLACEHOLDER = "••••••••";

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span className={configured ? "badge-success flex-shrink-0" : "badge-disconnected flex-shrink-0"}>
      {configured ? "Connected" : "Not configured"}
    </span>
  );
}

function SectionHeader({
  icon,
  title,
  configured,
}: {
  icon: React.ReactNode;
  title: string;
  configured?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white">
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 flex-shrink-0">
          {icon}
        </span>
        <h2 className="font-semibold text-slate-900 tracking-tight">{title}</h2>
      </div>
      {configured !== undefined && <StatusBadge configured={configured} />}
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-3 p-6">
      <div className="h-10 skeleton" />
      <div className="h-10 skeleton" />
    </div>
  );
}

function mergeModelOptions(models: ModelOption[], current: string): ModelOption[] {
  if (!current || models.some((model) => model.id === current)) return models;
  return [{ id: current, label: current }, ...models];
}

function ModelSelect({
  id,
  value,
  onChange,
  models,
  loading,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  models: ModelOption[];
  loading: boolean;
}) {
  const options = mergeModelOptions(models, value);
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="input font-mono"
      disabled={loading}
      required
    >
      {loading ? (
        <option value={value}>Loading models…</option>
      ) : (
        options.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))
      )}
    </select>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bitbucketConfigured, setBitbucketConfigured] = useState(false);
  const [bitbucketUsername, setBitbucketUsername] = useState("");
  const [bitbucketPassword, setBitbucketPassword] = useState("");
  const [bitbucketSaving, setBitbucketSaving] = useState(false);
  const [bitbucketDisconnecting, setBitbucketDisconnecting] = useState(false);

  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiSaving, setOpenaiSaving] = useState(false);
  const [openaiDisconnecting, setOpenaiDisconnecting] = useState(false);
  const [openaiModels, setOpenaiModels] = useState<ModelOption[]>([]);
  const [openaiModelsLoading, setOpenaiModelsLoading] = useState(false);
  const [openaiModelsFromApi, setOpenaiModelsFromApi] = useState(false);

  const [cursorConfigured, setCursorConfigured] = useState(false);
  const [cursorModel, setCursorModel] = useState("composer-2.5");
  const [cursorApiKey, setCursorApiKey] = useState("");
  const [cursorSaving, setCursorSaving] = useState(false);
  const [cursorDisconnecting, setCursorDisconnecting] = useState(false);
  const [cursorModels, setCursorModels] = useState<ModelOption[]>([]);
  const [cursorModelsLoading, setCursorModelsLoading] = useState(false);
  const [cursorModelsFromApi, setCursorModelsFromApi] = useState(false);

  const jiraConnected = Boolean(siteName && user);

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        const detail = err.message.toLowerCase();
        if (detail.includes("not authenticated")) {
          navigate("/login");
          return;
        }
      }
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      toast(msg, "error");
    },
    [navigate, toast],
  );

  const loadAll = useCallback(async () => {
    const me = await api.ensureAuth();
    setUser(me.user);
    setSiteName(me.site_name);
    setSiteUrl(me.site_url);
    setBitbucketConfigured(!!me.bitbucket_configured);
    if (me.bitbucket_username?.includes("@")) {
      setBitbucketUsername(me.bitbucket_username);
    } else if (me.user?.email) {
      setBitbucketUsername(me.user.email);
    } else if (me.bitbucket_username) {
      setBitbucketUsername(me.bitbucket_username);
    }
    setOpenaiConfigured(!!me.openai_configured);
    setOpenaiModel(me.openai_model || "gpt-4o-mini");
    setCursorConfigured(!!me.cursor_configured);
    setCursorModel(me.cursor_model || "composer-2.5");
  }, []);

  useEffect(() => {
    loadAll().catch(handleAuthError).finally(() => setLoading(false));
  }, [loadAll, handleAuthError]);

  const refreshOpenAIModels = useCallback(
    async (apiKey?: string) => {
      setOpenaiModelsLoading(true);
      try {
        const data = await api.getOpenAIModels(apiKey);
        setOpenaiModels(data.models);
        setOpenaiModelsFromApi(data.source === "api");
      } catch (err) {
        handleAuthError(err);
      } finally {
        setOpenaiModelsLoading(false);
      }
    },
    [handleAuthError],
  );

  const refreshCursorModels = useCallback(
    async (apiKey?: string) => {
      setCursorModelsLoading(true);
      try {
        const data = await api.getCursorModels(apiKey);
        setCursorModels(data.models);
        setCursorModelsFromApi(data.source === "api");
      } catch (err) {
        handleAuthError(err);
      } finally {
        setCursorModelsLoading(false);
      }
    },
    [handleAuthError],
  );

  useEffect(() => {
    if (loading) return;
    refreshOpenAIModels(openaiApiKey || undefined);
  }, [loading, openaiConfigured, refreshOpenAIModels]);

  useEffect(() => {
    if (loading) return;
    refreshCursorModels(cursorApiKey || undefined);
  }, [loading, cursorConfigured, refreshCursorModels]);

  const handleBitbucketSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBitbucketSaving(true);
    setError(null);
    try {
      const result = await api.connectBitbucket({
        username: bitbucketUsername,
        app_password: bitbucketPassword,
      });
      setBitbucketConfigured(true);
      if (result.username) setBitbucketUsername(result.username);
      setBitbucketPassword("");
      toast("Bitbucket credentials saved.", "success");
    } catch (err) {
      handleAuthError(err);
    } finally {
      setBitbucketSaving(false);
    }
  };

  const handleOpenAISubmit = async (event: FormEvent) => {
    event.preventDefault();
    setOpenaiSaving(true);
    setError(null);
    try {
      const result = await api.connectOpenAI({ api_key: openaiApiKey, model: openaiModel });
      setOpenaiConfigured(true);
      setOpenaiModel(result.model || openaiModel);
      setOpenaiApiKey("");
      toast("OpenAI settings saved.", "success");
      await refreshOpenAIModels();
    } catch (err) {
      handleAuthError(err);
    } finally {
      setOpenaiSaving(false);
    }
  };

  const handleCursorSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setCursorSaving(true);
    setError(null);
    try {
      const result = await api.connectCursor({ api_key: cursorApiKey, model: cursorModel });
      setCursorConfigured(true);
      setCursorModel(result.model || cursorModel);
      setCursorApiKey("");
      toast("Cursor settings saved.", "success");
      await refreshCursorModels();
    } catch (err) {
      handleAuthError(err);
    } finally {
      setCursorSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      navigate("/login");
    }
  };

  return (
    <Layout user={user} siteName={siteName} onLogout={handleLogout}>
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-slate-600">
            Connect integrations used by the delivery pipeline. Credentials are encrypted per session.
          </p>
        </div>

        {error && <div className="alert-error">{error}</div>}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* 1. Jira Connection */}
        <section className="settings-section-card">
          <SectionHeader
            configured={jiraConnected}
            title="Jira Connection"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
          />
          <div className="p-5 sm:p-6 space-y-3">
            {loading ? (
              <FormSkeleton />
            ) : (
              <>
                <p className="text-sm text-slate-600">
                  Signed in via Atlassian OAuth. Your Jira session is used for tickets, comments, and status transitions.
                </p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide">Site</dt>
                    <dd className="mt-1 font-medium text-slate-900">{siteName || "—"}</dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide">Account</dt>
                    <dd className="mt-1 font-medium text-slate-900 truncate">{user?.display_name || "—"}</dd>
                  </div>
                </dl>
                {siteUrl && (
                  <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
                    Open Jira →
                  </a>
                )}
              </>
            )}
          </div>
        </section>

        {/* 2. AI Provider */}
        <section className="settings-section-card">
          <SectionHeader
            configured={openaiConfigured || cursorConfigured}
            title="AI Provider"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            }
          />
          <div className="divide-y divide-slate-100">
            <div className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">OpenAI</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Estimation, fallback code generation, and verification.</p>
                </div>
                {!loading && <StatusBadge configured={openaiConfigured} />}
              </div>
              {loading ? (
                <FormSkeleton />
              ) : (
                <form onSubmit={handleOpenAISubmit} className="space-y-4">
                  <label className="block space-y-1.5">
                    <span className="label">API key</span>
                    <PasswordInput
                      required={!openaiConfigured}
                      placeholder={openaiConfigured ? SAVED_SECRET_PLACEHOLDER : "sk-…"}
                      value={openaiApiKey}
                      onChange={(e) => setOpenaiApiKey(e.target.value)}
                      onBlur={() => {
                        if (openaiApiKey.trim()) refreshOpenAIModels(openaiApiKey);
                      }}
                      className="input font-mono"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="label">Model</span>
                    <ModelSelect
                      id="openai-model"
                      value={openaiModel}
                      onChange={setOpenaiModel}
                      models={openaiModels}
                      loading={openaiModelsLoading}
                    />
                    {!openaiModelsLoading && !openaiModelsFromApi && (
                      <p className="text-xs text-slate-500">Enter your API key to load available models.</p>
                    )}
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <button type="submit" disabled={openaiSaving} className="btn-primary">
                      {openaiSaving ? "Saving…" : openaiConfigured ? "Update OpenAI" : "Connect OpenAI"}
                    </button>
                    {openaiConfigured && (
                      <button
                        type="button"
                        disabled={openaiDisconnecting}
                        onClick={async () => {
                          if (!confirm("Remove OpenAI credentials?")) return;
                          setOpenaiDisconnecting(true);
                          try {
                            await api.disconnectOpenAI();
                            setOpenaiConfigured(false);
                            setOpenaiApiKey("");
                            toast("OpenAI credentials removed.", "success");
                          } catch (err) {
                            handleAuthError(err);
                          } finally {
                            setOpenaiDisconnecting(false);
                          }
                        }}
                        className="btn-secondary text-red-600 hover:bg-red-50"
                      >
                        {openaiDisconnecting ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>

            <div className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Cursor</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Cloud agent for code development (preferred over OpenAI).</p>
                </div>
                {!loading && <StatusBadge configured={cursorConfigured} />}
              </div>
              {loading ? (
                <FormSkeleton />
              ) : (
                <form onSubmit={handleCursorSubmit} className="space-y-4">
                  <label className="block space-y-1.5">
                    <span className="label">API key</span>
                    <PasswordInput
                      required={!cursorConfigured}
                      placeholder={cursorConfigured ? SAVED_SECRET_PLACEHOLDER : "Cursor API key"}
                      value={cursorApiKey}
                      onChange={(e) => setCursorApiKey(e.target.value)}
                      onBlur={() => {
                        if (cursorApiKey.trim()) refreshCursorModels(cursorApiKey);
                      }}
                      className="input font-mono"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="label">Model</span>
                    <ModelSelect
                      id="cursor-model"
                      value={cursorModel}
                      onChange={setCursorModel}
                      models={cursorModels}
                      loading={cursorModelsLoading}
                    />
                    {!cursorModelsLoading && !cursorModelsFromApi && (
                      <p className="text-xs text-slate-500">Enter your API key to load available models.</p>
                    )}
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <button type="submit" disabled={cursorSaving} className="btn-primary">
                      {cursorSaving ? "Saving…" : cursorConfigured ? "Update Cursor" : "Connect Cursor"}
                    </button>
                    {cursorConfigured && (
                      <button
                        type="button"
                        disabled={cursorDisconnecting}
                        onClick={async () => {
                          if (!confirm("Remove Cursor credentials?")) return;
                          setCursorDisconnecting(true);
                          try {
                            await api.disconnectCursor();
                            setCursorConfigured(false);
                            setCursorApiKey("");
                            toast("Cursor credentials removed.", "success");
                          } catch (err) {
                            handleAuthError(err);
                          } finally {
                            setCursorDisconnecting(false);
                          }
                        }}
                        className="btn-secondary text-red-600 hover:bg-red-50"
                      >
                        {cursorDisconnecting ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          </div>
        </section>

        {/* 3. Bitbucket */}
        <section className="settings-section-card">
          <SectionHeader
            configured={bitbucketConfigured}
            title="Bitbucket"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            }
          />
          {loading ? (
            <FormSkeleton />
          ) : (
            <form onSubmit={handleBitbucketSubmit} className="p-5 sm:p-6 space-y-4">
              <p className="text-sm text-slate-600">
                Create an API token at{" "}
                <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                  id.atlassian.com
                </a>{" "}
                with Bitbucket repository read/write scopes.
              </p>
              <label className="block space-y-1.5">
                <span className="label">Atlassian account email</span>
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={bitbucketUsername}
                  onChange={(e) => setBitbucketUsername(e.target.value)}
                  className="input"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="label">API token</span>
                <PasswordInput
                  required={!bitbucketConfigured}
                  autoComplete="new-password"
                  placeholder={bitbucketConfigured ? SAVED_SECRET_PLACEHOLDER : "API token"}
                  value={bitbucketPassword}
                  onChange={(e) => setBitbucketPassword(e.target.value)}
                  className="input"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={bitbucketSaving} className="btn-primary">
                  {bitbucketSaving ? "Saving…" : bitbucketConfigured ? "Update Bitbucket" : "Connect Bitbucket"}
                </button>
                {bitbucketConfigured && (
                  <button
                    type="button"
                    disabled={bitbucketDisconnecting}
                    onClick={async () => {
                      if (!confirm("Remove Bitbucket credentials?")) return;
                      setBitbucketDisconnecting(true);
                      try {
                        await api.disconnectBitbucket();
                        setBitbucketConfigured(false);
                        setBitbucketPassword("");
                        toast("Bitbucket credentials removed.", "success");
                      } catch (err) {
                        handleAuthError(err);
                      } finally {
                        setBitbucketDisconnecting(false);
                      }
                    }}
                    className="btn-secondary text-red-600 hover:bg-red-50"
                  >
                    {bitbucketDisconnecting ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
            </form>
          )}
        </section>

        {/* 4. Preferences */}
        <section className="settings-section-card">
          <SectionHeader
            title="Preferences"
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
          <div className="p-5 sm:p-6 space-y-3 text-sm text-slate-600">
            <p>Integration credentials are stored encrypted for your session only and cleared on logout.</p>
            <p>
              Default AI for implementation:{" "}
              <span className="font-medium text-slate-800">
                {cursorConfigured ? "Cursor" : openaiConfigured ? "OpenAI" : "Not configured"}
              </span>
            </p>
          </div>
        </section>
        </div>
      </div>
    </Layout>
  );
}
