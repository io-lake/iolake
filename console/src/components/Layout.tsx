import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Search, LogOut, Sun, Moon, Monitor, BookOpen } from "lucide-react";
import wordmarkLight from "../assets/brand/wordmark-light.svg";
import wordmarkDark from "../assets/brand/wordmark-dark.svg";
import { visibleNav, isActive, locate } from "../shell/nav";
import { useTheme, type ThemePref } from "../shell/theme";
import CrumbsProvider from "../shell/CrumbsProvider";
import { useExtraCrumbs } from "../shell/crumbs";
import CommandPalette from "../shell/CommandPalette";
import { PRODUCT, DOCS_URL } from "../shell/brand";
import { useProtection } from "../api/protection";
import { nodes as nodesApi } from "../api/client";

interface Props {
  user?: string;
  tenant?: string;
  onLogout?: () => void;
}

const NEXT_THEME: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<ThemePref, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

/// The console's frame: the sidebar, the top bar (breadcrumb and the
/// cluster's protection), and the page.
export default function Layout(props: Props) {
  return (
    <CrumbsProvider>
      <Shell {...props} />
    </CrumbsProvider>
  );
}

function Shell({ user, tenant, onLogout }: Props) {
  const isSystemAdmin = !tenant;
  const sections = useMemo(() => visibleNav(isSystemAdmin), [isSystemAdmin]);
  const { pathname } = useLocation();
  const { pref, setPref, dark } = useTheme();
  const [palette, setPalette] = useState(false);
  const [clusterLine, setClusterLine] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!isSystemAdmin) return;
    nodesApi
      .list()
      .then((d) => {
        const ns = d.nodes ?? [];
        const hosts = new Set(ns.map((n) => n.hostname || n.node_name || n.node_id)).size;
        const version = ns.find((n) => n.version)?.version;
        setClusterLine(`${hosts} host${hosts === 1 ? "" : "s"}${version ? ` · v${version}` : ""}`);
      })
      .catch(() => setClusterLine(""));
  }, [isSystemAdmin]);

  const ThemeIcon = pref === "light" ? Sun : pref === "dark" ? Moon : Monitor;

  return (
    <div className="flex h-screen">
      <aside className="w-[240px] bg-sidebar border-r border-border flex flex-col shrink-0" aria-label="Main">
        <div className="px-4 pt-4 pb-3">
          <img
            src={dark ? wordmarkDark : wordmarkLight}
            alt={PRODUCT}
            className="h-[26px] w-auto select-none"
            draggable={false}
          />
          <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted truncate">
            {isSystemAdmin ? "Ops console" : "Console"}
          </div>
          <div className="text-[11.5px] text-text-2 truncate">{isSystemAdmin ? clusterLine : tenant}</div>
        </div>

        <div className="px-3">
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="w-full flex items-center gap-2 h-8 px-2.5 rounded-control border border-border-strong bg-surface text-muted text-[12px] hover:bg-surface-2"
          >
            <Search size={14} aria-hidden />
            <span className="flex-1 text-left">Search or jump to</span>
            <kbd className="font-mono text-[10px] px-1.5 py-px rounded border border-border bg-surface-2">⌘K</kbd>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pt-2 pb-3">
          {sections.map((s, si) => (
            <div key={s.title ?? si} className={s.title ? "mt-4" : "mt-1"}>
              {s.title && (
                <div className="px-2.5 pb-1 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                  {s.title}
                </div>
              )}
              <div className="space-y-px">
                {s.items.map((item) => {
                  const on = isActive(item, pathname);
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      aria-current={on ? "page" : undefined}
                      className={`flex items-center gap-2.5 h-8 px-2.5 rounded-control text-[12.5px] font-medium transition-colors ${
                        on ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-surface-2 hover:text-text"
                      }`}
                    >
                      <item.icon size={15} className="shrink-0" aria-hidden />
                      <span className="flex-1 min-w-0 truncate">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 py-2.5 border-t border-border flex items-center gap-1">
          {user ? (
            <NavLink
              to="/account"
              className={({ isActive: a }) =>
                `flex items-center gap-2.5 flex-1 min-w-0 px-1.5 py-1 rounded-control ${a ? "bg-accent-soft" : "hover:bg-surface-2"}`
              }
              title="My account"
            >
              <span
                aria-hidden
                className="w-7 h-7 shrink-0 rounded-full bg-accent-soft text-accent text-[11px] font-semibold inline-flex items-center justify-center uppercase"
              >
                {initials(user)}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-text truncate">{user}</span>
                <span className="block text-[11px] text-muted truncate">{tenant || "System admin"}</span>
              </span>
            </NavLink>
          ) : (
            <span className="flex-1 text-[11px] text-muted">{PRODUCT}</span>
          )}
          <button
            type="button"
            onClick={() => setPref(NEXT_THEME[pref])}
            className="p-2 rounded-control text-muted hover:text-text hover:bg-surface-2"
            title={THEME_LABEL[pref]}
            aria-label={`${THEME_LABEL[pref]}. Switch theme`}
          >
            <ThemeIcon size={15} />
          </button>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="p-2 rounded-control text-muted hover:text-text hover:bg-surface-2"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={15} />
            </button>
          )}
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar isSystemAdmin={isSystemAdmin} />
        <main className="flex-1 overflow-y-auto bg-bg">
          <Outlet />
        </main>
      </div>

      {palette && <CommandPalette onClose={() => setPalette(false)} sections={sections} />}
    </div>
  );
}

function TopBar({ isSystemAdmin }: { isSystemAdmin: boolean }) {
  const { pathname } = useLocation();
  const { section, item } = locate(pathname);
  const extra = useExtraCrumbs();
  const protection = useProtection(isSystemAdmin);
  const crumbs: { label: string; to?: string; mono?: boolean }[] = [];
  if (section) crumbs.push({ label: section });
  if (item) crumbs.push({ label: item.label, to: extra.length ? item.to : undefined });
  crumbs.push(...extra);
  if (!item && pathname === "/account") crumbs.push({ label: "My account" });

  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-8 border-b border-border bg-surface">
      <nav aria-label="Breadcrumb" className="flex-1 min-w-0 flex items-center gap-1.5 text-[12px] text-muted">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          const cls = `${c.mono ? "font-mono" : ""} ${last ? "text-text font-medium" : ""} truncate`;
          return (
            <span key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <span aria-hidden>/</span>}
              {c.to && !last ? (
                <Link to={c.to} className={`${cls} hover:text-text`}>
                  {c.label}
                </Link>
              ) : (
                <span className={cls} aria-current={last ? "page" : undefined}>
                  {c.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>
      {isSystemAdmin && protection && protection.level !== "unknown" && (
        <Link
          to="/cluster/health"
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-badge text-[11px] font-medium ${
            protection.level === "protected"
              ? "bg-ok-soft text-ok"
              : protection.level === "rebuilding"
                ? "bg-warn-soft text-warn"
                : "bg-err-soft text-err"
          }`}
        >
          <span className="w-[5px] h-[5px] rounded-full bg-current" aria-hidden />
          {protection.level === "protected"
            ? "All data protected"
            : protection.level === "rebuilding"
              ? `Rebuilding ${protection.rebuilding} placement group${protection.rebuilding === 1 ? "" : "s"}`
              : `${protection.atRisk} placement group${protection.atRisk === 1 ? "" : "s"} at risk`}
        </Link>
      )}
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-control text-[12px] font-medium text-muted hover:text-text hover:bg-surface-2"
      >
        <BookOpen size={14} aria-hidden />
        Docs
      </a>
    </header>
  );
}

function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}
