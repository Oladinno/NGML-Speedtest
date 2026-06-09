"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "./ThemeProvider";

const navItems = [
  { href: "/", icon: "speed", label: "Speed Test" },
  { href: "/dashboard", icon: "dashboard", label: "Dashboard" },
  { href: "/dashboard", icon: "analytics", label: "Reports" },
  { href: "/dashboard", icon: "settings", label: "Settings" },
];

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const isDashboard = pathname?.startsWith("/dashboard");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col h-screen p-4 gap-4 bg-surface-container-lowest/40 backdrop-blur-xl border-r border-border-subtle w-64 shrink-0 z-40 relative">
        {/* Glow overlay behind sidebar logo */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-secondary/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center gap-3 px-4 py-6 relative z-10">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 via-secondary to-purple-600 flex items-center justify-center shadow-[0_4px_12px_rgba(37,99,235,0.2)]">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span
            className="text-[22px] font-black tracking-wider bg-gradient-to-r from-primary via-on-surface to-secondary bg-clip-text text-transparent"
            style={{ fontFamily: "var(--font-geist)" }}
          >
            NETPULSE
          </span>
        </div>

        <div className="px-4 mb-2 relative z-10">
          <div className="flex items-center gap-3 py-3.5 border-b border-border-subtle">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-secondary/20 to-purple-500/20 border border-secondary/30 flex items-center justify-center overflow-hidden shadow-inner">
              <span className="text-sm font-bold bg-gradient-to-tr from-secondary to-purple-400 bg-clip-text text-transparent">JD</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] leading-[16px] tracking-wider font-semibold text-on-surface">Network Admin</span>
              <span className="text-[10px] text-secondary font-medium tracking-wide uppercase">Enterprise Tier</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 flex flex-col gap-1.5 px-2 relative z-10">
          {navItems.map((item) => {
            const active = item.href === "/" ? !isDashboard : isDashboard && item.href === "/dashboard";
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                className={`flex items-center gap-3.5 px-4 py-3 rounded-xl font-semibold transition-all duration-300 relative group ${
                  active
                    ? "bg-gradient-to-r from-secondary/15 to-secondary/5 text-secondary border-l-2 border-secondary pl-3.5"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/40"
                }`}
              >
                <span className={`material-symbols-outlined text-[20px] transition-transform duration-300 group-hover:scale-110 ${active ? "text-secondary" : ""}`}>{item.icon}</span>
                <span className="text-[14px] tracking-wide">{item.label}</span>
                {active && (
                  <div className="absolute right-3 w-1.5 h-1.5 rounded-full bg-secondary shadow-[0_0_8px_var(--secondary)] animate-pulse" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-2 relative z-10">
          <Link
            href="/"
            className="w-full h-11 bg-gradient-to-r from-secondary to-blue-600 hover:from-blue-600 hover:to-secondary text-white rounded-xl font-semibold text-[12px] tracking-[0.06em] flex items-center justify-center hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 shadow-[0_4px_14px_rgba(37,99,235,0.25)] hover:shadow-[0_6px_20px_rgba(37,99,235,0.35)]"
          >
            RUN SPEED TEST
          </Link>
        </div>

        <div className="flex flex-col gap-1 px-2 border-t border-border-subtle pt-4 mt-auto relative z-10">
          <a className="flex items-center gap-3.5 px-4 py-2.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/40 rounded-xl transition-all duration-200 cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">help</span>
            <span className="text-[14px]">Help Center</span>
          </a>
          <a className="flex items-center gap-3.5 px-4 py-2.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/40 rounded-xl transition-all duration-200 cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span className="text-[14px]">Sign Out</span>
          </a>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-y-auto no-scrollbar bg-background relative">
        {/* Glow Effects in main background */}
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-secondary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-12 left-1/3 w-[600px] h-[600px] bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

        {/* Top Bar */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-border-subtle bg-surface-container-lowest/30 backdrop-blur-xl sticky top-0 z-30">
          <h1 className="text-[20px] font-bold tracking-tight text-primary">
            {isDashboard ? "Network Monitor Overview" : "Performance Analysis Tool"}
          </h1>
          <div className="flex items-center gap-4">
            <button
              onClick={toggle}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/60 border border-border-subtle bg-surface-container-lowest/40 transition-all duration-300"
              title="Toggle theme"
            >
              {theme === "dark" ? (
                <svg className="w-4 h-4 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              )}
            </button>
            <div className="relative">
              <span className="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer p-2 rounded-xl border border-border-subtle bg-surface-container-lowest/40 block transition-all duration-300">notifications</span>
              <div className="absolute top-1.5 right-1.5 w-2 h-2 bg-secondary rounded-full ring-2 ring-background animate-pulse" />
            </div>
          </div>
        </header>

        <div className="flex-1 relative z-10">{children}</div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-surface-container-lowest/80 backdrop-blur-xl h-16 flex justify-around items-center px-4 z-50 border-t border-border-subtle">
        <Link href="/" className={`flex flex-col items-center gap-1 ${!isDashboard ? "text-secondary" : "text-on-surface-variant"}`}>
          <span className="material-symbols-outlined text-[20px]">speed</span>
          <span className="text-[10px] font-semibold">Speed</span>
        </Link>
        <Link href="/dashboard" className={`flex flex-col items-center gap-1 ${isDashboard ? "text-secondary" : "text-on-surface-variant"}`}>
          <span className="material-symbols-outlined text-[20px]">dashboard</span>
          <span className="text-[10px]">Home</span>
        </Link>
        <div className="flex flex-col items-center gap-1 text-on-surface-variant">
          <span className="material-symbols-outlined text-[20px]">analytics</span>
          <span className="text-[10px]">Data</span>
        </div>
        <div className="flex flex-col items-center gap-1 text-on-surface-variant">
          <span className="material-symbols-outlined text-[20px]">settings</span>
          <span className="text-[10px]">Config</span>
        </div>
      </nav>
    </div>
  );
}
