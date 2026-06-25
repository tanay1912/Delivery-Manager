import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { User } from "../api/client";

interface LayoutProps {
  user?: User | null;
  siteName?: string;
  onLogout?: () => void;
  children: ReactNode;
}

function BrandMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
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
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
        <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-3 group">
            <BrandMark />
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
              <span className="text-lg font-bold text-slate-900 tracking-tight group-hover:text-brand-700 transition-colors">
                Delivery Manager
              </span>
              {siteName && (
                <span className="text-xs sm:text-sm text-slate-500 font-normal hidden sm:inline">
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
              <div className="hidden sm:block w-px h-6 bg-slate-200 mx-1" />
              <div className="flex items-center gap-2 pl-1">
                {user.avatar_url && (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="w-8 h-8 rounded-full ring-2 ring-white shadow-sm"
                  />
                )}
                <span className="text-sm font-medium text-slate-700 hidden md:inline max-w-[140px] truncate">
                  {user.display_name}
                </span>
                <button onClick={onLogout} className="btn-ghost btn-sm">
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
