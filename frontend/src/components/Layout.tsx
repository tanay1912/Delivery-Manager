import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { User } from "../api/client";
import UserMenu from "./UserMenu";

interface LayoutProps {
  user?: User | null;
  siteName?: string;
  onLogout?: () => void;
  children: ReactNode;
}

function BrandMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand">
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
    </span>
  );
}

export default function Layout({ user, siteName, onLogout, children }: LayoutProps) {
  const location = useLocation();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-700/50 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 shadow-lg shadow-slate-900/20">
        <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-3.5 group">
            <BrandMark />
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2.5">
              <span className="text-xl font-extrabold text-white tracking-tight group-hover:text-brand-200 transition-colors">
                Delivery Manager
              </span>
              {siteName && (
                <span className="text-xs sm:text-sm text-slate-400 font-normal hidden sm:inline">
                  {siteName}
                </span>
              )}
            </div>
          </Link>
          {user && (
            <div className="flex items-center gap-1 sm:gap-2">
              <Link
                to="/dashboard"
                className={
                  location.pathname === "/dashboard" ? "nav-link-active" : "nav-link hidden sm:inline-flex"
                }
              >
                Tickets
              </Link>
              <Link
                to="/admin/mappings"
                className={
                  location.pathname.startsWith("/admin") ? "nav-link-active" : "nav-link"
                }
              >
                Mappings
              </Link>
              <Link
                to="/settings"
                className={location.pathname === "/settings" ? "nav-link-active" : "nav-link"}
              >
                Settings
              </Link>
              <UserMenu user={user} onLogout={onLogout} />
            </div>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
