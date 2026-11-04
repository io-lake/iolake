import { useCallback, useEffect, useState } from "react";
import {
  iceberg,
  unity,
  type UnityCatalogInfo,
  type UnitySchemaInfo,
  type UnityTableInfo,
} from "../../api/client";
import { shares as sharesApi, warehouses as warehousesApi, type Share, type WarehouseInfo } from "./model";

export interface NamespaceNode {
  name: string;
  /** Null until listed, or when listing failed (see `error`). */
  tables: string[] | null;
  error?: string;
}

export interface WarehouseNode {
  info: WarehouseInfo;
  namespaces: NamespaceNode[] | null;
  error?: string;
}

export interface SchemaNode {
  info: UnitySchemaInfo;
  tables: UnityTableInfo[] | null;
  error?: string;
}

export interface CatalogNode {
  info: UnityCatalogInfo;
  schemas: SchemaNode[] | null;
  error?: string;
}

export interface ShareNode {
  info: Share;
  tables: number | null;
}

export interface CatalogData {
  loading: boolean;
  warehouses: WarehouseNode[];
  warehousesError?: string;
  catalogs: CatalogNode[];
  catalogsError?: string;
  shares: ShareNode[];
}

/// Namespaces and schemas are listed in parallel, a few at a time: the tree
/// shows every table name (for counts and the filter), and a cluster with
/// many namespaces should not open with a burst of hundreds of requests.
const PARALLEL = 6;

async function mapLimited<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  return out;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function loadWarehouses(): Promise<{ nodes: WarehouseNode[]; error?: string }> {
  let whs: WarehouseInfo[];
  try {
    whs = (await warehousesApi.list()).warehouses ?? [];
  } catch (e) {
    return { nodes: [], error: msg(e) };
  }
  whs.sort((a, b) => a.name.localeCompare(b.name));
  const nodes = await mapLimited(whs, async (info): Promise<WarehouseNode> => {
    let names: string[];
    try {
      names = ((await iceberg.listNamespaces(info.name)).namespaces ?? []).map((n) => n.join("."));
    } catch (e) {
      return { info, namespaces: null, error: msg(e) };
    }
    names.sort();
    const namespaces = await mapLimited(names, async (name): Promise<NamespaceNode> => {
      try {
        const ids = (await iceberg.listTables(name, info.name)).identifiers ?? [];
        return { name, tables: ids.map((t) => t.name).sort() };
      } catch (e) {
        return { name, tables: null, error: msg(e) };
      }
    });
    return { info, namespaces };
  });
  return { nodes };
}

async function loadCatalogs(): Promise<{ nodes: CatalogNode[]; error?: string }> {
  let cats: UnityCatalogInfo[];
  try {
    cats = (await unity.listCatalogs()).catalogs ?? [];
  } catch (e) {
    return { nodes: [], error: msg(e) };
  }
  cats.sort((a, b) => a.name.localeCompare(b.name));
  const nodes = await mapLimited(cats, async (info): Promise<CatalogNode> => {
    let schemas: UnitySchemaInfo[];
    try {
      schemas = (await unity.listSchemas(info.name)).schemas ?? [];
    } catch (e) {
      return { info, schemas: null, error: msg(e) };
    }
    schemas.sort((a, b) => a.name.localeCompare(b.name));
    const nodes = await mapLimited(schemas, async (s): Promise<SchemaNode> => {
      try {
        const ts = (await unity.listTables(info.name, s.name)).tables ?? [];
        return { info: s, tables: ts.sort((a, b) => a.name.localeCompare(b.name)) };
      } catch (e) {
        return { info: s, tables: null, error: msg(e) };
      }
    });
    return { info, schemas: nodes };
  });
  return { nodes };
}

async function loadShares(): Promise<ShareNode[]> {
  try {
    const all = (await sharesApi.list()).shares ?? [];
    return await mapLimited(all, async (info) => {
      try {
        return { info, tables: ((await sharesApi.tables(info.name)).tables ?? []).length };
      } catch {
        return { info, tables: null };
      }
    });
  } catch {
    // Delta Sharing is optional in the tree; its own page reports failures.
    return [];
  }
}

export function useCatalogData(): CatalogData & { reload: () => void } {
  const [data, setData] = useState<CatalogData>({
    loading: true,
    warehouses: [],
    catalogs: [],
    shares: [],
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([loadWarehouses(), loadCatalogs(), loadShares()]).then(([w, c, s]) => {
      if (!alive) return;
      setData({
        loading: false,
        warehouses: w.nodes,
        warehousesError: w.error,
        catalogs: c.nodes,
        catalogsError: c.error,
        shares: s,
      });
    });
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...data, reload };
}
