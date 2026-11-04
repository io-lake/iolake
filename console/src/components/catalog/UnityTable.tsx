import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Filter, Plug, Shield, Trash2 } from "lucide-react";
import PageHeader from "../PageHeader";
import TableSecurityEditor from "../TableSecurityEditor";
import { Banner, Button, Chip, Tabs } from "../ui";
import { unity, type UnityTableInfo } from "../../api/client";
import { asPolicy, catalogHref, fmtDate, when, plural, titleCase, unityFormat, type PolicyDoc } from "./model";
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

export const UNITY_POLICY_EXAMPLE = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "OBIO": ["arn:objectio:iam::group/analysts"] },
      "Action": ["unity:GetTable"],
      "Resource": ["arn:obio:unity:::main/analytics/*"]
    }
  ]
}`;

type Info = UnityTableInfo & { comment?: string };
type Tab = "overview" | "schema" | "properties" | "access";

export default function UnityTable({
  cat,
  schema,
  table,
  onDeleted,
}: {
  cat: string;
  schema: string;
  table: string;
  onDeleted: () => void;
}) {
  const key = `${cat}.${schema}.${table}`;
  const [res, setRes] = useState<{ key: string; data?: Info; error?: string } | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<"connect" | "policy" | "security" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [policyTick, setPolicyTick] = useState(0);

  useEffect(() => {
    let alive = true;
    unity
      .getTable(cat, schema, table)
      .then((data) => alive && setRes({ key, data }))
      .catch((e: Error) => alive && setRes({ key, error: e.message }));
    return () => {
      alive = false;
    };
  }, [cat, schema, table, key]);

  const loaded = res?.key === key ? res : null;
  const t = loaded?.data;

  const remove = async () => {
    if (!confirm(`Delete table ${key}?`)) return;
    try {
      await unity.deleteTable(cat, schema, table);
      onDeleted();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <PageHeader
        mono
        title={
          <span className="inline-flex items-center gap-2 flex-wrap">
            {schema}.{table}
            {t && <Chip mono>{unityFormat(t.data_source_format)}</Chip>}
          </span>
        }
        description={t ? t.comment || `${titleCase(t.table_type)} table in Unity catalog ${cat}.` : undefined}
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

      {actionError && (
        <Banner kind="err" title={actionError} className="mb-4" />
      )}
      {!loaded && <Loading what="the table" />}
      {loaded?.error && (
        <Banner kind="err" title="The table could not be read.">
          {loaded.error}
        </Banner>
      )}

      {t && (
        <>
          <Tabs
            variant="underline"
            className="mb-5"
            value={tab}
            onChange={(k) => setTab(k as Tab)}
            items={[
              { key: "overview", label: "Overview" },
              { key: "schema", label: "Schema", count: t.columns?.length ?? 0 },
              { key: "properties", label: "Properties" },
              { key: "access", label: "Access" },
            ]}
          />

          {tab === "overview" && (
            <div className="flex flex-col gap-4">
              <TileGrid>
                <Tile label="Columns" value={(t.columns?.length ?? 0).toLocaleString()} />
                <Tile label="Table type" value={titleCase(t.table_type)} />
                <Tile
                  label="Last updated"
                  value={<span title={fmtDate(t.updated_at * 1000)}>{when(t.updated_at * 1000)}</span>}
                  sub={`created ${fmtDate(t.created_at * 1000)}`}
                />
                <Tile label="Owner" mono value={t.owner || "—"} />
              </TileGrid>
              <div className="grid gap-4 items-start grid-cols-1 xl:grid-cols-2">
                <Section title="Schema" aside={plural(t.columns?.length ?? 0, "column")}>
                  <SchemaTable columns={columnsOf(t)} />
                </Section>
                <Section
                  title="Row filter and column masks"
                  aside={
                    <button type="button" className="text-accent hover:underline" onClick={() => setDialog("security")}>
                      Edit
                    </button>
                  }
                >
                  <Governance t={t} />
                </Section>
              </div>
              <WhereItLives
                location={t.storage_location}
                extra={[
                  {
                    label: "Catalog",
                    value: (
                      <Link to={catalogHref({ kind: "catalog", cat })} className="font-mono text-accent hover:underline">
                        {cat}
                      </Link>
                    ),
                  },
                  {
                    label: "Schema",
                    value: (
                      <Link to={catalogHref({ kind: "schema", cat, schema })} className="font-mono text-accent hover:underline">
                        {schema}
                      </Link>
                    ),
                  },
                ]}
              />
            </div>
          )}

          {tab === "schema" && (
            <Section title="Columns" aside={plural(t.columns?.length ?? 0, "column")}>
              <DataTable
                head={[{ label: "#", className: "w-12" }, { label: "Column" }, { label: "Type" }, { label: "Required" }, { label: "Partition" }, { label: "Mask" }, { label: "Comment" }]}
                empty="This table has no columns recorded."
              >
                {[...(t.columns ?? [])]
                  .sort((a, b) => a.position - b.position)
                  .map((c) => (
                    <tr key={c.name}>
                      <Td mono className="text-muted">
                        {c.position}
                      </Td>
                      <Td mono strong>
                        {c.name}
                      </Td>
                      <Td mono>{c.type_text}</Td>
                      <Td>{c.nullable === false ? "Yes" : "No"}</Td>
                      <Td mono>{c.partition_index ?? "—"}</Td>
                      <Td mono className="[overflow-wrap:anywhere]">
                        {t.column_masks?.[c.name]?.function_full_name ?? "—"}
                      </Td>
                      <Td className="text-muted">{c.comment || "—"}</Td>
                    </tr>
                  ))}
              </DataTable>
            </Section>
          )}

          {tab === "properties" && (
            <div className="flex flex-col gap-4">
              <Section title="Table">
                <KeyValues
                  keyMono={false}
                  head={["Field", "Value"]}
                  rows={[
                    ["Full name", t.full_name || key],
                    ["Table ID", t.table_id || "—"],
                    ["Type", titleCase(t.table_type)],
                    ["Format", unityFormat(t.data_source_format)],
                    ["Storage location", t.storage_location || "—"],
                    ["Owner", t.owner || "—"],
                    ["Created", fmtDate(t.created_at * 1000)],
                    ["Updated", fmtDate(t.updated_at * 1000)],
                  ]}
                />
              </Section>
              <Section title="Properties">
                <KeyValues
                  rows={Object.entries(t.properties ?? {}).sort(([a], [b]) => a.localeCompare(b))}
                  empty="No table properties set."
                />
              </Section>
            </div>
          )}

          {tab === "access" && (
            <div className="flex flex-col gap-4">
              <p className="text-[12px] text-text-2 max-w-3xl">
                Unity evaluates the caller's IAM policies, then the catalog, schema and table policies. Deny at any level
                wins. Row filters and column masks are applied by the engine that reads the table.
              </p>
              <TablePolicy key={policyTick} cat={cat} schema={schema} table={table} onEdit={() => setDialog("policy")} />
              <Section
                title="Row filter and column masks"
                aside={
                  <Button size="sm" icon={<Filter size={12} />} onClick={() => setDialog("security")}>
                    Edit row filter and masks
                  </Button>
                }
              >
                <Governance t={t} />
              </Section>
              <p className="text-[12px] text-muted">
                Catalog and schema policies:{" "}
                <Link to={catalogHref({ kind: "schema", cat, schema })} className="text-accent hover:underline">
                  schema {schema}
                </Link>
                {" · "}
                <Link to={catalogHref({ kind: "catalog", cat })} className="text-accent hover:underline">
                  catalog {cat}
                </Link>
              </p>
            </div>
          )}
        </>
      )}

      {dialog === "connect" && (
        <ConnectionDialog
          title="Connection details"
          sub={<span className="font-mono">{key}</span>}
          snippets={unitySnippets(cat, schema, table, t?.storage_location)}
          note="Unity Catalog's REST API is wire-compatible with Databricks Unity Catalog. Requests are signed with SigV4 or carry an OIDC token."
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "policy" && (
        <PolicyDialog
          scope={`table ${key}`}
          note="A table policy applies on top of the catalog and schema policies. Deny at any level wins."
          example={UNITY_POLICY_EXAMPLE}
          load={async () => (await unity.getTablePolicy(cat, schema, table)).policy}
          save={(p) => unity.setTablePolicy(cat, schema, table, p)}
          onSaved={() => setPolicyTick((n) => n + 1)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "security" && (
        <TableSecurityEditor
          catalog={cat}
          schema={schema}
          table={table}
          onClose={() => setDialog(null)}
          onSaved={(info) => setRes({ key, data: info })}
        />
      )}
    </div>
  );
}

function columnsOf(t: UnityTableInfo) {
  return [...(t.columns ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ name: c.name, type: c.type_text, required: c.nullable === false }));
}

function Governance({ t }: { t: UnityTableInfo }) {
  const masks = Object.entries(t.column_masks ?? {});
  const rows: { what: string; fn: string; cols: string }[] = [];
  if (t.row_filter)
    rows.push({
      what: "Row filter",
      fn: t.row_filter.function_full_name,
      cols: (t.row_filter.input_column_names ?? []).join(", "),
    });
  for (const [col, m] of masks)
    rows.push({ what: `Mask on ${col}`, fn: m.function_full_name, cols: (m.using_column_names ?? []).join(", ") });
  return (
    <DataTable
      head={[{ label: "Binding" }, { label: "Function" }, { label: "Columns passed" }]}
      empty="No row filter or column masks. Every reader sees every row and column the policies allow."
    >
      {rows.map((r) => (
        <tr key={r.what}>
          <Td strong>{r.what}</Td>
          <Td mono className="[overflow-wrap:anywhere]">
            {r.fn}
          </Td>
          <Td mono>{r.cols || "—"}</Td>
        </tr>
      ))}
    </DataTable>
  );
}

function TablePolicy({
  cat,
  schema,
  table,
  onEdit,
}: {
  cat: string;
  schema: string;
  table: string;
  onEdit: () => void;
}) {
  const [p, setP] = useState<{ data?: PolicyDoc | null; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    unity
      .getTablePolicy(cat, schema, table)
      .then((r) => alive && setP({ data: asPolicy(r.policy) }))
      .catch((e: Error) => alive && setP({ error: e.message }));
    return () => {
      alive = false;
    };
  }, [cat, schema, table]);
  return (
    <Section
      title="Table policy"
      aside={
        <Button size="sm" icon={<Shield size={12} />} onClick={onEdit}>
          Edit table policy
        </Button>
      }
    >
      {!p && <Loading what="the policy" />}
      {p?.error && <p className="px-4 pb-4 text-[12px] text-muted">{p.error}</p>}
      {p && !p.error && <PolicyStatements policy={p.data ?? null} empty="No policy on this table." />}
    </Section>
  );
}

function unitySnippets(cat: string, schema: string, table: string, location?: string) {
  const origin = window.location.origin;
  const uc = `${origin}/api/2.1/unity-catalog`;
  return [
    {
      key: "plain",
      label: "Details",
      text: `Unity Catalog API   ${uc}
Full name           ${cat}.${schema}.${table}
Storage location    ${location ?? ""}`,
    },
    {
      key: "rest",
      label: "REST",
      text: `GET ${uc}/tables/${cat}.${schema}.${table}`,
    },
  ];
}
