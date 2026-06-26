import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, JiraFieldItem, User } from "../api/client";
import AdminNav from "../components/AdminNav";
import JiraFieldSelect from "../components/JiraFieldSelect";
import Layout from "../components/Layout";
import { useToast } from "../context/ToastContext";

const emptyForm = {
  jira_impact_analysis_field: "",
  jira_unit_testing_field: "",
  jira_admin_database_field: "",
};

function FieldMappingHint({
  fieldId,
  fieldName,
  envOverride,
  envVar,
}: {
  fieldId: string;
  fieldName: string;
  envOverride: string;
  envVar: string;
}) {
  const effectiveId = envOverride || fieldId;
  const effectiveName = fieldName;

  if (!effectiveId) return null;

  return (
    <p className="text-xs text-slate-600 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
      Configured:{" "}
      <span className="font-medium text-slate-800">{effectiveName || "Unknown field"}</span>{" "}
      <span className="font-mono text-slate-500">({effectiveId})</span>
      {envOverride && (
        <span className="block mt-1 text-amber-700">
          Overridden by server env <code className="font-mono">{envVar}={envOverride}</code>
        </span>
      )}
    </p>
  );
}

export default function AdminDatabase() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [siteName, setSiteName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldNames, setFieldNames] = useState({
    impact: "",
    unitTesting: "",
    adminDatabase: "",
  });
  const [envOverrides, setEnvOverrides] = useState({ impact: "", unitTesting: "", adminDatabase: "" });
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [cacheTotal, setCacheTotal] = useState(0);
  const [cacheSyncedAt, setCacheSyncedAt] = useState<string | null>(null);
  const [catalogFields, setCatalogFields] = useState<JiraFieldItem[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    },
    [navigate, toast],
  );

  const applySettings = useCallback((data: Awaited<ReturnType<typeof api.getAdminDatabaseSettings>>) => {
    setForm({
      jira_impact_analysis_field: data.jira_impact_analysis_field,
      jira_unit_testing_field: data.jira_unit_testing_field,
      jira_admin_database_field: data.jira_admin_database_field,
    });
    setFieldNames({
      impact: data.jira_impact_analysis_field_name,
      unitTesting: data.jira_unit_testing_field_name,
      adminDatabase: data.jira_admin_database_field_name,
    });
    setEnvOverrides({
      impact: data.env_jira_impact_analysis_field,
      unitTesting: data.env_jira_unit_testing_field,
      adminDatabase: data.env_jira_admin_database_field,
    });
    setUpdatedAt(data.updated_at);
    setCacheTotal(data.jira_fields_cache_total);
    setCacheSyncedAt(data.jira_fields_cached_at);
  }, []);

  const loadCatalog = useCallback(
    async (query = "", refresh = false) => {
      try {
        const data = await api.getJiraFields(query, true, refresh);
        setCatalogFields(data.fields);
        if (data.cached_at) {
          setCacheSyncedAt(data.cached_at);
        }
      } catch (err) {
        handleAuthError(err);
      }
    },
    [handleAuthError],
  );

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminDatabaseSettings();
      applySettings(data);
      setError(null);
      await loadCatalog("", data.jira_fields_cache_total === 0);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  }, [applySettings, handleAuthError, loadCatalog]);

  useEffect(() => {
    api
      .ensureAuth()
      .then((data) => {
        setUser(data.user);
        setSiteName(data.site_name);
      })
      .catch(handleAuthError);
  }, [handleAuthError]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => {
      void loadCatalog(catalogQuery.trim());
    }, catalogQuery.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [catalogQuery, loadCatalog, loading]);

  const handleLogout = async () => {
    await api.logout();
    navigate("/login");
  };

  const handleSyncFields = async () => {
    setSyncing(true);
    setError(null);
    try {
      const data = await api.syncJiraFieldsCache();
      setCacheTotal(data.total);
      setCacheSyncedAt(data.cached_at);
      await loadCatalog(catalogQuery.trim());
      toast(`Synced ${data.total} Jira fields to the database.`, "success");
      const settings = await api.getAdminDatabaseSettings();
      applySettings(settings);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateAdminDatabaseSettings({
        jira_impact_analysis_field: form.jira_impact_analysis_field.trim(),
        jira_unit_testing_field: form.jira_unit_testing_field.trim(),
        jira_admin_database_field: form.jira_admin_database_field.trim(),
      });
      applySettings(updated);
      toast("Database settings saved.", "success");
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSaving(false);
    }
  };

  const catalogSummary = useMemo(() => {
    if (!cacheSyncedAt) return "Not synced yet";
    return `${cacheTotal} fields · last synced ${new Date(cacheSyncedAt).toLocaleString()}`;
  }, [cacheSyncedAt, cacheTotal]);

  return (
    <Layout user={user} siteName={siteName} onLogout={handleLogout}>
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <AdminNav />

        {error && (
          <div className="alert-error mb-4 flex items-start gap-3">
            <span>{error}</span>
          </div>
        )}

        <div className="card overflow-hidden max-w-3xl mb-6">
          <div className="card-header">
            <h2 className="card-title">Jira custom fields</h2>
            <p className="card-subtitle">
              Map Delivery Manager write-back targets to Jira custom fields. The field catalog is stored in the
              database so ids and display names stay in sync.
            </p>
          </div>

          {loading ? (
            <div className="p-6 space-y-4">
              <div className="h-10 skeleton" />
              <div className="h-10 skeleton" />
              <div className="h-10 skeleton w-32" />
            </div>
          ) : (
            <form onSubmit={(event) => void handleSubmit(event)} className="p-6 space-y-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-800">Field catalog</p>
                    <p className="text-xs text-slate-500 mt-0.5">{catalogSummary}</p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary shrink-0"
                    disabled={syncing}
                    onClick={() => void handleSyncFields()}
                  >
                    {syncing ? "Syncing…" : "Sync from Jira"}
                  </button>
                </div>
                <p>
                  Sync pulls the full field list from Jira (same as{" "}
                  <code className="font-mono text-xs">/api/jira/fields</code>) and saves id + name pairs in the
                  database. Search below uses the saved catalog — no Jira admin access required.
                </p>
              </div>

              <label className="block space-y-1.5">
                <span className="label">Impact Analysis field</span>
                <JiraFieldSelect
                  value={form.jira_impact_analysis_field}
                  onChange={(fieldId) => setForm({ ...form, jira_impact_analysis_field: fieldId })}
                  placeholder="Search Impact Analysis…"
                  disabled={saving || Boolean(envOverrides.impact)}
                />
                <FieldMappingHint
                  fieldId={form.jira_impact_analysis_field}
                  fieldName={fieldNames.impact}
                  envOverride={envOverrides.impact}
                  envVar="JIRA_IMPACT_ANALYSIS_FIELD"
                />
                <p className="text-xs text-slate-500">
                  Used when posting AI-generated impact analysis during implementation. Auto-discovered as{" "}
                  <span className="font-medium">Impact Analysis</span> when empty.
                </p>
              </label>

              <label className="block space-y-1.5">
                <span className="label">Unit Testing Field</span>
                <JiraFieldSelect
                  value={form.jira_unit_testing_field}
                  onChange={(fieldId) => setForm({ ...form, jira_unit_testing_field: fieldId })}
                  placeholder="Search Unit Testing…"
                  disabled={saving || Boolean(envOverrides.unitTesting)}
                />
                <FieldMappingHint
                  fieldId={form.jira_unit_testing_field}
                  fieldName={fieldNames.unitTesting}
                  envOverride={envOverrides.unitTesting}
                  envVar="JIRA_UNIT_TESTING_FIELD"
                />
                <p className="text-xs text-slate-500">
                  Updated when you post a Unit Testing comment and screenshot after website verification. Auto-discovered
                  as <span className="font-medium">Unit Testing</span> or{" "}
                  <span className="font-medium">Unit Testing Field</span> when empty.
                </p>
              </label>

              <label className="block space-y-1.5">
                <span className="label">Admin/ Database field</span>
                <JiraFieldSelect
                  value={form.jira_admin_database_field}
                  onChange={(fieldId) => setForm({ ...form, jira_admin_database_field: fieldId })}
                  placeholder="Search Admin/ Database…"
                  disabled={saving || Boolean(envOverrides.adminDatabase)}
                />
                <FieldMappingHint
                  fieldId={form.jira_admin_database_field}
                  fieldName={fieldNames.adminDatabase}
                  envOverride={envOverrides.adminDatabase}
                  envVar="JIRA_ADMIN_DATABASE_FIELD"
                />
                <p className="text-xs text-slate-500">
                  Updated when you post Unit Testing verification and the change includes admin-related files
                  (e.g. <span className="font-medium">system.xml</span> or paths under{" "}
                  <span className="font-medium">admin/</span>). Auto-discovered as{" "}
                  <span className="font-medium">Admin/ Database</span> when empty.
                </p>
              </label>

              {updatedAt && (
                <p className="text-xs text-slate-400">
                  Last saved: {new Date(updatedAt).toLocaleString()}
                </p>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? "Saving…" : "Save settings"}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="card overflow-hidden max-w-5xl">
          <div className="card-header">
            <h2 className="card-title">Field catalog</h2>
            <p className="card-subtitle">
              Browse all custom fields stored in the database. Search by display name or field id.
            </p>
          </div>
          <div className="p-6 space-y-4">
            <input
              type="text"
              className="input max-w-md"
              placeholder="Search by name or id (e.g. customfield_10070)…"
              value={catalogQuery}
              onChange={(event) => setCatalogQuery(event.target.value)}
            />
            {catalogFields.length === 0 ? (
              <p className="text-sm text-slate-500">
                No fields in the catalog yet. Click <span className="font-medium">Sync from Jira</span> above.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Display name</th>
                      <th className="px-4 py-3 font-medium">Field id</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {catalogFields.map((field) => (
                      <tr key={field.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-2.5 font-medium text-slate-900">{field.name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{field.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
