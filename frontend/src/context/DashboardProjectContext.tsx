import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, Project } from "../api/client";
import { useToast } from "./ToastContext";

interface DashboardProjectContextValue {
  projects: Project[];
  selectedProject: string | null;
  projectsLoading: boolean;
  projectsTotal: number;
  mappedProjectKeys: Set<string>;
  onSelect: (key: string | null) => void;
  onSearch: (query: string) => void;
}

const DashboardProjectContext = createContext<DashboardProjectContextValue | null>(null);

export function useDashboardProjects() {
  return useContext(DashboardProjectContext);
}

export function DashboardProjectProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [mappedProjectKeys, setMappedProjectKeys] = useState<Set<string>>(new Set());
  const [projectsTotal, setProjectsTotal] = useState(0);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/login");
        return;
      }
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    },
    [navigate, toast],
  );

  const loadMappedProjects = useCallback(
    (query?: string) => {
      setProjectsLoading(true);
      Promise.all([api.getAllProjects(query), api.getMappings()])
        .then(([all, mappingsData]) => {
          const keys = new Set(mappingsData.mappings.map((m) => m.jira_project_key));
          setMappedProjectKeys(keys);
          const configured = all.filter((p) => keys.has(p.key));
          setProjects(configured);
          setProjectsTotal(configured.length);
        })
        .catch(handleAuthError)
        .finally(() => setProjectsLoading(false));
    },
    [handleAuthError],
  );

  useEffect(() => {
    loadMappedProjects();
  }, [loadMappedProjects]);

  const onSearch = useCallback(
    (query: string) => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        loadMappedProjects(query.trim() || undefined);
      }, 300);
    },
    [loadMappedProjects],
  );

  const onSelect = useCallback((key: string | null) => {
    setSelectedProject(key);
  }, []);

  return (
    <DashboardProjectContext.Provider
      value={{
        projects,
        selectedProject,
        projectsLoading,
        projectsTotal,
        mappedProjectKeys,
        onSelect,
        onSearch,
      }}
    >
      {children}
    </DashboardProjectContext.Provider>
  );
}
