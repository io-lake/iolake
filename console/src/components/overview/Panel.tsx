import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/// A card with a sentence-case title, as the overview's panels have; the
/// kit's Card titles in mono caps, which is the stat-tile label style.
export function Panel({
  title,
  label,
  action,
  children,
  className = "",
}: {
  title: string;
  /// The region's accessible name, when the title alone is ambiguous.
  label?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label ?? title}
      className={`bg-surface border border-border rounded-card shadow-card min-w-0 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <h2 className="text-[13px] font-semibold text-text">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/// A link that looks like the kit's button, so a "fix it" action can be a
/// real link (opens in a new tab, shows its address) rather than a button
/// that navigates.
export function LinkButton({
  to,
  children,
  variant = "secondary",
  size = "sm",
}: {
  to: string;
  children: ReactNode;
  variant?: "secondary" | "primary";
  size?: "sm" | "md";
}) {
  const look =
    variant === "primary"
      ? "bg-primary text-primary-fg hover:bg-primary-hover border border-transparent"
      : "bg-surface text-text border border-border-strong hover:bg-surface-2";
  const dims = size === "sm" ? "h-7 px-2.5 text-[11px]" : "h-8 px-3 text-[12px]";
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center gap-1.5 rounded-control font-medium
        whitespace-nowrap transition-colors ${look} ${dims}`}
    >
      {children}
    </Link>
  );
}

/// A quiet placeholder block while a number loads.
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block rounded-[6px] bg-surface-2 ${className}`} />;
}
