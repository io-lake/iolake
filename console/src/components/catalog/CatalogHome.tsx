import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import PageHeader from "../PageHeader";
import { Banner, Button } from "../ui";
import type { CatalogData } from "./useCatalogData";
import { catalogHref, fmtShort, plural } from "./model";
import { DataTable, KeyValues, Loading, Section, Td, Tile, TileGrid } from "./parts";
import type { NewKind } from "./NewDialog";

/// Nothing selected: what the catalog holds, and where to start.
export default function CatalogHome({ data, onNew }: { data: CatalogData; onNew: (k: NewKind) => void }) {
  const iceTables = data.warehouses.reduce(
    (n, w) => n + (w.namespaces ?? []).reduce((m, ns) => m + (ns.tables?.length ?? 0), 0),
    0,
  );
  const ucTables = data.catalogs.reduce(
    (n, c) => n + (c.schemas ?? []).reduce((m, s) => m + (s.tables?.length ?? 0), 0),
    0,
  );
  const origin = window.location.origin;

  return (
    <div>
      <PageHeader
        title="Catalog"
        description="Iceberg warehouses and Unity catalogs, the namespaces and schemas in them, and their tables."
        action={
          <>
            <Button icon={<Plus size={13} />} onClick={() => onNew("warehouse")}>
              New warehouse
            </Button>
            <Button icon={<Plus size={13} />} onClick={() => onNew("catalog")}>
              New Unity catalog
            </Button>
            <Button variant="primary" icon={<Plus size={13} />} onClick={() => onNew("namespace")}>
              New namespace
            </Button>
          </>
        }
      />

      {data.loading ? (
        <Loading what="the catalog" />
      ) : (
        <div className="flex flex-col gap-4">
          <TileGrid>
            <Tile label="Warehouses" value={data.warehouses.length.toLocaleString()} sub="Iceberg REST catalog" />
            <Tile label="Iceberg tables" value={iceTables.toLocaleString()} />
            <Tile label="Unity catalogs" value={data.catalogs.length.toLocaleString()} />
            <Tile label="Unity tables" value={ucTables.toLocaleString()} />
          </TileGrid>

          {data.warehousesError && (
            <Banner kind="err" title="The warehouses could not be listed.">
              {data.warehousesError}
            </Banner>
          )}
          <Section title="Iceberg warehouses" aside={plural(data.warehouses.length, "warehouse")}>
            <DataTable
              head={[
                { label: "Warehouse" },
                { label: "Namespaces", right: true },
                { label: "Tables", right: true },
                { label: "Bucket" },
                { label: "Tenant" },
                { label: "Created", right: true },
              ]}
              empty="No warehouses yet. A warehouse is an Iceberg catalog with a bucket for its data."
            >
              {data.warehouses.map((w) => {
                const nss = w.namespaces ?? [];
                return (
                  <tr key={w.info.name}>
                    <Td strong mono>
                      <Link to={catalogHref({ kind: "warehouse", wh: w.info.name })} className="hover:text-accent">
                        {w.info.name}
                      </Link>
                    </Td>
                    <Td right>{w.namespaces ? nss.length.toLocaleString() : "—"}</Td>
                    <Td right>{nss.reduce((n, x) => n + (x.tables?.length ?? 0), 0).toLocaleString()}</Td>
                    <Td mono>
                      <Link to={`/buckets/${encodeURIComponent(w.info.bucket)}`} className="text-accent hover:underline">
                        {w.info.bucket}
                      </Link>
                    </Td>
                    <Td mono>{w.info.tenant || "System"}</Td>
                    <Td right className="whitespace-nowrap">
                      {fmtShort(w.info.created_at * 1000)}
                    </Td>
                  </tr>
                );
              })}
            </DataTable>
          </Section>

          {data.catalogsError && (
            <Banner kind="err" title="The Unity catalogs could not be listed.">
              {data.catalogsError}
            </Banner>
          )}
          <Section title="Unity catalogs" aside={plural(data.catalogs.length, "catalog")}>
            <DataTable
              head={[
                { label: "Catalog" },
                { label: "Comment" },
                { label: "Schemas", right: true },
                { label: "Tables", right: true },
                { label: "Created", right: true },
              ]}
              empty="No Unity catalogs yet."
            >
              {data.catalogs.map((c) => {
                const schemas = c.schemas ?? [];
                return (
                  <tr key={c.info.name}>
                    <Td strong mono>
                      <Link to={catalogHref({ kind: "catalog", cat: c.info.name })} className="hover:text-accent">
                        {c.info.name}
                      </Link>
                    </Td>
                    <Td className="text-muted">{c.info.comment || "—"}</Td>
                    <Td right>{c.schemas ? schemas.length.toLocaleString() : "—"}</Td>
                    <Td right>{schemas.reduce((n, s) => n + (s.tables?.length ?? 0), 0).toLocaleString()}</Td>
                    <Td right className="whitespace-nowrap">
                      {fmtShort(c.info.created_at * 1000)}
                    </Td>
                  </tr>
                );
              })}
            </DataTable>
          </Section>

          <Section title="Connect an engine">
            <KeyValues
              keyMono={false}
              head={["Interface", "Address"]}
              rows={[
                ["Iceberg REST catalog", `${origin}/iceberg`],
                ["Unity Catalog API", `${origin}/api/2.1/unity-catalog`],
                [
                  "Delta Sharing",
                  <Link key="ds" to="/sharing" className="font-sans text-accent hover:underline">
                    {data.shares.length ? plural(data.shares.length, "share") : "Shares and recipients"}
                  </Link>,
                ],
              ]}
            />
          </Section>
        </div>
      )}
    </div>
  );
}
