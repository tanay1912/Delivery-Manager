import { Link, useLocation } from "react-router-dom";
import { useDashboardProjects } from "../context/DashboardProjectContext";
import ProjectList from "./ProjectList";

interface NavItem {
  to: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  match?: (pathname: string) => boolean;
}

function TicketsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
      />
    </svg>
  );
}

function MappingsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
      />
    </svg>
  );
}

function OverviewIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
      />
    </svg>
  );
}

function JiraIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
      />
    </svg>
  );
}

function BitbucketIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 8l4 4m0 0l-4 4m4-4H3" />
    </svg>
  );
}

function AIIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
      />
    </svg>
  );
}

function PreferencesIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

const WORK_NAV: NavItem[] = [
  {
    to: "/dashboard",
    label: "My tickets",
    description: "Assigned Jira issues",
    icon: <TicketsIcon />,
    match: (p) => p === "/dashboard",
  },
  {
    to: "/admin/mappings",
    label: "Project mappings",
    description: "Jira ↔ Bitbucket links",
    icon: <MappingsIcon />,
    match: (p) => p.startsWith("/admin"),
  },
];

const SETTINGS_NAV: NavItem[] = [
  {
    to: "/settings",
    label: "Setup overview",
    icon: <OverviewIcon />,
    match: (p) => p === "/settings",
  },
  {
    to: "/settings/jira",
    label: "Jira",
    icon: <JiraIcon />,
    match: (p) => p === "/settings/jira",
  },
  {
    to: "/settings/bitbucket",
    label: "Bitbucket",
    icon: <BitbucketIcon />,
    match: (p) => p === "/settings/bitbucket",
  },
  {
    to: "/settings/ai",
    label: "AI provider",
    icon: <AIIcon />,
    match: (p) => p === "/settings/ai",
  },
  {
    to: "/settings/preferences",
    label: "Preferences",
    icon: <PreferencesIcon />,
    match: (p) => p === "/settings/preferences",
  },
];

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.match ? item.match(pathname) : pathname === item.to;
  return (
    <Link
      to={item.to}
      className={`sidebar-nav-item group ${active ? "sidebar-nav-item-active" : ""}`}
    >
      <span className={`sidebar-nav-icon ${active ? "sidebar-nav-icon-active" : ""}`}>{item.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.label}</span>
        {item.description && (
          <span className={`block truncate text-[11px] mt-0.5 ${active ? "text-blue-200/80" : "text-slate-500"}`}>
            {item.description}
          </span>
        )}
      </span>
    </Link>
  );
}

function SidebarSubLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.match ? item.match(pathname) : pathname === item.to;
  return (
    <Link
      to={item.to}
      className={`sidebar-subnav-item ${active ? "sidebar-subnav-item-active" : ""}`}
    >
      <span className="sidebar-subnav-icon">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export default function AppSidebar() {
  const { pathname } = useLocation();
  const settingsActive = pathname.startsWith("/settings");
  const onDashboard = pathname === "/dashboard";
  const dashboardProjects = useDashboardProjects();

  return (
    <aside className="app-sidebar flex flex-col w-64 flex-shrink-0 border-r border-slate-200/90 bg-white/80 backdrop-blur-sm">
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6" aria-label="Main navigation">
        <div>
          <p className="sidebar-section-label">Work</p>
          <div className="space-y-0.5 mt-2">
            {WORK_NAV.map((item) => (
              <SidebarLink key={item.to} item={item} pathname={pathname} />
            ))}
          </div>
        </div>

        {onDashboard && dashboardProjects && (
          <div className="flex flex-col min-h-0">
            <p className="sidebar-section-label">Configured projects</p>
            <div className="mt-2 rounded-xl border border-slate-200/90 bg-slate-50/50 overflow-hidden flex flex-col max-h-[min(24rem,40vh)]">
              <div className="px-3 py-2.5 border-b border-slate-200/70 bg-white/60 flex-shrink-0">
                <p className="text-xs text-slate-500">
                  {dashboardProjects.projectsLoading && dashboardProjects.projects.length === 0
                    ? "Loading..."
                    : `${dashboardProjects.projectsTotal} linked to Bitbucket`}
                </p>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <ProjectList
                  projects={dashboardProjects.projects}
                  selectedKey={dashboardProjects.selectedProject}
                  loading={dashboardProjects.projectsLoading}
                  total={dashboardProjects.projectsTotal}
                  onSelect={dashboardProjects.onSelect}
                  onSearch={dashboardProjects.onSearch}
                  emptyMessage={
                    dashboardProjects.mappedProjectKeys.size === 0
                      ? "No projects are linked to Bitbucket yet."
                      : "No configured projects match your search."
                  }
                  configureHref="/settings"
                  showMappingSettings
                />
              </div>
            </div>
          </div>
        )}

        <div>
          <p className="sidebar-section-label">Settings</p>
          <div className="space-y-0.5 mt-2">
            {SETTINGS_NAV.map((item) => (
              <SidebarSubLink key={item.to} item={item} pathname={pathname} />
            ))}
          </div>
          {settingsActive && (
            <p className="mt-3 mx-2 text-[11px] text-slate-500 leading-relaxed">
              Connect integrations and configure how deliveries run.
            </p>
          )}
        </div>
      </nav>

      <div className="flex-shrink-0 px-4 py-4 border-t border-slate-200/80 bg-slate-50/50">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Credentials are encrypted per session and cleared on logout.
        </p>
      </div>
    </aside>
  );
}
