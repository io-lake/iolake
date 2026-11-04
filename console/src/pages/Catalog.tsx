import { useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Banner } from "../components/ui";
import { useCrumbs, type Crumb } from "../shell/crumbs";
import CatalogTree from "../components/catalog/CatalogTree";
import CatalogHome from "../components/catalog/CatalogHome";
import IcebergTable from "../components/catalog/IcebergTable";
import UnityTable from "../components/catalog/UnityTable";
import NewDialog, { type NewKind } from "../components/catalog/NewDialog";
import { CatalogView, NamespaceView, SchemaView, WarehouseView } from "../components/catalog/Containers";
import { useCatalogData } from "../components/catalog/useCatalogData";
import { catalogHref, selFromParams, selKey, type Sel } from "../components/catalog/model";

/// The lakehouse catalog: Iceberg warehouses and Unity Catalog in one
/// browser. The tree on the left lists every table; the right shows what is
/// selected, or an overview of the catalog when nothing is. The selection is
/// in the URL (`?wh=&ns=&t=` or `?uc=&s=&t=`), so a table can be linked.
export default function Catalog() {
  const [params] = useSearchParams();
  const sel = selFromParams(params);
  const navigate = useNavigate();
  const data = useCatalogData();
  const [creating, setCreating] = useState<NewKind | null>(null);

  useCrumbs(crumbsFor(sel));

  const go = (s: Sel) => navigate(catalogHref(s));
  const afterDelete = (s: Sel) => {
    data.reload();
    go(s);
  };

  const wh = "wh" in sel ? data.warehouses.find((w) => w.info.name === sel.wh) : undefined;
  const cat = "cat" in sel ? data.catalogs.find((c) => c.info.name === sel.cat) : undefined;

  let body: ReactNode;
  switch (sel.kind) {
    case "home":
      body = <CatalogHome data={data} onNew={setCreating} />;
      break;
    case "itable":
      body = (
        <IcebergTable
          key={selKey(sel)}
          wh={sel.wh}
          ns={sel.ns}
          table={sel.table}
          onDeleted={() => afterDelete({ kind: "namespace", wh: sel.wh, ns: sel.ns })}
        />
      );
      break;
    case "utable":
      body = (
        <UnityTable
          key={selKey(sel)}
          cat={sel.cat}
          schema={sel.schema}
          table={sel.table}
          onDeleted={() => afterDelete({ kind: "schema", cat: sel.cat, schema: sel.schema })}
        />
      );
      break;
    case "warehouse":
      body = wh ? (
        <WarehouseView key={selKey(sel)} node={wh} onNew={setCreating} onDeleted={() => afterDelete({ kind: "home" })} />
      ) : (
        <Missing loading={data.loading} what={`There is no warehouse ${sel.wh}.`} />
      );
      break;
    case "namespace": {
      const ns = wh?.namespaces?.find((n) => n.name === sel.ns);
      body = ns ? (
        <NamespaceView
          key={selKey(sel)}
          wh={sel.wh}
          node={ns}
          onDeleted={() => afterDelete({ kind: "warehouse", wh: sel.wh })}
        />
      ) : (
        <Missing loading={data.loading} what={`There is no namespace ${sel.ns} in warehouse ${sel.wh}.`} />
      );
      break;
    }
    case "catalog":
      body = cat ? (
        <CatalogView key={selKey(sel)} node={cat} onNew={setCreating} onDeleted={() => afterDelete({ kind: "home" })} />
      ) : (
        <Missing loading={data.loading} what={`There is no Unity catalog ${sel.cat}.`} />
      );
      break;
    case "schema": {
      const s = cat?.schemas?.find((x) => x.info.name === sel.schema);
      body = s ? (
        <SchemaView
          key={selKey(sel)}
          cat={sel.cat}
          node={s}
          onDeleted={() => afterDelete({ kind: "catalog", cat: sel.cat })}
        />
      ) : (
        <Missing loading={data.loading} what={`There is no schema ${sel.schema} in catalog ${sel.cat}.`} />
      );
      break;
    }
  }

  return (
    <div className="flex flex-col md:flex-row md:h-full">
      <CatalogTree data={data} sel={sel} onNew={() => setCreating("namespace")} />
      <div className="flex-1 min-w-0 md:overflow-y-auto">
        <div className="px-4 md:px-8 py-6 max-w-[1360px]">{body}</div>
      </div>

      {creating && (
        <NewDialog
          kind={creating}
          warehouseNames={data.warehouses.map((w) => w.info.name)}
          catalogNames={data.catalogs.map((c) => c.info.name)}
          defaultWarehouse={"wh" in sel ? sel.wh : undefined}
          defaultCatalog={"cat" in sel ? sel.cat : undefined}
          onClose={() => setCreating(null)}
          onCreated={(s) => {
            data.reload();
            go(s);
          }}
        />
      )}
    </div>
  );
}

function crumbsFor(sel: Sel): Crumb[] {
  switch (sel.kind) {
    case "home":
      return [];
    case "warehouse":
      return [{ label: sel.wh, mono: true }];
    case "namespace":
      return [{ label: sel.ns, mono: true }];
    case "itable":
      return [
        { label: sel.ns, mono: true, to: catalogHref({ kind: "namespace", wh: sel.wh, ns: sel.ns }) },
        { label: sel.table, mono: true },
      ];
    case "catalog":
      return [{ label: sel.cat, mono: true }];
    case "schema":
      return [{ label: `${sel.cat}.${sel.schema}`, mono: true }];
    case "utable":
      return [
        {
          label: `${sel.cat}.${sel.schema}`,
          mono: true,
          to: catalogHref({ kind: "schema", cat: sel.cat, schema: sel.schema }),
        },
        { label: sel.table, mono: true },
      ];
  }
}

function Missing({ loading, what }: { loading: boolean; what: string }) {
  if (loading) return null;
  return (
    <Banner kind="warn" title={what}>
      It may have been deleted or renamed.{" "}
      <Link to="/catalog" className="underline">
        Back to the catalog
      </Link>
    </Banner>
  );
}
