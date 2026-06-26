import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { User } from "../api/client";
import AppSidebar from "./AppSidebar";
import MobileNav from "./MobileNav";
import UserMenu from "./UserMenu";

interface LayoutProps {
  user?: User | null;
  siteName?: string;
  onLogout?: () => void;
  children: ReactNode;
  showSidebar?: boolean;
}

function BrandMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm">
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

export default function Layout({ user, siteName, onLogout, children, showSidebar = true }: LayoutProps) {
  const location = useLocation();
  const sidebarVisible = showSidebar && user && location.pathname !== "/login";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-700/50 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 shadow-lg shadow-slate-900/20">
        <div className="w-full px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-3 group">
            <BrandMark />
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
              <span className="text-lg font-extrabold text-white tracking-tight group-hover:text-blue-200 transition-colors">
                Delivery Manager
              </span>
              {siteName && (
                <span className="text-xs text-slate-400 font-normal hidden sm:inline">{siteName}</span>
              )}
            </div>
          </Link>
          {user && <UserMenu user={user} onLogout={onLogout} />}
        </div>
      </header>

      <div className="flex flex-1 min-h-0 flex-col">
        {sidebarVisible && <MobileNav />}
        <div className="flex flex-1 min-h-0">
          {sidebarVisible && <AppSidebar />}
          <main className="flex-1 min-w-0 flex flex-col min-h-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
