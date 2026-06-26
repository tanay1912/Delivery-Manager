import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, User } from "../../api/client";
import Layout from "../../components/Layout";
import AISection from "./AISection";
import BitbucketSection from "./BitbucketSection";
import JiraSection from "./JiraSection";
import PreferencesSection from "./PreferencesSection";
import { SettingsProvider, useSettings } from "./SettingsProvider";
import SettingsOverview from "./SettingsOverview";

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/settings": {
    title: "Setup overview",
    subtitle: "See what's connected and what still needs configuration.",
  },
  "/settings/jira": {
    title: "Jira",
    subtitle: "Your Atlassian OAuth session for tickets and writeback.",
  },
  "/settings/bitbucket": {
    title: "Bitbucket",
    subtitle: "API and Git credentials for repositories and deployments.",
  },
  "/settings/ai": {
    title: "AI provider",
    subtitle: "Connect Cursor or OpenAI for code generation and verification.",
  },
  "/settings/preferences": {
    title: "Preferences",
    subtitle: "Delivery defaults and session options.",
  },
};

function SettingsContent() {
  const { pathname } = useLocation();
  const { error } = useSettings();
  const page = PAGE_TITLES[pathname] ?? PAGE_TITLES["/settings"];

  return (
    <div className="flex-1 lg:min-h-0 lg:overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{page.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{page.subtitle}</p>
        </header>

        {error && <div className="alert-error mb-4">{error}</div>}

        <Routes>
          <Route index element={<SettingsOverview />} />
          <Route path="jira" element={<JiraSection />} />
          <Route path="bitbucket" element={<BitbucketSection />} />
          <Route path="ai" element={<AISection />} />
          <Route path="preferences" element={<PreferencesSection />} />
          <Route path="*" element={<Navigate to="/settings" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [siteName, setSiteName] = useState("");

  useEffect(() => {
    api.ensureAuth().then((data) => {
      setUser(data.user);
      setSiteName(data.site_name);
    });
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      navigate("/login");
    }
  }, [navigate]);

  return (
    <Layout user={user} siteName={siteName} onLogout={handleLogout}>
      <SettingsProvider>
        <SettingsContent />
      </SettingsProvider>
    </Layout>
  );
}
