import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Database, Plus, Search, Share2, Table2, Warehouse } from "lucide-react";
import { Button } from "../ui";
import type { CatalogData } from "./useCatalogData";
import { catalogHref, type Sel } from "./model";

interface Props {
  data: CatalogData;
  sel: Sel;
  onNew: () => void;
}

/// The left pane: Iceberg warehouses → namespaces → tables, Unity catalogs →
/// schemas → tables, and the Delta shares. Every row is a link or a button,
/// so the tree is reachable by keyboard; a group's chevron folds it.
export default function CatalogTree({ data, sel, onNew }: Props) {
  const [query, setQuery] = useState("");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();

  // The selection's own group is open unless the person folded it.
  const selGroup =
    sel.kind === "itable" || sel.kind === "namespace"
      ? `i:${sel.wh}:${sel.ns}`
      : sel.kind === "utable" || sel.kind === "schema"
        ? `u:${sel.cat}:${sel.schema}`
        : "";
  const isOpen = (key: string) => (q ? true : (toggled[key] ?? key === selGroup));
  const toggle = (key: string) => setToggled((t) => ({ ...t, [key]: !isOpen(key) }));

  const match = (ns: string, t: string) => !q || t.toLowerCase().includes(q) || `${ns}.${t}`.toLowerCase().includes(q);

  const ice = data.warehouses.map((w) => ({
    ...w,
    namespaces: (w.namespaces ?? []).map((n) => ({
      ...n,
      shown: (n.tables ?? []).filter((t) => match(n.name, t)),
    })),
  }));
  const uc = data.catalogs.map((c) => ({
    ...c,
    schemas: (c.schemas ?? []).map((s) => ({
      ...s,
      shown: (s.tables ?? []).filter((t) => match(`${c.info.name}.${s.info.name}`, t.name)),
    })),
  }));

  const matches =
    ice.reduce((n, w) => n + w.namespaces.reduce((m, ns) => m + ns.shown.length, 0), 0) +
    uc.reduce((n, c) => n + c.schemas.reduce((m, s) => m + s.shown.length, 0), 0);

  const selIs = (s: Sel) => JSON.stringify(s) === JSON.stringify(sel);

  return (
    <nav
      aria-label="Catalogs"
      className="w-full md:w-[280px] shrink-0 bg-surface border-b md:border-b-0 md:border-r border-border
        flex flex-col md:h-full"
    >
      <div className="p-3 pb-2">
        <label className="relative block">
          <span className="sr-only">Find a table</span>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a table"
            className="w-full h-8 pl-8 pr-2.5 bg-surface text-text border border-border-strong rounded-control
              text-[13px] placeholder:text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 text-[12.5px]">
        {data.loading && <p className="px-2 py-3 text-[12px] text-muted">Loading the catalog…</p>}
        {!data.loading && q && matches === 0 && (
          <p className="px-2 py-3 text-[12px] text-muted">No table matches “{query.trim()}”.</p>
        )}

        {/* Iceberg */}
        {!data.loading &&
          ice.map((w) => {
            const visible = q ? w.namespaces.filter((n) => n.shown.length) : w.namespaces;
            if (q && visible.length === 0) return null;
            return (
              <div key={`w:${w.info.name}`} className="mb-2">
                <SectionLink
                  to={catalogHref({ kind: "warehouse", wh: w.info.name })}
                  on={selIs({ kind: "warehouse", wh: w.info.name })}
                  icon={<Warehouse size={13} />}
                  kind="Iceberg"
                  name={w.info.name}
                />
                {w.error && <p className="px-2 py-1 text-[11px] text-err">{w.error}</p>}
                {!w.error && w.namespaces.length === 0 && (
                  <p className="px-2 py-1 text-[11.5px] text-muted">No namespaces yet</p>
                )}
                {visible.map((n) => {
                  const key = `i:${w.info.name}:${n.name}`;
                  const open = isOpen(key);
                  return (
                    <div key={key}>
                      <GroupRow
                        open={open}
                        onToggle={() => toggle(key)}
                        to={catalogHref({ kind: "namespace", wh: w.info.name, ns: n.name })}
                        on={selIs({ kind: "namespace", wh: w.info.name, ns: n.name })}
                        name={n.name}
                        count={n.tables?.length}
                        error={n.error}
                      />
                      {open &&
                        (q ? n.shown : (n.tables ?? [])).map((t) => {
                          const s: Sel = { kind: "itable", wh: w.info.name, ns: n.name, table: t };
                          return <LeafLink key={t} to={catalogHref(s)} on={selIs(s)} name={t} />;
                        })}
                      {open && !q && n.tables && n.tables.length === 0 && (
                        <p className="pl-[30px] py-1 text-[11.5px] text-muted">No tables</p>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

        {/* Unity */}
        {!data.loading &&
          uc.map((c) => {
            const visible = q ? c.schemas.filter((s) => s.shown.length) : c.schemas;
            if (q && visible.length === 0) return null;
            return (
              <div key={`c:${c.info.name}`} className="mb-2">
                <SectionLink
                  to={catalogHref({ kind: "catalog", cat: c.info.name })}
                  on={selIs({ kind: "catalog", cat: c.info.name })}
                  icon={<Database size={13} />}
                  kind="Unity Catalog"
                  name={c.info.name}
                />
                {c.error && <p className="px-2 py-1 text-[11px] text-err">{c.error}</p>}
                {!c.error && c.schemas.length === 0 && (
                  <p className="px-2 py-1 text-[11.5px] text-muted">No schemas yet</p>
                )}
                {visible.map((s) => {
                  const key = `u:${c.info.name}:${s.info.name}`;
                  const open = isOpen(key);
                  return (
                    <div key={key}>
                      <GroupRow
                        open={open}
                        onToggle={() => toggle(key)}
                        to={catalogHref({ kind: "schema", cat: c.info.name, schema: s.info.name })}
                        on={selIs({ kind: "schema", cat: c.info.name, schema: s.info.name })}
                        name={s.info.name}
                        count={s.tables?.length}
                        error={s.error}
                      />
                      {open &&
                        (q ? s.shown : (s.tables ?? [])).map((t) => {
                          const v: Sel = { kind: "utable", cat: c.info.name, schema: s.info.name, table: t.name };
                          return <LeafLink key={t.name} to={catalogHref(v)} on={selIs(v)} name={t.name} />;
                        })}
                      {open && !q && s.tables && s.tables.length === 0 && (
                        <p className="pl-[30px] py-1 text-[11.5px] text-muted">No tables</p>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

        {!data.loading && (data.warehousesError || data.catalogsError) && (
          <div className="px-2 py-2 space-y-1 text-[11px] text-err">
            {data.warehousesError && <p>Iceberg: {data.warehousesError}</p>}
            {data.catalogsError && <p>Unity Catalog: {data.catalogsError}</p>}
          </div>
        )}

        {!data.loading && !q && data.shares.length > 0 && (
          <div className="mb-2">
            <div className="px-2 pt-3 pb-1 font-mono text-[11px] uppercase tracking-wider text-muted">
              Delta Sharing
            </div>
            {data.shares.map((s) => (
              <Link
                key={s.info.name}
                to="/sharing"
                className="flex items-center gap-2 h-7 px-2 rounded-[6px] text-text-2 hover:bg-surface-2 hover:text-text"
              >
                <Share2 size={13} className="shrink-0 text-muted" aria-hidden />
                <span className="font-mono truncate">{s.info.name}</span>
                {s.tables !== null && (
                  <span className="ml-auto font-mono text-[11px] text-muted shrink-0">
                    {s.tables} {s.tables === 1 ? "table" : "tables"}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border">
        <Button className="w-full" icon={<Plus size={14} />} onClick={onNew}>
          New namespace or schema
        </Button>
      </div>
    </nav>
  );
}

function SectionLink({
  to,
  on,
  icon,
  kind,
  name,
}: {
  to: string;
  on: boolean;
  icon: ReactNode;
  kind: string;
  name: string;
}) {
  return (
    <Link
      to={to}
      aria-current={on ? "page" : undefined}
      className={`flex items-center gap-2 h-7 px-2 mt-1 rounded-[6px] min-w-0 ${
        on ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-text"
      }`}
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-wider shrink-0">{kind}</span>
      <span className="font-mono text-[11.5px] truncate normal-case">· {name}</span>
    </Link>
  );
}

function GroupRow({
  open,
  onToggle,
  to,
  on,
  name,
  count,
  error,
}: {
  open: boolean;
  onToggle: () => void;
  to: string;
  on: boolean;
  name: string;
  count?: number;
  error?: string;
}) {
  return (
    <div
      className={`flex items-center h-7 rounded-[6px] ${on ? "bg-accent-soft text-accent" : "text-text hover:bg-surface-2"}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
        className="h-7 w-7 shrink-0 flex items-center justify-center rounded-[6px] text-muted hover:text-text"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      <Link
        to={to}
        aria-current={on ? "page" : undefined}
        className="flex-1 min-w-0 h-7 flex items-center gap-2 pr-2 font-medium"
      >
        <span className="font-mono truncate">{name}</span>
        {error ? (
          <span className="ml-auto text-[11px] text-err shrink-0">unreadable</span>
        ) : count !== undefined ? (
          <span className="ml-auto font-mono text-[11px] text-muted font-normal shrink-0">{count}</span>
        ) : null}
      </Link>
    </div>
  );
}

function LeafLink({ to, on, name }: { to: string; on: boolean; name: string }) {
  return (
    <Link
      to={to}
      aria-current={on ? "page" : undefined}
      className={`flex items-center gap-2 h-7 pl-[30px] pr-2 rounded-[6px] min-w-0 ${
        on ? "bg-accent-soft text-accent font-medium" : "text-text-2 hover:bg-surface-2 hover:text-text"
      }`}
    >
      <Table2 size={13} className="shrink-0" aria-hidden />
      <span className="font-mono truncate">{name}</span>
    </Link>
  );
}
