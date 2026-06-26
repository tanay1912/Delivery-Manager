import { Link, useLocation } from "react-router-dom";

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

function HistoryIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
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
    to: "/history",
    label: "Ticket history",
    description: "Past delivery runs",
    icon: <HistoryIcon />,
    match: (p) => p === "/history",
  },
  {
    to: "/admin/mappings",
    label: "Project mappings",
    description: "Jira ↔ Bitbucket & field config",
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
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-semibold leading-snug tracking-tight">{item.label}</span>
        {item.description && (
          <span className={`block text-xs leading-relaxed mt-0.5 ${active ? "text-brand-600/90" : "text-slate-500"}`}>
            {item.description}
          </span>
        )}
      </span>
      {active && <span className="sidebar-nav-active-dot" aria-hidden="true" />}
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
      <span className="text-sm leading-snug">{item.label}</span>
    </Link>
  );
}

function ShieldIcon() {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

export default function AppSidebar() {
  const { pathname } = useLocation();
  const settingsActive = pathname.startsWith("/settings");

  return (
    <aside className="app-sidebar flex flex-col w-[300px] flex-shrink-0">
      <div className="sidebar-header flex-shrink-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Navigation</p>
      </div>

      <nav className="sidebar-scroll flex-1 px-3 pb-4" aria-label="Main navigation">
        <div>
          <p className="sidebar-section-label">Work</p>
          <div className="mt-1.5 space-y-0.5">
            {WORK_NAV.map((item) => (
              <SidebarLink key={item.to} item={item} pathname={pathname} />
            ))}
          </div>
        </div>

        <div className="sidebar-section-divider">
          <p className="sidebar-section-label">Settings</p>
          <div className="mt-1.5 space-y-0.5">
            {SETTINGS_NAV.map((item) => (
              <SidebarSubLink key={item.to} item={item} pathname={pathname} />
            ))}
          </div>
          {settingsActive && (
            <p className="sidebar-settings-hint">
              Connect integrations and configure how deliveries run.
            </p>
          )}
        </div>
      </nav>

      <div className="sidebar-footer flex-shrink-0">
        <div className="sidebar-credentials-note">
          <ShieldIcon />
          <span>Credentials are encrypted per session and cleared on logout.</span>
        </div>
      </div>
    </aside>
  );
}
