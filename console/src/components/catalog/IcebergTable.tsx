import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plug, Shield, Trash2 } from "lucide-react";
import PageHeader from "../PageHeader";
import { Badge, Banner, Button, Chip, Tabs } from "../ui";
import { iceberg } from "../../api/client";
import {
  ago,
  asPolicy,
  catalogHref,
  currentSchema,
  currentSnapshot,
  fmtBytes,
  fmtCount,
  fmtDate,
  fmtShort,
  fmtTime,
  icebergExtra,
  opLabel,
  partitionText,
  plural,
  snapshotChange,
  snapshotsNewestFirst,
  sortText,
  totals,
  typeText,
  type DataFilter,
  type EffectivePolicy,
  type IcebergLoadResult,
} from "./model";
import { ConnectionDialog, PolicyDialog } from "./Dialogs";
import {
  DataTable,
  KeyValues,
  Loading,
  PolicyStatements,
  SchemaTable,
  Section,
  Td,
  Tile,
  TileGrid,
  WhereItLives,
} from "./parts";

const ICEBERG_POLICY_EXAMPLE = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "OBIO": ["arn:objectio:iam::user/alice"] },
      "Action": ["iceberg:LoadTable", "iceberg:ListTables"],
      "Resource": ["arn:obio:iceberg:::sales/*"]
    }
  ]
}`;

type Tab = "overview" | "schema" | "snapshots" | "properties" | "access";

export default function IcebergTable({
  wh,
  ns,
  table,
  onDeleted,
}: {
  wh: string;
  ns: string;
  table: string;
  onDeleted: () => void;
}) {
  const [res, setRes] = useState<{ key: string; data?: IcebergLoadResult; error?: string } | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<"connect" | "policy" | null>(null);
  const [policyTick, setPolicyTick] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const key = `${wh}/${ns}/${table}`;

  useEffect(() => {
    let alive = true;
    icebergExtra
      .loadTable(wh, ns, table)
      .then((data) => alive && setRes({ key, data }))
      .catch((e: Error) => alive && setRes({ key, error: e.message }));
    return () => {
      alive = false;
    };
  }, [wh, ns, table, key]);

  const loaded = res?.key === key ? res : null;
  const m = loaded?.data?.metadata;
  const name = `${ns}.${table}`;

  const remove = async () => {
    if (!confirm(`Delete table ${name}? Its data files stay in the warehouse bucket.`)) return;
    try {
      await iceberg.deleteTable(ns, table, wh);
      onDeleted();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const snaps = m ? snapshotsNewestFirst(m) : [];
  const description = m?.properties?.comment || `Iceberg table in warehouse ${wh}.`;

  return (
    <div>
      <PageHeader
        mono
        title={
          <span className="inline-flex items-center gap-2 flex-wrap">
            {name}
            {m && <Chip mono>Iceberg v{m["format-version"]}</Chip>}
          </span>
        }
        description={m ? description : undefined}
        action={
          <>
            <Button icon={<Plug size={13} />} onClick={() => setDialog("connect")}>
              Connection details
            </Button>
            <Button icon={<Trash2 size={13} />} onClick={() => void remove()}>
              Delete table
            </Button>
            <Button variant="primary" icon={<Shield size={13} />} onClick={() => setDialog("policy")}>
              Grant access
            </Button>
          </>
        }
      />

      {actionError && <Banner kind="err" title={actionError} className="mb-4" />}
      {!loaded && <Loading what="the table" />}
      {loaded?.error && (
        <Banner kind="err" title="The table's metadata could not be read.">
          {loaded.error}
        </Banner>
      )}

      {m && (
        <>
          <Tabs
            variant="underline"
            className="mb-5"
            value={tab}
            onChange={(k) => setTab(k as Tab)}
            items={[
              { key: "overview", label: "Overview" },
              { key: "schema", label: "Schema", count: currentSchema(m)?.fields.length },
              { key: "snapshots", label: "Snapshots", count: snaps.length },
              { key: "properties", label: "Properties" },
              { key: "access", label: "Access" },
            ]}
          />

          {tab === "overview" && <Overview r={loaded!.data!} wh={wh} ns={ns} onAll={() => setTab("snapshots")} />}
          {tab === "schema" && <SchemaTab r={loaded!.data!} />}
          {tab === "snapshots" && <SnapshotsTab r={loaded!.data!} />}
          {tab === "properties" && <PropertiesTab r={loaded!.data!} />}
          {tab === "access" && (
            <AccessTab key={policyTick} wh={wh} ns={ns} table={table} onEdit={() => setDialog("policy")} />
          )}
        </>
      )}

      {dialog === "connect" && (
        <ConnectionDialog
          title="Connection details"
          sub={
            <>
              Table <span className="font-mono">{name}</span> in warehouse <span className="font-mono">{wh}</span>
            </>
          }
          snippets={icebergSnippets(wh, ns, table)}
          note="The catalog signs with SigV4, using an access key from Identity. Loading a table hands the engine short-lived credentials scoped to its location."
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "policy" && (
        <PolicyDialog
          scope={`namespace ${ns} · warehouse ${wh}`}
          note={
            <>
              A namespace policy applies to every table in <span className="font-mono">{ns}</span>. Deny anywhere wins;
              with no statement naming a caller, only the warehouse's administrators get in.
            </>
          }
          example={ICEBERG_POLICY_EXAMPLE}
          load={async () => asPolicy((await iceberg.getNamespace(ns, wh)).properties?.__policy) ?? {}}
          save={(p) => icebergExtra.setNamespacePolicy(wh, ns, p)}
          onSaved={() => setPolicyTick((t) => t + 1)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function icebergSnippets(wh: string, ns: string, table: string) {
  const origin = window.location.origin;
  const uri = `${origin}/iceberg`;
  return [
    {
      key: "pyiceberg",
      label: "PyIceberg",
      text: `from pyiceberg.catalog.rest import RestCatalog

catalog = RestCatalog(
    name="iolake",
    uri="${uri}",
    warehouse="${wh}",
    **{
        "rest.sigv4-enabled": "true",
        "rest.signing-name": "s3",
        "rest.signing-region": "us-east-1",
        "s3.endpoint": "${origin}",
        "s3.path-style-access": "true",
    },
)
table = catalog.load_table("${ns}.${table}")`,
    },
    {
      key: "spark",
      label: "Spark",
      text: `spark.sql.catalog.iolake=org.apache.iceberg.spark.SparkCatalog
spark.sql.catalog.iolake.type=rest
spark.sql.catalog.iolake.uri=${uri}
spark.sql.catalog.iolake.warehouse=${wh}

SELECT * FROM iolake.${ns}.${table}`,
    },
    {
      key: "trino",
      label: "Trino",
      text: `connector.name=iceberg
iceberg.catalog.type=rest
iceberg.rest-catalog.uri=${uri}
iceberg.rest-catalog.warehouse=${wh}`,
    },
    {
      key: "plain",
      label: "Details",
      text: `Catalog URI   ${uri}
Warehouse     ${wh}
Namespace     ${ns}
Table         ${table}`,
    },
  ];
}

function Overview({ r, wh, ns, onAll }: { r: IcebergLoadResult; wh: string; ns: string; onAll: () => void }) {
  const m = r.metadata;
  const cur = currentSnapshot(m);
  const t = totals(cur);
  const part = partitionText(m);
  const schema = currentSchema(m);
  const recent = snapshotsNewestFirst(m).slice(0, 5);
  const avg = t.files && t.bytes !== undefined ? t.bytes / t.files : undefined;

  return (
    <div className="flex flex-col gap-4">
      <TileGrid>
        <Tile
          label="Rows"
          value={cur ? fmtCount(t.rows) : "0"}
          sub={
            !cur
              ? "No snapshots yet"
              : t.deleteFiles
                ? `before ${plural(t.deleteFiles, "delete file")} apply`
                : "in the current snapshot"
          }
        />
        <Tile
          label="Size"
          value={cur ? fmtBytes(t.bytes) : fmtBytes(0)}
          sub={
            cur && t.files !== undefined
              ? `${plural(t.files, "data file")}${avg !== undefined ? ` · ${fmtBytes(avg)} average` : ""}`
              : undefined
          }
        />
        <Tile
          label="Last commit"
          value={<span title={fmtDate(m["last-updated-ms"])}>{ago(m["last-updated-ms"])}</span>}
          sub={cur ? `${opLabel(cur.summary?.operation)} · sequence ${cur["sequence-number"] ?? "—"}` : undefined}
        />
        <Tile label="Partitioned by" mono value={part.length ? part.join(", ") : "Not partitioned"} />
      </TileGrid>

      <div className="grid gap-4 items-start grid-cols-1 xl:grid-cols-2">
        <Section
          title="Schema"
          aside={schema ? `${plural(schema.fields.length, "column")} · schema ${schema["schema-id"] ?? 0}` : undefined}
        >
          <SchemaTable
            columns={(schema?.fields ?? []).map((f) => ({ name: f.name, type: typeText(f.type), required: f.required }))}
          />
        </Section>

        <Section
          title="Recent snapshots"
          aside={
            recent.length ? (
              <button type="button" onClick={onAll} className="text-accent hover:underline">
                All snapshots
              </button>
            ) : undefined
          }
        >
          {recent.length === 0 ? (
            <p className="px-4 pb-4 text-[12px] text-muted">No commits yet. The first append makes a snapshot.</p>
          ) : (
            <ol className="px-4 pb-3 flex flex-col">
              {recent.map((s) => {
                const isCur = s["snapshot-id"] === m["current-snapshot-id"];
                const change = snapshotChange(s);
                return (
                  <li key={s["snapshot-id"]} className="grid grid-cols-[14px_minmax(0,1fr)_auto] gap-2.5 py-2 items-start">
                    <span
                      aria-hidden
                      className={`w-[9px] h-[9px] mt-[5px] rounded-full border-2 border-accent ${isCur ? "bg-accent" : "bg-surface"}`}
                    />
                    <span className="min-w-0 text-[12.5px]">
                      <span className="font-medium text-text">{opLabel(s.summary?.operation)}</span>{" "}
                      {change && <span className="text-muted">{change}</span>}
                      <br />
                      <span className="font-mono text-[11px] text-muted [overflow-wrap:anywhere]">{s["snapshot-id"]}</span>
                      {isCur && (
                        <Badge kind="info" className="ml-2">
                          current
                        </Badge>
                      )}
                    </span>
                    <span className="font-mono text-[11.5px] text-muted whitespace-nowrap" title={fmtDate(s["timestamp-ms"])}>
                      {fmtTime(s["timestamp-ms"])}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>
      </div>

      <WhereItLives
        location={m.location}
        extra={[
          {
            label: "Warehouse",
            value: (
              <Link to={catalogHref({ kind: "warehouse", wh })} className="font-mono text-accent hover:underline">
                {wh}
              </Link>
            ),
          },
          {
            label: "Namespace",
            value: (
              <Link to={catalogHref({ kind: "namespace", wh, ns })} className="font-mono text-accent hover:underline">
                {ns}
              </Link>
            ),
          },
        ]}
      />
    </div>
  );
}

function SchemaTab({ r }: { r: IcebergLoadResult }) {
  const m = r.metadata;
  const schema = currentSchema(m);
  const ids = new Set(schema?.["identifier-field-ids"] ?? []);
  const sort = sortText(m);
  const part = partitionText(m);
  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Columns"
        aside={`schema ${schema?.["schema-id"] ?? 0}${(m.schemas?.length ?? 0) > 1 ? ` of ${m.schemas!.length} versions` : ""}`}
      >
        <DataTable head={[{ label: "ID", className: "w-16" }, { label: "Column" }, { label: "Type" }, { label: "Required" }, { label: "Doc" }]}>
          {(schema?.fields ?? []).map((f) => (
            <tr key={f.id}>
              <Td mono className="text-muted">
                {f.id}
              </Td>
              <Td strong mono>
                {f.name}
                {ids.has(f.id) && (
                  <Badge kind="neutral" className="ml-2">
                    identifier
                  </Badge>
                )}
              </Td>
              <Td mono className="[overflow-wrap:anywhere]">
                {typeText(f.type)}
              </Td>
              <Td>{f.required ? "Yes" : "No"}</Td>
              <Td className="text-muted">{f.doc || "—"}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <Section title="Partitioning" pad>
          <p className="font-mono text-[12px] text-text">{part.length ? part.join(", ") : "Not partitioned"}</p>
        </Section>
        <Section title="Sort order" pad>
          <p className="font-mono text-[12px] text-text">{sort.length ? sort.join(", ") : "Unsorted"}</p>
        </Section>
      </div>
    </div>
  );
}

function SnapshotsTab({ r }: { r: IcebergLoadResult }) {
  const m = r.metadata;
  const snaps = snapshotsNewestFirst(m);
  const refs = Object.entries(m.refs ?? {});
  return (
    <div className="flex flex-col gap-4">
      <Section title="Snapshots" aside={plural(snaps.length, "snapshot")}>
        <DataTable
          head={[
            { label: "Snapshot" },
            { label: "Operation" },
            { label: "Change" },
            { label: "Rows", right: true },
            { label: "Data files", right: true },
            { label: "Committed", right: true },
          ]}
          empty="No commits yet."
        >
          {snaps.map((s) => {
            const t = totals(s);
            return (
              <tr key={s["snapshot-id"]}>
                <Td mono strong className="whitespace-nowrap">
                  {s["snapshot-id"]}
                </Td>
                <Td className="whitespace-nowrap">
                  {opLabel(s.summary?.operation)}
                  {s["snapshot-id"] === m["current-snapshot-id"] && (
                    <Badge kind="info" className="ml-2">
                      current
                    </Badge>
                  )}
                </Td>
                <Td className="text-muted whitespace-nowrap">{snapshotChange(s) || "—"}</Td>
                <Td right>{fmtCount(t.rows)}</Td>
                <Td right className="whitespace-nowrap">
                  {fmtCount(t.files)} <span className="text-muted">· {fmtBytes(t.bytes)}</span>
                </Td>
                <Td right className="whitespace-nowrap">
                  <span title={fmtDate(s["timestamp-ms"])}>{fmtShort(s["timestamp-ms"])}</span>
                </Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>
      {refs.length > 0 && (
        <Section title="Branches and tags" aside={plural(refs.length, "ref")}>
          <DataTable head={[{ label: "Name" }, { label: "Type" }, { label: "Snapshot" }]}>
            {refs.map(([name, ref]) => (
              <tr key={name}>
                <Td mono strong>
                  {name}
                </Td>
                <Td>{ref.type === "tag" ? "Tag" : "Branch"}</Td>
                <Td mono>{ref["snapshot-id"]}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}

function PropertiesTab({ r }: { r: IcebergLoadResult }) {
  const m = r.metadata;
  const props = Object.entries(m.properties ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="flex flex-col gap-4">
      <Section title="Table">
        <KeyValues
          keyMono={false}
          head={["Field", "Value"]}
          rows={[
            ["Table UUID", m["table-uuid"]],
            ["Format version", String(m["format-version"])],
            ["Metadata file", r["metadata-location"] ?? "—"],
            ["Last sequence number", String(m["last-sequence-number"] ?? "—")],
            ["Last updated", fmtDate(m["last-updated-ms"])],
            ["Earlier metadata files", String(m["metadata-log"]?.length ?? 0)],
          ]}
        />
      </Section>
      <Section title="Properties" aside={plural(props.length, "property", "properties")}>
        <KeyValues rows={props} empty="No table properties set." />
      </Section>
    </div>
  );
}

function AccessTab({ wh, ns, table, onEdit }: { wh: string; ns: string; table: string; onEdit: () => void }) {
  const [pol, setPol] = useState<{ data?: EffectivePolicy; error?: string } | null>(null);
  const [filters, setFilters] = useState<{ data?: DataFilter[]; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    icebergExtra
      .effectivePolicy(wh, ns)
      .then((data) => alive && setPol({ data }))
      .catch((e: Error) => alive && setPol({ error: e.message }));
    icebergExtra
      .dataFilters(wh, ns, table)
      .then((d) => alive && setFilters({ data: d.filters ?? [] }))
      .catch((e: Error) => alive && setFilters({ error: e.message }));
    return () => {
      alive = false;
    };
  }, [wh, ns, table]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-text-2 max-w-3xl">
        A request is decided by the warehouse's catalog policy and the policy of each namespace level. Deny anywhere wins;
        an allow grants. With neither, only the warehouse's administrators get in.
      </p>
      {!pol && <Loading what="policies" />}
      {pol?.error && (
        <Banner kind="warn" title="The policies could not be read.">
          {pol.error}
        </Banner>
      )}
      {pol?.data && (
        <>
          <Section title="Catalog policy" aside={`warehouse ${wh}`}>
            <PolicyStatements policy={asPolicy(pol.data.catalog_policy)} empty="No catalog policy is set." />
          </Section>
          {pol.data.namespace_policies.map((p) => (
            <Section
              key={p.namespace}
              title={`Namespace policy · ${p.namespace}`}
              aside={
                p.namespace === ns ? (
                  <Button size="sm" icon={<Shield size={12} />} onClick={onEdit}>
                    Edit namespace policy
                  </Button>
                ) : undefined
              }
            >
              <PolicyStatements policy={asPolicy(p.policy)} empty="No policy on this namespace." />
            </Section>
          ))}
        </>
      )}

      <Section title="Data filters" aside="column and row filters per principal">
        {!filters && <Loading what="data filters" />}
        {filters?.error && <p className="px-4 pb-4 text-[12px] text-muted">{filters.error}</p>}
        {filters?.data && (
          <DataTable
            head={[{ label: "Filter" }, { label: "Principals" }, { label: "Columns" }, { label: "Row filter" }]}
            empty="No data filters on this table."
          >
            {filters.data.map((f) => (
              <tr key={f.filter_id}>
                <Td strong mono>
                  {f.filter_name || f.filter_id}
                </Td>
                <Td mono className="[overflow-wrap:anywhere]">
                  {f.principal_arns.join(", ")}
                </Td>
                <Td mono className="[overflow-wrap:anywhere]">
                  {f.allowed_columns.length
                    ? `only ${f.allowed_columns.join(", ")}`
                    : f.excluded_columns.length
                      ? `all but ${f.excluded_columns.join(", ")}`
                      : "all"}
                </Td>
                <Td mono className="[overflow-wrap:anywhere]">
                  {f.row_filter_expression || "—"}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}
