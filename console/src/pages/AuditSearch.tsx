import { useState } from "react";
import { Download, Search } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Banner, Button, Input, Select, Table, Row, Cell } from "../components/ui";
import type { Column } from "../components/ui";
import { audit, type AuditEvent, type AuditQuery } from "../api/client";

const APIS = ["", "s3", "admin", "console", "sts", "iceberg", "unity", "delta-sharing"];

const COLUMNS: Column[] = [
  { key: "time", label: "Time" },
  { key: "api", label: "API" },
  { key: "method", label: "Method" },
  { key: "status", label: "Status", align: "right" },
  { key: "action", label: "Action" },
  { key: "bucket", label: "Bucket" },
  { key: "key", label: "Key" },
  { key: "tenant", label: "Tenant" },
  { key: "principal", label: "Principal" },
];

/// A `datetime-local` value (local time) for `now + offsetMs`.
function localInput(offsetMs: number): string {
  const d = new Date(Date.now() + offsetMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/// Audit search and export. The tenant filter shows only for a system admin; a
/// tenant admin is confined to its own tenant by the server regardless.
export default function AuditSearch({ systemAdmin = false }: { systemAdmin?: boolean }) {
  const [from, setFrom] = useState(localInput(-24 * 3600 * 1000));
  const [to, setTo] = useState(localInput(0));
  const [api, setApi] = useState("");
  const [tenant, setTenant] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const query = (): AuditQuery => ({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    api: api || undefined,
    tenant: systemAdmin ? tenant || undefined : undefined,
    q: q || undefined,
  });

  const run = async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await audit.search(query()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows(null);
    } finally {
      setLoading(false);
    }
  };

  const download = (format: "ndjson" | "csv") => {
    window.location.href = audit.downloadUrl(query(), format);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit"
        description="Search the audit log over a time range and export it. Limited to your tenant."
      />

      <div className="bg-surface border border-border rounded-card p-4 flex flex-wrap items-end gap-3">
        <Input label="From" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-2">
          API
          <Select aria-label="API" value={api} onChange={(e) => setApi(e.target.value)}>
            {APIS.map((a) => (
              <option key={a} value={a}>
                {a === "" ? "Any" : a}
              </option>
            ))}
          </Select>
        </label>
        {systemAdmin && (
          <Input label="Tenant" value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="All tenants" />
        )}
        <Input label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="bucket, user, action…" />
        <Button icon={<Search size={13} />} disabled={loading} onClick={() => void run()}>
          Search
        </Button>
        <Button variant="secondary" icon={<Download size={13} />} onClick={() => download("ndjson")}>
          NDJSON
        </Button>
        <Button variant="secondary" icon={<Download size={13} />} onClick={() => download("csv")}>
          CSV
        </Button>
      </div>

      {error && <Banner kind="err" title="Couldn't load the audit log">{error}</Banner>}

      <Table columns={COLUMNS} loading={loading} empty={rows ? "No events in this range." : "Set a range and search."}>
        {rows && rows.length > 0
          ? rows.map((e, i) => (
          <Row key={`${e.time}-${i}`}>
            <Cell className="font-mono text-[11.5px] whitespace-nowrap">{e.time}</Cell>
            <Cell>{e.api}</Cell>
            <Cell>{e.method}</Cell>
            <Cell align="right">{e.status}</Cell>
            <Cell>{e.action ?? ""}</Cell>
            <Cell>{e.bucket ?? ""}</Cell>
            <Cell className="font-mono text-[11.5px]">{e.key ?? ""}</Cell>
            <Cell>{e.bucket_tenant ?? e.principal.tenant ?? ""}</Cell>
            <Cell>{e.principal.user_id ?? e.principal.auth ?? ""}</Cell>
          </Row>
            ))
          : undefined}
      </Table>
    </div>
  );
}
