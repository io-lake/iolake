import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";

/// Small pieces the Buckets pages share: the card frame, the table header
/// cell, the details panel and its sections, and a definition list.

export function CardFrame({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      className={`bg-surface border border-border rounded-card shadow-card min-w-0 ${className}`}
    >
      {children}
    </section>
  );
}

export function Th({
  children,
  align = "left",
  className = "",
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-3.5 py-2 bg-surface-2 font-mono text-[11px] uppercase tracking-wider text-muted
        font-normal whitespace-nowrap ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      {children}
    </th>
  );
}

/// A body row that can be selected. Selected rows sit on `accent-soft`;
/// others take the hover fill.
export function SelectableRow({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect?: () => void;
  children: ReactNode;
}) {
  return (
    <tr
      aria-selected={selected}
      onClick={onSelect}
      className={`border-t border-border ${onSelect ? "cursor-pointer" : ""} ${
        selected ? "bg-accent-soft" : "hover:bg-surface-2"
      }`}
    >
      {children}
    </tr>
  );
}

/// The in-flow details panel on the right of a list. It is a card beside the
/// table, not an overlay, and stacks under it on narrow screens.
export function DetailsPanel({
  label,
  overline,
  title,
  sub,
  onClose,
  children,
}: {
  label: string;
  overline: string;
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className="bg-surface border border-border rounded-card shadow-card min-w-0 self-start"
    >
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{overline}</div>
          <h2 className="font-mono text-[15px] leading-[21px] font-semibold text-text break-all">{title}</h2>
          {sub && <div className="text-[12px] text-muted mt-0.5">{sub}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          title="Close details"
          className="shrink-0 p-1 rounded-control text-muted hover:text-text hover:bg-surface-2"
        >
          <X size={15} />
        </button>
      </div>
      {children}
    </aside>
  );
}

export function PanelSection({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="px-4 py-3.5 flex flex-col gap-2.5 border-t border-border">
      {(title || action) && (
        <div className="flex items-baseline justify-between gap-2">
          {title && (
            <h3 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{title}</h3>
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/// Label on the left, value on the right.
export function Kv({ rows, labelWidth = 120 }: { rows: [string, ReactNode][]; labelWidth?: number }) {
  return (
    <dl
      className="grid gap-x-3 gap-y-2 text-[12.5px] m-0"
      style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr)` }}
    >
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="m-0 text-text min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Overline({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{children}</div>;
}

/// A settings card on the bucket page: a heading, one line saying what the
/// setting does, then its controls.
export function SettingCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <CardFrame className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-text">{title}</h2>
          {description && <p className="text-[12px] text-muted mt-0.5 max-w-[68ch]">{description}</p>}
        </div>
        {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
      </div>
      {children}
    </CardFrame>
  );
}

/// A link that looks like the kit's Button, for actions that navigate.
export function LinkButton({
  to,
  variant = "secondary",
  size = "md",
  icon,
  children,
  className = "",
}: {
  to: string;
  variant?: "primary" | "secondary";
  size?: "md" | "sm";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const look =
    variant === "primary"
      ? "bg-primary text-primary-fg hover:bg-primary-hover border border-transparent"
      : "bg-surface text-text border border-border-strong hover:bg-surface-2";
  const dims = size === "sm" ? "h-7 px-2.5 text-[11px]" : "h-8 px-3 text-[12px]";
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center gap-1.5 rounded-control font-medium transition-colors ${look} ${dims} ${className}`}
    >
      {icon}
      {children}
    </Link>
  );
}

/// A quiet destructive action: red text, no fill. The page's one loud
/// destructive button is the kit's `danger`.
export function DangerTextButton({
  children,
  icon,
  onClick,
  disabled,
  label,
}: {
  children?: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /// Accessible name and tooltip, for an icon-only button.
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-control text-[11px] font-medium text-err
        hover:bg-err-soft disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {icon}
      {children}
    </button>
  );
}
