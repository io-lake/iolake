import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../ui";
import { bucketOf, list, type PolicyDoc } from "./model";

/// A card with the mock's header: a 13px title and a muted note or action on
/// the right. Tables inside scroll sideways within the card.
export function Section({
  title,
  aside,
  children,
  className = "",
  pad = false,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section aria-label={title} className={`bg-surface border border-border rounded-card shadow-card min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3">
        <h2 className="text-[13px] font-semibold text-text">{title}</h2>
        {aside && <div className="text-[12px] text-muted flex items-center gap-2">{aside}</div>}
      </div>
      <div className={pad ? "px-4 pb-4" : ""}>{children}</div>
    </section>
  );
}

export function Overline({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[11px] uppercase tracking-wider text-muted">{children}</div>;
}

/// A plain table with the kit's header style (mono 11px caps, muted).
export function DataTable({
  head,
  children,
  empty,
}: {
  head: { label: string; right?: boolean; className?: string }[];
  children?: ReactNode;
  empty?: ReactNode;
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-surface-2">
            {head.map((h) => (
              <th
                key={h.label}
                scope="col"
                className={`px-3.5 py-2 font-mono text-[11px] uppercase tracking-wider text-muted font-medium whitespace-nowrap
                  ${h.right ? "text-right" : "text-left"} ${h.className ?? ""}`}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colSpan={head.length} className="px-3.5 py-6 text-center text-[12px] text-muted border-t border-border">
                {empty ?? "Nothing here"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  right,
  className = "",
  strong,
  mono,
}: {
  children?: ReactNode;
  right?: boolean;
  className?: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3.5 py-2 h-9 border-t border-border text-[12px] ${strong ? "text-text font-medium" : "text-text-2"}
        ${mono ? "font-mono" : ""} ${right ? "text-right tabular-nums" : "text-left"} ${className}`}
    >
      {children}
    </td>
  );
}

export interface Column {
  name: string;
  type: string;
  required: boolean;
  note?: string;
}

export function SchemaTable({ columns, noteLabel }: { columns: Column[]; noteLabel?: string }) {
  return (
    <DataTable
      head={[
        { label: "Column" },
        { label: "Type" },
        { label: "Required" },
        ...(noteLabel ? [{ label: noteLabel }] : []),
      ]}
      empty="This table has no columns recorded."
    >
      {columns.map((c) => (
        <tr key={c.name}>
          <Td strong mono className="whitespace-nowrap">
            {c.name}
          </Td>
          <Td mono className="[overflow-wrap:anywhere]">
            {c.type}
          </Td>
          <Td>{c.required ? "Yes" : "No"}</Td>
          {noteLabel && <Td className="text-muted">{c.note || "—"}</Td>}
        </tr>
      ))}
    </DataTable>
  );
}

/// The location row: where the data is, and the bucket it is in.
export function WhereItLives({ location, extra }: { location?: string; extra?: { label: string; value: ReactNode }[] }) {
  const bucket = bucketOf(location);
  return (
    <section
      aria-label="Where it lives"
      className="bg-surface border border-border rounded-card shadow-card px-4 py-3.5 flex gap-x-8 gap-y-3 flex-wrap"
    >
      <div className="min-w-0">
        <Overline>Location</Overline>
        <div className="font-mono text-[12px] text-text [overflow-wrap:anywhere] mt-0.5">{location || "—"}</div>
      </div>
      <div>
        <Overline>Bucket</Overline>
        {bucket ? (
          <Link to={`/buckets/${encodeURIComponent(bucket)}`} className="font-mono text-[12px] text-accent hover:underline">
            {bucket}
          </Link>
        ) : (
          <div className="text-[12px] text-muted">{"—"}</div>
        )}
      </div>
      {extra?.map((e) => (
        <div key={e.label} className="min-w-0">
          <Overline>{e.label}</Overline>
          <div className="text-[12px] text-text mt-0.5 [overflow-wrap:anywhere]">{e.value}</div>
        </div>
      ))}
    </section>
  );
}

export function Tile({ label, value, sub, mono }: { label: string; value: ReactNode; sub?: ReactNode; mono?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-card shadow-card px-4 py-3.5 min-w-0">
      <Overline>{label}</Overline>
      <div
        className={
          mono
            ? "font-mono text-[14px] font-medium text-text pt-1 break-words"
            : "font-display text-[24px] leading-7 font-semibold text-text tabular-nums whitespace-nowrap"
        }
      >
        {value}
      </div>
      {sub && <div className="text-[11.5px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">{children}</div>;
}

export function KeyValues({
  rows,
  empty,
  keyMono = true,
  head = ["Key", "Value"],
}: {
  head?: [string, string];
  rows: [string, ReactNode][];
  empty?: string;
  /** Keys are identifiers (property names) unless they are prose labels. */
  keyMono?: boolean;
}) {
  return (
    <DataTable head={[{ label: head[0], className: "w-1/3" }, { label: head[1] }]} empty={empty}>
      {rows.map(([k, v]) => (
        <tr key={k}>
          <Td mono={keyMono} strong className="align-top whitespace-nowrap">
            {k}
          </Td>
          <Td mono className="[overflow-wrap:anywhere]">
            {v}
          </Td>
        </tr>
      ))}
    </DataTable>
  );
}

/// A policy's statements as rows: who, what, on which resources.
export function PolicyStatements({ policy, empty }: { policy: PolicyDoc | null; empty: string }) {
  const st = policy?.Statement ?? [];
  return (
    <DataTable
      head={[{ label: "Effect", className: "w-24" }, { label: "Principals" }, { label: "Actions" }, { label: "Resources" }]}
      empty={empty}
    >
      {st.map((s, i) => (
        <tr key={i}>
          <Td className="align-top">
            <Badge kind={s.Effect === "Deny" ? "err" : "ok"}>{s.Effect ?? "—"}</Badge>
          </Td>
          <Td mono className="align-top [overflow-wrap:anywhere]">
            {list(s.Principal).join(", ") || "Anyone"}
          </Td>
          <Td mono className="align-top [overflow-wrap:anywhere]">
            {list(s.Action).join(", ")}
          </Td>
          <Td mono className="align-top [overflow-wrap:anywhere]">
            {list(s.Resource).join(", ")}
          </Td>
        </tr>
      ))}
    </DataTable>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-3 py-10 justify-center" role="status">
      <div className="w-16 h-0.5 bg-surface-2 rounded-full overflow-hidden">
        <div className="h-full w-1/2 bg-accent rounded-full animate-[loading-bar_1.2s_ease-in-out_infinite]" />
      </div>
      <span className="text-[12px] text-muted">Loading {what}…</span>
    </div>
  );
}
