import { Link, useLocation } from "react-router-dom";

const ADMIN_TABS = [
  {
    to: "/admin/mappings",
    label: "Project mappings",
    description: "Jira ↔ Bitbucket links",
  },
  {
    to: "/admin/database",
    label: "Database",
    description: "Jira custom field IDs",
  },
] as const;

export default function AdminNav() {
  const { pathname } = useLocation();

  return (
    <nav
      className="mb-4 flex-shrink-0 rounded-xl border border-slate-200/90 bg-white p-1.5 shadow-sm"
      aria-label="Admin configuration"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {ADMIN_TABS.map((tab) => {
          const active = pathname === tab.to;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`rounded-lg px-4 py-3 transition-colors ${
                active
                  ? "bg-blue-50 text-blue-800 ring-1 ring-blue-200/70"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <span className="block text-sm font-semibold">{tab.label}</span>
              <span className={`block text-xs mt-0.5 ${active ? "text-blue-700/80" : "text-slate-500"}`}>
                {tab.description}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
