import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Building2,
  FileWarning,
  LogOut,
  Menu,
  Users,
  UsersRound,
  WalletCards,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./context/AuthContext";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { BranchesPage } from "./pages/BranchesPage";
import { BorrowersPage } from "./pages/BorrowersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoanDetailsPage } from "./pages/LoanDetailsPage";
import { LoansPage } from "./pages/LoansPage";
import { LoginPage } from "./pages/LoginPage";
import { OverdueReportPage } from "./pages/OverdueReportPage";
import { StaffPage } from "./pages/StaffPage";

interface NavDefinition {
  to: string;
  label: string;
  icon: JSX.Element;
  visible: (role?: string) => boolean;
}

const NAV_ITEMS: NavDefinition[] = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: <BarChart3 size={18} />,
    visible: () => true
  },
  {
    to: "/borrowers",
    label: "Members",
    icon: <Users size={18} />,
    visible: () => true
  },
  {
    to: "/loans",
    label: "Collections",
    icon: <WalletCards size={18} />,
    visible: () => true
  },
  {
    to: "/staff",
    label: "Staff",
    icon: <UsersRound size={18} />,
    visible: (role) => role === "super_admin" || role === "branch_admin"
  },
  {
    to: "/branches",
    label: "Branches",
    icon: <Building2 size={18} />,
    visible: (role) => role === "super_admin"
  },
  {
    to: "/reports/overdue",
    label: "Overdue",
    icon: <FileWarning size={18} />,
    visible: (role) => role === "super_admin" || role === "branch_admin"
  }
];

function NavItem({ to, label, icon, onClick }: { to: string; label: string; icon: JSX.Element; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      title={label}
      className={({ isActive }) =>
        `sidebar-nav-link group inline-flex min-w-max items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition lg:min-w-0 ${
          isActive
            ? "bg-white text-slate-900 shadow-[0_10px_24px_rgba(8,24,36,0.22)]"
            : "text-white/80 hover:bg-white/15 hover:text-white"
        }`
      }
    >
      <span className="sidebar-icon inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 text-inherit transition group-hover:bg-white/25">
        {icon}
      </span>
      <span className="sidebar-text">{label}</span>
    </NavLink>
  );
}

function WorkspaceSidebar({
  username,
  role,
  navItems,
  onLogout,
  onNavigate
}: {
  username?: string;
  role?: string;
  navItems: NavDefinition[];
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="sidebar-shell flex h-full min-h-[320px] flex-col p-4 lg:p-5">
      <Link to="/dashboard" className="side-brand" onClick={onNavigate}>
        <p className="sidebar-text text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">Operations</p>
        <p className="sidebar-text mt-1 text-[1.08rem] font-bold tracking-tight text-white">Collection Monitoring</p>
        <p className="sidebar-text mt-1 text-xs text-white/80">Unified branch collections workspace</p>
      </Link>

      <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:grid lg:gap-2 lg:overflow-visible lg:pb-0">
        {navItems.map((item) => (
          <NavItem key={item.to} to={item.to} label={item.label} icon={item.icon} onClick={onNavigate} />
        ))}
      </nav>

      <div className="sidebar-user-card mt-4 rounded-2xl border border-white/15 bg-white/10 p-3 text-white/90 lg:mt-auto">
        <p className="sidebar-text text-sm font-semibold">{username}</p>
        <p className="sidebar-text text-xs uppercase tracking-wide text-white/70">{role}</p>
        <button
          onClick={onLogout}
          className="sidebar-signout-btn mt-3 inline-flex items-center gap-2 rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-sm font-semibold transition hover:bg-white/20"
        >
          <LogOut size={16} />
          <span className="sidebar-text">Sign Out</span>
        </button>
      </div>
    </div>
  );
}

function MobileBottomNav({ navItems, pathname }: { navItems: NavDefinition[]; pathname: string }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <nav
      className="collector-mobile-bottom-nav fixed inset-x-3 bottom-3 z-[100] flex items-center gap-2 rounded-[26px] border border-white/80 bg-white/88 p-2 shadow-[0_18px_45px_rgba(8,24,36,0.18)] backdrop-blur-xl lg:hidden"
      aria-label="Collector navigation"
    >
      {navItems.map((item) => {
        const isActive = pathname === item.to || (item.to === "/loans" && pathname.startsWith("/loan-details/"));

        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold transition ${
              isActive ? "bg-teal-600 text-white shadow-[0_10px_24px_rgba(13,148,136,0.28)]" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${isActive ? "bg-white/18" : "bg-slate-100 text-slate-700"}`}>
              {item.icon}
            </span>
            <span className="truncate">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>,
    document.body
  );
}

function ShellLayout() {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const location = useLocation();
  const isCollectorMobileNav = user?.role === "staff";

  const navItems = useMemo(
    () => NAV_ITEMS.filter((item) => item.visible(user?.role)),
    [user?.role]
  );

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  function handleLogout() {
    setLogoutConfirmOpen(true);
  }

  return (
    <div className="app-shell">
      <ConfirmDialog
        open={logoutConfirmOpen}
        tone="warning"
        title="Sign out of your session?"
        description="You can sign back in anytime using your account credentials."
        confirmLabel="Sign Out"
        cancelLabel="Stay Signed In"
        onCancel={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          logout();
        }}
      />
      <div className="app-grid">
        <aside className="side-panel hidden lg:block lg:sticky lg:top-5 lg:h-[calc(100vh-2.5rem)]">
          <WorkspaceSidebar
            username={user?.username}
            role={user?.role}
            navItems={navItems}
            onLogout={handleLogout}
          />
        </aside>

        <AnimatePresence>
          {!isCollectorMobileNav && mobileOpen && (
            <>
              <motion.button
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[90] bg-slate-900/55 backdrop-blur-sm lg:hidden"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
              />
              <motion.aside
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }}
                className="side-panel fixed left-3 top-3 z-[95] h-[calc(100vh-1.5rem)] w-[min(82vw,320px)] lg:hidden"
              >
                <div className="absolute right-3 top-3">
                  <button
                    type="button"
                    className="btn-muted h-8 w-8 rounded-lg border-white/30 bg-white/10 p-0 text-white hover:bg-white/20"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Close menu"
                  >
                    <X size={16} />
                  </button>
                </div>
                <WorkspaceSidebar
                  username={user?.username}
                  role={user?.role}
                  navItems={navItems}
                  onLogout={handleLogout}
                  onNavigate={() => setMobileOpen(false)}
                />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <section className={`content-panel ${isCollectorMobileNav ? "pb-24 lg:pb-6" : ""}`}>
          {isCollectorMobileNav ? (
            <div className="mobile-shell-bar mobile-shell-bar-sticky lg:hidden">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{user?.username ?? "Collector"}</p>
                <p className="text-xs uppercase tracking-wide text-slate-500">Collector Workspace</p>
              </div>
              <button type="button" className="btn-muted h-9 gap-1.5 px-3" onClick={handleLogout} aria-label="Sign out">
                <LogOut size={15} />
                <span>Sign Out</span>
              </button>
            </div>
          ) : (
            <div className="mobile-shell-bar lg:hidden">
              <button type="button" className="btn-muted h-9 w-9 p-0" onClick={() => setMobileOpen(true)} aria-label="Open menu">
                <Menu size={16} />
              </button>
              <span />
              <span />
            </div>
          )}

          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }}>
            <Routes>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/borrowers" element={<BorrowersPage />} />
              <Route path="/loans" element={<LoansPage />} />
              <Route
                path="/staff"
                element={
                  <ProtectedRoute roles={["super_admin", "branch_admin"]}>
                    <StaffPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/branches"
                element={
                  <ProtectedRoute roles={["super_admin"]}>
                    <BranchesPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/loan-details/:loanId" element={<LoanDetailsPage />} />
              <Route path="/reports/overdue" element={<OverdueReportPage />} />
              <Route
                path="/analytics"
                element={
                  <ProtectedRoute roles={["super_admin", "branch_admin"]}>
                    <AnalyticsPage />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </motion.div>
        </section>

        {isCollectorMobileNav && <MobileBottomNav navItems={navItems} pathname={location.pathname} />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="*"
        element={
          <ProtectedRoute>
            <ShellLayout />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
