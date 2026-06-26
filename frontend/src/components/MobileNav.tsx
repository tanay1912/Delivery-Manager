import { Link, useLocation } from "react-router-dom";

const MOBILE_NAV = [
  { to: "/dashboard", label: "Tickets", match: (p: string) => p === "/dashboard" },
  { to: "/history", label: "History", match: (p: string) => p === "/history" },
  { to: "/admin/mappings", label: "Mappings", match: (p: string) => p.startsWith("/admin") },
  { to: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
];

export default function MobileNav() {
  const { pathname } = useLocation();

  return (
    <nav
      className="lg:hidden flex-shrink-0 border-b border-slate-200 bg-white/90 backdrop-blur-sm px-2 py-2 overflow-x-auto"
      aria-label="Mobile navigation"
    >
      <div className="flex gap-1 min-w-max">
        {MOBILE_NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200/60"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
