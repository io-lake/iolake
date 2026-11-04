/// Data and helpers for the lakehouse catalog browser: the Iceberg REST
/// catalog (warehouses, namespaces, tables) and Unity Catalog, read the way
/// the console's other pages read them. Calls the shared client does not
/// have (warehouses, policies, data filters, shares) live here so this page
/// does not reshape `api/client.ts`.

import { iceberg } from "../../api/client";

// ---------------------------------------------------------------------------
// Selection, kept in the URL so a table can be linked and the back button works
// ---------------------------------------------------------------------------

export type Sel =
  | { kind: "home" }
  | { kind: "warehouse"; wh: string }
  | { kind: "namespace"; wh: string; ns: string }
  | { kind: "itable"; wh: string; ns: string; table: string }
  | { kind: "catalog"; cat: string }
  | { kind: "schema"; cat: string; schema: string }
  | { kind: "utable"; cat: string; schema: string; table: string };

export function selFromParams(p: URLSearchParams): Sel {
  const wh = p.get("wh");
  const uc = p.get("uc");
  const t = p.get("t");
  if (wh) {
    const ns = p.get("ns");
    if (ns && t) return { kind: "itable", wh, ns, table: t };
    if (ns) return { kind: "namespace", wh, ns };
    return { kind: "warehouse", wh };
  }
  if (uc) {
    const s = p.get("s");
    if (s && t) return { kind: "utable", cat: uc, schema: s, table: t };
    if (s) return { kind: "schema", cat: uc, schema: s };
    return { kind: "catalog", cat: uc };
  }
  return { kind: "home" };
}

export function selToSearch(s: Sel): string {
  const p = new URLSearchParams();
  switch (s.kind) {
    case "home":
      break;
    case "warehouse":
      p.set("wh", s.wh);
      break;
    case "namespace":
      p.set("wh", s.wh);
      p.set("ns", s.ns);
      break;
    case "itable":
      p.set("wh", s.wh);
      p.set("ns", s.ns);
      p.set("t", s.table);
      break;
    case "catalog":
      p.set("uc", s.cat);
      break;
    case "schema":
      p.set("uc", s.cat);
      p.set("s", s.schema);
      break;
    case "utable":
      p.set("uc", s.cat);
      p.set("s", s.schema);
      p.set("t", s.table);
      break;
  }
  const q = p.toString();
  return q ? `?${q}` : "";
}

export function selKey(s: Sel): string {
  return selToSearch(s);
}

export const catalogHref = (s: Sel) => `/catalog${selToSearch(s)}`;

// ---------------------------------------------------------------------------
// Admin and Iceberg calls the shared client does not have
// ---------------------------------------------------------------------------

export interface WarehouseInfo {
  name: string;
  bucket: string;
  location: string;
  tenant: string;
  created_at: number;
  properties?: Record<string, string>;
}

export interface Share {
  name: string;
  comment?: string;
}

/// The admin API answers errors as plain text; Iceberg as
/// `{"error":{"message"}}`. Either way the message is what the person needs.
async function failure(r: Response): Promise<Error> {
  const text = await r.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    const msg = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message);
    if (msg) return new Error(msg);
  } catch {
    /* not JSON */
  }
  return new Error(text.trim() || `Request failed (${r.status})`);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw await failure(r);
  if (r.status === 204) return {} as T;
  const text = await r.text();
  return (text ? JSON.parse(text) : {}) as T;
}

const wq = (wh: string) => `warehouse=${encodeURIComponent(wh)}`;
const enc = encodeURIComponent;

export const warehouses = {
  list: () => call<{ warehouses: WarehouseInfo[] }>("GET", "/_admin/warehouses"),
  create: (name: string) => call<WarehouseInfo>("POST", "/_admin/warehouses", { name }),
  remove: (name: string) => call<void>("DELETE", `/_admin/warehouses/${enc(name)}`),
};

export interface EffectivePolicy {
  namespace: string;
  catalog_policy?: PolicyDoc;
  namespace_policies: { namespace: string; policy?: PolicyDoc }[];
}

export interface DataFilter {
  filter_id: string;
  filter_name: string;
  principal_arns: string[];
  allowed_columns: string[];
  excluded_columns: string[];
  row_filter_expression: string;
  created_at: number;
}

export const icebergExtra = {
  /// Snapshot ids are 64-bit and lose digits as JS numbers, so they are
  /// read as strings before parsing.
  loadTable: async (wh: string, ns: string, table: string): Promise<IcebergLoadResult> => {
    const r = await fetch(`/iceberg/v1/namespaces/${enc(ns)}/tables/${enc(table)}?${wq(wh)}`);
    if (!r.ok) throw await failure(r);
    const text = (await r.text()).replace(
      /("(?:snapshot-id|parent-snapshot-id|current-snapshot-id)"\s*:\s*)(-?\d+)/g,
      '$1"$2"',
    );
    const j = JSON.parse(text) as IcebergLoadResult & { config?: unknown };
    // Vended credentials are transient and not for display.
    delete j.config;
    return j;
  },
  setNamespacePolicy: (wh: string, ns: string, policy: unknown) =>
    call<void>("PUT", `/iceberg/v1/namespaces/${enc(ns)}/policy?${wq(wh)}`, {
      policy: JSON.stringify(policy),
    }),
  effectivePolicy: (wh: string, ns: string) =>
    call<EffectivePolicy>("GET", `/iceberg/v1/namespaces/${enc(ns)}/effective-policy?${wq(wh)}`),
  dataFilters: (wh: string, ns: string, table: string) =>
    call<{ filters: DataFilter[] }>(
      "GET",
      `/iceberg/v1/namespaces/${enc(ns)}/tables/${enc(table)}/data-filters?${wq(wh)}`,
    ),
  createNamespace: (wh: string, ns: string) => iceberg.createNamespace([ns], {}, wh),
};

export const shares = {
  list: () => call<{ shares: Share[] }>("GET", "/_admin/shares"),
  tables: (name: string) => call<{ tables: unknown[] }>("GET", `/_admin/shares/${enc(name)}/tables`),
};

// ---------------------------------------------------------------------------
// Iceberg table metadata (the parts the page reads)
// ---------------------------------------------------------------------------

export type IcebergType =
  | string
  | { type: "struct"; fields: IcebergField[] }
  | { type: "list"; element: IcebergType; "element-required"?: boolean }
  | { type: "map"; key: IcebergType; value: IcebergType };

export interface IcebergField {
  id: number;
  name: string;
  type: IcebergType;
  required: boolean;
  doc?: string;
}

export interface IcebergSnapshot {
  "snapshot-id": string;
  "parent-snapshot-id"?: string;
  "timestamp-ms": number;
  "sequence-number"?: number;
  "schema-id"?: number;
  summary?: Record<string, string> & { operation?: string };
}

export interface IcebergMetadata {
  "format-version": number;
  "table-uuid": string;
  location: string;
  "last-updated-ms": number;
  "last-sequence-number"?: number;
  "current-schema-id"?: number;
  schemas?: { "schema-id": number; fields: IcebergField[]; "identifier-field-ids"?: number[] }[];
  schema?: { "schema-id"?: number; fields: IcebergField[]; "identifier-field-ids"?: number[] };
  "default-spec-id"?: number;
  "partition-specs"?: { "spec-id": number; fields: { name: string; transform: string; "source-id": number }[] }[];
  "default-sort-order-id"?: number;
  "sort-orders"?: { "order-id": number; fields: { transform: string; "source-id": number; direction: string }[] }[];
  properties?: Record<string, string>;
  "current-snapshot-id"?: string;
  snapshots?: IcebergSnapshot[];
  refs?: Record<string, { "snapshot-id": string; type: string }>;
  "metadata-log"?: unknown[];
}

export interface IcebergLoadResult {
  "metadata-location"?: string;
  metadata: IcebergMetadata;
}

export function currentSchema(m: IcebergMetadata) {
  const id = m["current-schema-id"];
  return m.schemas?.find((s) => s["schema-id"] === id) ?? m.schemas?.[m.schemas.length - 1] ?? m.schema;
}

export function typeText(t: IcebergType): string {
  if (typeof t === "string") return t;
  if (t.type === "struct") return `struct<${t.fields.map((f) => `${f.name}: ${typeText(f.type)}`).join(", ")}>`;
  if (t.type === "list") return `list<${typeText(t.element)}>`;
  if (t.type === "map") return `map<${typeText(t.key)}, ${typeText(t.value)}>`;
  return JSON.stringify(t);
}

/// `day(order_ts)`, `bucket[16](customer_id)`, or empty when unpartitioned.
export function partitionText(m: IcebergMetadata): string[] {
  const spec = m["partition-specs"]?.find((s) => s["spec-id"] === m["default-spec-id"]);
  if (!spec) return [];
  const fields = currentSchema(m)?.fields ?? [];
  return spec.fields.map((f) => {
    const col = fields.find((c) => c.id === f["source-id"])?.name ?? `field ${f["source-id"]}`;
    return f.transform === "identity" ? col : `${f.transform}(${col})`;
  });
}

export function sortText(m: IcebergMetadata): string[] {
  const order = m["sort-orders"]?.find((o) => o["order-id"] === m["default-sort-order-id"]);
  if (!order || order.fields.length === 0) return [];
  const fields = currentSchema(m)?.fields ?? [];
  return order.fields.map((f) => {
    const col = fields.find((c) => c.id === f["source-id"])?.name ?? `field ${f["source-id"]}`;
    const base = f.transform === "identity" ? col : `${f.transform}(${col})`;
    return `${base} ${f.direction}`;
  });
}

export function snapshotsNewestFirst(m: IcebergMetadata): IcebergSnapshot[] {
  return [...(m.snapshots ?? [])].sort((a, b) => b["timestamp-ms"] - a["timestamp-ms"]);
}

export function currentSnapshot(m: IcebergMetadata): IcebergSnapshot | undefined {
  const id = m["current-snapshot-id"];
  if (!id || id === "-1") return undefined;
  return m.snapshots?.find((s) => s["snapshot-id"] === id);
}

const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));

export function opLabel(op: string | undefined): string {
  if (!op) return "Commit";
  return op.charAt(0).toUpperCase() + op.slice(1);
}

/// What a snapshot changed, from its summary, in the words a person reads:
/// "+700 rows · 1 file". Only fields the summary carries are used.
export function snapshotChange(s: IcebergSnapshot): string {
  const sm = s.summary ?? {};
  const parts: string[] = [];
  const added = num(sm["added-records"]);
  const deleted = num(sm["deleted-records"]);
  const addedFiles = num(sm["added-data-files"]);
  const removedFiles = num(sm["deleted-data-files"]);
  if (added) parts.push(`+${added.toLocaleString()} rows`);
  if (deleted) parts.push(`−${deleted.toLocaleString()} rows`);
  const files: string[] = [];
  if (addedFiles) files.push(`+${addedFiles.toLocaleString()}`);
  if (removedFiles) files.push(`−${removedFiles.toLocaleString()}`);
  if (files.length) {
    const n = (addedFiles ?? 0) + (removedFiles ?? 0);
    parts.push(`${files.join(" ")} ${n === 1 ? "file" : "files"}`);
  }
  return parts.join(" · ");
}

export interface IcebergTotals {
  rows?: number;
  files?: number;
  bytes?: number;
  deleteFiles?: number;
}

export function totals(s: IcebergSnapshot | undefined): IcebergTotals {
  const sm = s?.summary ?? {};
  return {
    rows: num(sm["total-records"]),
    files: num(sm["total-data-files"]),
    bytes: num(sm["total-files-size"]),
    deleteFiles: num(sm["total-delete-files"]),
  };
}

// ---------------------------------------------------------------------------
// Policies (S3 / Iceberg / Unity share the BucketPolicy shape)
// ---------------------------------------------------------------------------

export interface PolicyStatement {
  Sid?: string;
  Effect?: string;
  Principal?: unknown;
  Action?: string | string[];
  Resource?: string | string[];
  Condition?: unknown;
}

export interface PolicyDoc {
  Version?: string;
  Statement?: PolicyStatement[];
}

export function asPolicy(v: unknown): PolicyDoc | null {
  if (!v) return null;
  if (typeof v === "string") {
    try {
      return asPolicy(JSON.parse(v));
    } catch {
      return null;
    }
  }
  if (typeof v === "object" && Object.keys(v as object).length > 0) return v as PolicyDoc;
  return null;
}

export function list(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).flatMap(list);
  return [String(v)];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtBytes(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${units[i]}`;
}

export function fmtCount(n: number | undefined): string {
  return n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString();
}

/// "9 min ago" under a day, else the date. Module scope: it reads the clock.
export function ago(ms: number | undefined): string {
  if (!ms) return "—";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return fmtDate(ms);
}

/// For a tile: "9 min ago" under a day, else the date alone.
export function when(ms: number | undefined): string {
  if (!ms) return "\u2014";
  if (Date.now() - ms < 86_400_000) return ago(ms);
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDate(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/// "Nov 4, 02:03 PM"; the year only when it is not this one.
export function fmtShort(ms: number | undefined): string {
  if (!ms) return "\u2014";
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/// `s3://bucket/a/b` → `bucket`.
export function bucketOf(location: string | undefined): string | null {
  const m = /^s3a?:\/\/([^/]+)/.exec(location ?? "");
  return m ? m[1] : null;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function unityFormat(f: string | undefined): string {
  if (!f) return "Unknown format";
  const s = f.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function titleCase(s: string | undefined): string {
  if (!s) return "—";
  const l = s.toLowerCase().replace(/_/g, " ");
  return l.charAt(0).toUpperCase() + l.slice(1);
}
