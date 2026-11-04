import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Plus, Shield, Trash2 } from "lucide-react";
import PageHeader from "../PageHeader";
import { Banner, Button, Chip, Tabs } from "../ui";
import {
  iceberg,
  unity,
  type UnityFunctionInfo,
  type UnityModelInfo,
  type UnityTableInfo,
  type UnityVolumeInfo,
} from "../../api/client";
import type { CatalogNode, NamespaceNode, SchemaNode, WarehouseNode } from "./useCatalogData";
import {
  ago,
  asPolicy,
  catalogHref,
  fmtDate,
  fmtShort,
  icebergExtra,
  plural,
  snapshotsNewestFirst,
  titleCase,
  unityFormat,
  warehouses,
  when,
} from "./model";
import { PolicyDialog } from "./Dialogs";
import { DataTable, KeyValues, Loading, PolicyStatements, Section, Td, Tile, TileGrid, WhereItLives } from "./parts";
import { UNITY_POLICY_EXAMPLE } from "./UnityTable";
import type { NewKind } from "./NewDialog";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(msg(e));
    }
  };
  const banner = error ? <Banner kind="err" title={error} className="mb-4" /> : null;
  return { run, banner };
}

const advancedHref = (cat: string, schema?: string) =>
  `/unity?catalog=${encodeURIComponent(cat)}${schema ? `&schema=${encodeURIComponent(schema)}` : ""}`;

// ---------------------------------------------------------------------------
// Iceberg
// ---------------------------------------------------------------------------

export function WarehouseView({
  node,
  onNew,
  onDeleted,
}: {
  node: WarehouseNode;
  onNew: (k: NewKind) => void;
  onDeleted: () => void;
}) {
  const { run, banner } = useAction();
  const w = node.info;
  const nss = node.namespaces ?? [];
  const tables = nss.reduce((n, x) => n + (x.tables?.length ?? 0), 0);
  const remove = () =>
    run(async () => {
      if (!confirm(`Delete warehouse ${w.name} and its bucket ${w.bucket}? The bucket must be empty.`)) return;
      await warehouses.remove(w.name);
      onDeleted();
    });
  return (
    <div>
      <PageHeader
        mono
        title={
          <span className="inline-flex items-center gap-2 flex-wrap">
            {w.name}
            <Chip mono>Iceberg warehouse</Chip>
          </span>
        }
        description="An Iceberg REST catalog with its own namespaces and tables, and a bucket for their data."
        action={
          <>
            <Button icon={<Trash2 size={13} />} onClick={() => void remove()}>
              Delete warehouse
            </Button>
            <Button variant="primary" icon={<Plus size={13} />} onClick={() => onNew("namespace")}>
              New namespace
            </Button>
          </>
        }
      />
      {banner}
      {node.error && <Banner kind="err" title="The namespaces could not be listed." className="mb-4">{node.error}</Banner>}
      <div className="flex flex-col gap-4">
        <TileGrid>
          <Tile label="Namespaces" value={nss.length.toLocaleString()} />
          <Tile label="Tables" value={tables.toLocaleString()} />
          <Tile label="Tenant" mono value={w.tenant || "System"} />
          <Tile label="Created" value={<span title={fmtDate(w.created_at * 1000)}>{when(w.created_at * 1000)}</span>} />
        </TileGrid>
        <Section title="Namespaces" aside={plural(nss.length, "namespace")}>
          <DataTable head={[{ label: "Namespace" }, { label: "Tables", right: true }]} empty="No namespaces yet. Create one, then point an engine at the warehouse to add tables.">
            {nss.map((n) => (
              <tr key={n.name}>
                <Td strong mono>
                  <Link to={catalogHref({ kind: "namespace", wh: w.name, ns: n.name })} className="hover:text-accent">
                    {n.name}
                  </Link>
                </Td>
                <Td right>{n.tables ? n.tables.length.toLocaleString() : "—"}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
        <WhereItLives location={w.location} />
      </div>
    </div>
  );
}

interface TableFacts {
  snapshots: number;
  lastUpdatedMs: number;
  op?: string;
}
/// The list endpoint returns names only; facts per table come from a bounded
/// fan-out of metadata reads.
const METADATA_FANOUT = 25;

export function NamespaceView({
  wh,
  node,
  onDeleted,
}: {
  wh: string;
  node: NamespaceNode;
  onDeleted: () => void;
}) {
  const { run, banner } = useAction();
  const ns = node.name;
  const [props, setProps] = useState<{ key: string; data?: Record<string, string>; error?: string } | null>(null);
  const [facts, setFacts] = useState<Record<string, TableFacts>>({});
  const [policyOpen, setPolicyOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const key = `${wh}/${ns}/${tick}`;
  const tables = node.tables ?? [];
  const tablesKey = tables.join(",");

  useEffect(() => {
    let alive = true;
    iceberg
      .getNamespace(ns, wh)
      .then((r) => alive && setProps({ key, data: r.properties ?? {} }))
      .catch((e: Error) => alive && setProps({ key, error: e.message }));
    return () => {
      alive = false;
    };
  }, [wh, ns, key]);

  useEffect(() => {
    let alive = true;
    const names = tablesKey ? tablesKey.split(",").slice(0, METADATA_FANOUT) : [];
    Promise.all(
      names.map(async (t) => {
        try {
          const m = (await icebergExtra.loadTable(wh, ns, t)).metadata;
          const latest = snapshotsNewestFirst(m)[0];
          return [t, { snapshots: m.snapshots?.length ?? 0, lastUpdatedMs: m["last-updated-ms"], op: latest?.summary?.operation }] as const;
        } catch {
          return null;
        }
      }),
    ).then((rows) => {
      if (!alive) return;
      const got: Record<string, TableFacts> = {};
      for (const r of rows) if (r) got[r[0]] = r[1];
      setFacts(got);
    });
    return () => {
      alive = false;
    };
  }, [wh, ns, tablesKey]);

  const p = props?.key === key ? props : null;
  const policy = asPolicy(p?.data?.__policy);
  const visibleProps = Object.entries(p?.data ?? {})
    .filter(([k]) => !k.startsWith("__"))
    .sort(([a], [b]) => a.localeCompare(b));

  const remove = () =>
    run(async () => {
      if (!confirm(`Delete namespace ${ns}? It must have no tables.`)) return;
      await iceberg.deleteNamespace(ns, wh);
      onDeleted();
    });

  return (
    <div>
      <PageHeader
        mono
        title={
          <span className="inline-flex items-center gap-2 flex-wrap">
            {ns}
            <Chip mono>Iceberg namespace</Chip>
          </span>
        }
        description={p?.data?.description || `Namespace in warehouse ${wh}.`}
        action={
          <>
            <Button icon={<Trash2 size={13} />} onClick={() => void remove()}>
              Delete namespace
            </Button>
            <Button variant="primary" icon={<Shield size={13} />} onClick={() => setPolicyOpen(true)}>
              Grant access
            </Button>
          </>
        }
      />
      {banner}
      <div className="flex flex-col gap-4">
        <Section
          title="Tables"
          aside={
            tables.length > METADATA_FANOUT
              ? `${plural(tables.length, "table")} · snapshots read for the first ${METADATA_FANOUT}`
              : plural(tables.length, "table")
          }
        >
          <DataTable
            head={[{ label: "Table" }, { label: "Snapshots", right: true }, { label: "Last operation" }, { label: "Last commit", right: true }]}
            empty="No tables yet. Engines create them through the Iceberg REST catalog."
          >
            {tables.map((t) => {
              const f = facts[t];
              return (
                <tr key={t}>
                  <Td strong mono>
                    <Link to={catalogHref({ kind: "itable", wh, ns, table: t })} className="hover:text-accent">
                      {t}
                    </Link>
                  </Td>
                  <Td right>{f ? f.snapshots.toLocaleString() : "—"}</Td>
                  <Td>{f?.op ? titleCase(f.op) : "—"}</Td>
                  <Td right>{f ? ago(f.lastUpdatedMs) : "—"}</Td>
                </tr>
              );
            })}
          </DataTable>
        </Section>

        <>
          <Section
            title="Namespace policy"
            aside={
              <button type="button" className="text-accent hover:underline" onClick={() => setPolicyOpen(true)}>
                Edit
              </button>
            }
          >
            {!p && <Loading what="the namespace" />}
            {p?.error && <p className="px-4 pb-4 text-[12px] text-err">{p.error}</p>}
            {p?.data && (
              <PolicyStatements policy={policy} empty="No namespace policy. The warehouse's catalog policy applies." />
            )}
          </Section>
          <Section title="Properties">
            <KeyValues rows={visibleProps} empty="No properties set." />
          </Section>
        </>
      </div>

      {policyOpen && (
        <PolicyDialog
          scope={`namespace ${ns} · warehouse ${wh}`}
          note={
            <>
              A namespace policy applies to every table in <span className="font-mono">{ns}</span>. Deny anywhere wins;
              with no statement naming a caller, only the warehouse's administrators get in.
            </>
          }
          example={`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "OBIO": ["arn:objectio:iam::user/alice"] },
      "Action": ["iceberg:LoadTable", "iceberg:ListTables"],
      "Resource": ["arn:obio:iceberg:::${ns}/*"]
    }
  ]
}`}
          load={async () => asPolicy((await iceberg.getNamespace(ns, wh)).properties?.__policy) ?? {}}
          save={(pol) => icebergExtra.setNamespacePolicy(wh, ns, pol)}
          onSaved={() => setTick((t) => t + 1)}
          onClose={() => setPolicyOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unity
// ---------------------------------------------------------------------------

export function CatalogView({
  node,
  onNew,
  onDeleted,
}: {
  node: CatalogNode;
  onNew: (k: NewKind) => void;
  onDeleted: () => void;
}) {
  const { run, banner } = useAction();
  const c = node.info as CatalogNode["info"] & { storage_root?: string };
  const schemas = node.schemas ?? [];
  const tables = schemas.reduce((n, s) => n + (s.tables?.length ?? 0), 0);
  const [policyOpen, setPolicyOpen] = useState(false);
  const remove = () =>
    run(async () => {
      if (
        !confirm(
          `Delete catalog ${c.name}? This deletes every schema and table in it, and its bucket unity-${c.name}.`,
        )
      )
        return;
      await unity.deleteCatalog(c.name, true);
      onDeleted();
    });
  return (
    <div>
      <PageHeader
        mono
        title={
          <span className="inline-flex items-center gap-2 flex-wrap">
            {c.name}
            <Chip mono>Unity catalog</Chip>
          </span>
        }
        description={c.comment || "A Unity catalog: schemas, and the tables, functions, volumes and models in them."}
        action={
          <>
            <Link
              to={advancedHref(c.name)}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium rounded-control border border-border-strong bg-surface text-text hover:bg-surface-2"
            >
              <ExternalLink size={13} /> Advanced view
            </Link>
            <Button icon={<Shield size={13} />} onClick={() => setPolicyOpen(true)}>
              Catalog policy
            </Button>
            <Button icon={<Trash2 size={13} />} onClick={() => void remove()}>
              Delete catalog
            </Button>
            <Button variant="primary" icon={<Plus size={13} />} onClick={() => onNew("schema")}>
              New schema
            </Button>
          </>
        }
      />
      {banner}
      {node.error && <Banner kind="err" title="The schemas could not be listed." className="mb-4">{node.error}</Banner>}
      <div className="flex flex-col gap-4">
        <TileGrid>
          <Tile label="Schemas" value={schemas.length.toLocaleString()} />
          <Tile label="Tables" value={tables.toLocaleString()} />
          <Tile label="Owner" mono value={c.owner || "—"} />
          <Tile label="Created" value={<span title={fmtDate(c.created_at * 1000)}>{when(c.created_at * 1000)}</span>} />
        </TileGrid>
        <Section title="Schemas" aside={plural(schemas.length, "schema")}>
          <DataTable head={[{ label: "Schema" }, { label: "Comment" }, { label: "Tables", right: true }, { label: "Created", right: true }]} empty="No schemas yet.">
            {schemas.map((s) => (
              <tr key={s.info.name}>
                <Td strong mono>
                  <Link to={catalogHref({ kind: "schema", cat: c.name, schema: s.info.name })} className="hover:text-accent">
                    {s.info.name}
                  </Link>
                </Td>
                <Td className="text-muted">{s.info.comment || "—"}</Td>
                <Td right>{s.tables ? s.tables.length.toLocaleString() : "—"}</Td>
                <Td right className="whitespace-nowrap">
                  {fmtShort(s.info.created_at * 1000)}
                </Td>
              </tr>
            ))}
          </DataTable>
        </Section>
        <WhereItLives location={c.storage_root ?? `s3://unity-${c.name}`} />
      </div>
      {policyOpen && (
        <PolicyDialog
          scope={`catalog ${c.name}`}
          note="A catalog policy applies to every schema and table in it. Deny at any level wins."
          example={UNITY_POLICY_EXAMPLE}
          load={async () => (await unity.getCatalogPolicy(c.name)).policy}
          save={(p) => unity.setCatalogPolicy(c.name, p)}
          onClose={() => setPolicyOpen(false)}
        />
      )}
    </div>
  );
}

type SchemaTab = "tables" | "functions" | "volumes" | "models";

export function SchemaView({ cat, node, onDeleted }: { cat: string; node: SchemaNode; onDeleted: () => void }) {
  const { run, banner } = useAction();
  const s = node.info;
  const [tab, setTab] = useState<SchemaTab>("tables");
  const [policyOpen, setPolicyOpen] = useState(false);
  const key = `${cat}.${s.name}`;
  const [ents, setEnts] = useState<{
    key: string;
    functions: UnityFunctionInfo[] | null;
    volumes: UnityVolumeInfo[] | null;
    models: UnityModelInfo[] | null;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([unity.listFunctions(cat, s.name), unity.listVolumes(cat, s.name), unity.listModels(cat, s.name)]).then(
      ([f, v, m]) => {
        if (!alive) return;
        setEnts({
          key,
          functions: f.status === "fulfilled" ? (f.value.functions ?? []) : null,
          volumes: v.status === "fulfilled" ? (v.value.volumes ?? []) : null,
          models: m.status === "fulfilled" ? (m.value.registered_models ?? []) : null,
        });
      },
    );
    return () => {
      alive = false;
    };
  }, [cat, s.name, key]);

  const e = ents?.key === key ? ents : null;
  const tables: UnityTableInfo[] = node.tables ?? [];
  const remove = () =>
    run(async () => {
      if (!confirm(`Delete schema ${key}?`)) return;
      await unity.deleteSchema(cat, s.name);
      onDeleted();
    });

  return (
    <div>
      <PageHeader
        mono
        title={
          <span className="inline-flex items-center gap-2 flex-wrap">
            {key}
            <Chip mono>Unity schema</Chip>
          </span>
        }
        description={s.comment || "Tables, functions, volumes and models under one schema."}
        action={
          <>
            <Link
              to={advancedHref(cat, s.name)}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium rounded-control border border-border-strong bg-surface text-text hover:bg-surface-2"
            >
              <ExternalLink size={13} /> Advanced view
            </Link>
            <Button icon={<Trash2 size={13} />} onClick={() => void remove()}>
              Delete schema
            </Button>
            <Button variant="primary" icon={<Shield size={13} />} onClick={() => setPolicyOpen(true)}>
              Grant access
            </Button>
          </>
        }
      />
      {banner}
      <Tabs
        variant="underline"
        className="mb-5"
        value={tab}
        onChange={(k) => setTab(k as SchemaTab)}
        items={[
          { key: "tables", label: "Tables", count: tables.length },
          { key: "functions", label: "Functions", count: e?.functions?.length },
          { key: "volumes", label: "Volumes", count: e?.volumes?.length },
          { key: "models", label: "Models", count: e?.models?.length },
        ]}
      />
      {tab !== "tables" && (
        <p className="text-[12px] text-muted mb-3">
          Create, edit and delete {tab} in the{" "}
          <Link to={advancedHref(cat, s.name)} className="text-accent hover:underline">
            Unity Catalog advanced view
          </Link>
          .
        </p>
      )}
      {tab === "tables" && (
        <Section title="Tables" aside={plural(tables.length, "table")}>
          <DataTable
            head={[{ label: "Table" }, { label: "Format" }, { label: "Type" }, { label: "Columns", right: true }, { label: "Governance" }, { label: "Updated", right: true }]}
            empty={
              <>
                No tables yet.{" "}
                <Link to={advancedHref(cat, s.name)} className="text-accent hover:underline">
                  Create one in the advanced view
                </Link>
                .
              </>
            }
          >
            {tables.map((t) => {
              const masks = Object.keys(t.column_masks ?? {}).length;
              const gov = [t.row_filter ? "row filter" : "", masks ? plural(masks, "mask") : ""].filter(Boolean).join(" · ");
              return (
                <tr key={t.name}>
                  <Td strong mono>
                    <Link to={catalogHref({ kind: "utable", cat, schema: s.name, table: t.name })} className="hover:text-accent">
                      {t.name}
                    </Link>
                  </Td>
                  <Td>{unityFormat(t.data_source_format)}</Td>
                  <Td>{titleCase(t.table_type)}</Td>
                  <Td right>{(t.columns?.length ?? 0).toLocaleString()}</Td>
                  <Td className="text-muted">{gov || "—"}</Td>
                  <Td right className="whitespace-nowrap">
                    {fmtShort(t.updated_at * 1000)}
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        </Section>
      )}
      {tab !== "tables" && !e && <Loading what={tab} />}
      {tab === "functions" && e && (
        <Section title="Functions">
          {e.functions === null ? (
            <p className="px-4 pb-4 text-[12px] text-err">The functions could not be listed.</p>
          ) : (
            <DataTable head={[{ label: "Function" }, { label: "Body" }, { label: "Returns" }, { label: "Comment" }]} empty="No functions in this schema.">
              {e.functions.map((f) => (
                <tr key={f.name}>
                  <Td strong mono>
                    {f.name}
                  </Td>
                  <Td>{f.routine_body === "EXTERNAL" ? `External · ${f.external_language ?? ""}` : "SQL"}</Td>
                  <Td mono>{f.full_data_type || f.data_type || "—"}</Td>
                  <Td className="text-muted">{f.comment || "—"}</Td>
                </tr>
              ))}
            </DataTable>
          )}
        </Section>
      )}
      {tab === "volumes" && e && (
        <Section title="Volumes">
          {e.volumes === null ? (
            <p className="px-4 pb-4 text-[12px] text-err">The volumes could not be listed.</p>
          ) : (
            <DataTable head={[{ label: "Volume" }, { label: "Type" }, { label: "Location" }, { label: "Comment" }]} empty="No volumes in this schema.">
              {e.volumes.map((v) => (
                <tr key={v.name}>
                  <Td strong mono>
                    {v.name}
                  </Td>
                  <Td>{titleCase(v.volume_type)}</Td>
                  <Td mono className="[overflow-wrap:anywhere]">
                    {v.storage_location}
                  </Td>
                  <Td className="text-muted">{v.comment || "—"}</Td>
                </tr>
              ))}
            </DataTable>
          )}
        </Section>
      )}
      {tab === "models" && e && (
        <Section title="Models">
          {e.models === null ? (
            <p className="px-4 pb-4 text-[12px] text-err">The models could not be listed.</p>
          ) : (
            <DataTable head={[{ label: "Model" }, { label: "Location" }, { label: "Comment" }, { label: "Updated", right: true }]} empty="No models in this schema.">
              {e.models.map((m) => (
                <tr key={m.name}>
                  <Td strong mono>
                    {m.name}
                  </Td>
                  <Td mono className="[overflow-wrap:anywhere]">
                    {m.storage_location}
                  </Td>
                  <Td className="text-muted">{m.comment || "—"}</Td>
                  <Td right className="whitespace-nowrap">
                    {fmtShort(m.updated_at * 1000)}
                  </Td>
                </tr>
              ))}
            </DataTable>
          )}
        </Section>
      )}
      {policyOpen && (
        <PolicyDialog
          scope={`schema ${key}`}
          note="A schema policy applies to every table, function, volume and model in it. Deny at any level wins."
          example={UNITY_POLICY_EXAMPLE}
          load={async () => (await unity.getSchemaPolicy(cat, s.name)).policy}
          save={(p) => unity.setSchemaPolicy(cat, s.name, p)}
          onClose={() => setPolicyOpen(false)}
        />
      )}
    </div>
  );
}
