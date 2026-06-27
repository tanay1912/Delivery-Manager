import {
  createContext,
  FormEvent,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, ModelOption, User } from "../../api/client";
import { useToast } from "../../context/ToastContext";

export interface SettingsContextValue {
  user: User | null;
  siteName: string;
  siteUrl: string;
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  jiraConnected: boolean;
  bitbucketConfigured: boolean;
  bitbucketUsername: string;
  setBitbucketUsername: (v: string) => void;
  bitbucketPassword: string;
  setBitbucketPassword: (v: string) => void;
  bitbucketSaving: boolean;
  bitbucketDisconnecting: boolean;
  openaiConfigured: boolean;
  openaiModel: string;
  setOpenaiModel: (v: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (v: string) => void;
  openaiSaving: boolean;
  openaiDisconnecting: boolean;
  openaiModels: ModelOption[];
  openaiModelsLoading: boolean;
  openaiModelsFromApi: boolean;
  cursorConfigured: boolean;
  cursorModel: string;
  setCursorModel: (v: string) => void;
  cursorApiKey: string;
  setCursorApiKey: (v: string) => void;
  cursorSaving: boolean;
  cursorDisconnecting: boolean;
  cursorModels: ModelOption[];
  cursorModelsLoading: boolean;
  cursorModelsFromApi: boolean;
  defaultImplementationAi: "cursor" | "openai";
  setDefaultImplementationAi: (v: "cursor" | "openai") => void;
  mappingsCount: number;
  handleBitbucketSubmit: (event: FormEvent) => Promise<void>;
  handleOpenAISubmit: (event: FormEvent) => Promise<void>;
  handleCursorSubmit: (event: FormEvent) => Promise<void>;
  handleLogout: () => Promise<void>;
  handleJiraDisconnect: () => Promise<void>;
  revealOpenAIKey: () => Promise<void>;
  revealCursorKey: () => Promise<void>;
  revealBitbucketToken: () => Promise<void>;
  refreshOpenAIModels: (apiKey?: string) => Promise<void>;
  refreshCursorModels: (apiKey?: string) => Promise<void>;
  disconnectBitbucket: () => Promise<void>;
  disconnectOpenAI: () => Promise<void>;
  disconnectCursor: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mappingsCount, setMappingsCount] = useState(0);

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

  const [defaultImplementationAi, setDefaultImplementationAi] = useState<"cursor" | "openai">("cursor");

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
    const [me, mappingsData] = await Promise.all([api.ensureAuth(), api.getMappings()]);
    setUser(me.user);
    setSiteName(me.site_name);
    setSiteUrl(me.site_url);
    setBitbucketConfigured(!!me.bitbucket_configured);
    setMappingsCount(mappingsData.mappings.length);
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

  useEffect(() => {
    if (cursorConfigured) {
      setDefaultImplementationAi("cursor");
    } else if (openaiConfigured) {
      setDefaultImplementationAi("openai");
    }
  }, [cursorConfigured, openaiConfigured]);

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

  const revealOpenAIKey = useCallback(async () => {
    try {
      const data = await api.revealOpenAISecret();
      if (data.api_key) setOpenaiApiKey(data.api_key);
    } catch (err) {
      handleAuthError(err);
      throw err;
    }
  }, [handleAuthError]);

  const revealCursorKey = useCallback(async () => {
    try {
      const data = await api.revealCursorSecret();
      if (data.api_key) setCursorApiKey(data.api_key);
    } catch (err) {
      handleAuthError(err);
      throw err;
    }
  }, [handleAuthError]);

  const revealBitbucketToken = useCallback(async () => {
    try {
      const data = await api.revealBitbucketSecret();
      if (data.api_token) setBitbucketPassword(data.api_token);
    } catch (err) {
      handleAuthError(err);
      throw err;
    }
  }, [handleAuthError]);

  const handleJiraDisconnect = async () => {
    if (!confirm("Disconnect from Jira? You will be signed out.")) return;
    await handleLogout();
  };

  const disconnectBitbucket = async () => {
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
  };

  const disconnectOpenAI = async () => {
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
  };

  const disconnectCursor = async () => {
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
  };

  const value: SettingsContextValue = {
    user,
    siteName,
    siteUrl,
    loading,
    error,
    setError,
    jiraConnected,
    bitbucketConfigured,
    bitbucketUsername,
    setBitbucketUsername,
    bitbucketPassword,
    setBitbucketPassword,
    bitbucketSaving,
    bitbucketDisconnecting,
    openaiConfigured,
    openaiModel,
    setOpenaiModel,
    openaiApiKey,
    setOpenaiApiKey,
    openaiSaving,
    openaiDisconnecting,
    openaiModels,
    openaiModelsLoading,
    openaiModelsFromApi,
    cursorConfigured,
    cursorModel,
    setCursorModel,
    cursorApiKey,
    setCursorApiKey,
    cursorSaving,
    cursorDisconnecting,
    cursorModels,
    cursorModelsLoading,
    cursorModelsFromApi,
    defaultImplementationAi,
    setDefaultImplementationAi,
    mappingsCount,
    handleBitbucketSubmit,
    handleOpenAISubmit,
    handleCursorSubmit,
    handleLogout,
    handleJiraDisconnect,
    revealOpenAIKey,
    revealCursorKey,
    revealBitbucketToken,
    refreshOpenAIModels,
    refreshCursorModels,
    disconnectBitbucket,
    disconnectOpenAI,
    disconnectCursor,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
