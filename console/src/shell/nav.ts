import {
  LayoutGrid,
  Archive,
  Table2,
  Share2,
  ShieldCheck,
  Server,
  Layers,
  Activity,
  Building2,
  Users,
  FileText,
  LogIn,
  Lock,
  type LucideIcon,
} from "lucide-react";

/// The console's navigation, grouped by the job a person comes to do. The
/// sidebar, the breadcrumb and the jump-to search all read this one list, so a
/// page is named the same way everywhere.
export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /// System admins only: hidden in a tenant's console.
  adminOnly?: boolean;
  /// Other paths that belong to this item (its detail pages), so it stays
  /// highlighted on them.
  match?: string[];
  /// Words the jump-to search also matches.
  keywords?: string;
}

export interface NavSection {
  /// No title: the item stands alone at the top.
  title?: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  { items: [{ to: "/", label: "Overview", icon: LayoutGrid, keywords: "dashboard home" }] },
  {
    title: "Storage",
    items: [
      {
        to: "/buckets",
        label: "Buckets",
        icon: Archive,
        match: ["/buckets/", "/objects"],
        keywords: "objects browser s3 files",
      },
    ],
  },
  {
    title: "Lakehouse",
    items: [
      {
        to: "/catalog",
        label: "Catalog",
        icon: Table2,
        match: ["/catalog/", "/iceberg", "/unity"],
        keywords: "iceberg unity tables namespaces warehouses",
      },
      { to: "/sharing", label: "Sharing", icon: Share2, keywords: "delta sharing shares recipients" },
    ],
  },
  {
    title: "Cluster",
    items: [
      {
        to: "/cluster/health",
        label: "Health",
        icon: ShieldCheck,
        adminOnly: true,
        keywords: "protection repair placement groups scrub",
      },
      {
        to: "/cluster/drives",
        label: "Nodes and drives",
        icon: Server,
        adminOnly: true,
        match: ["/cluster/topology", "/cluster/balancing"],
        keywords: "hosts osds disks topology racks balancing",
      },
      {
        to: "/cluster/pools",
        label: "Pools and placement",
        icon: Layers,
        adminOnly: true,
        match: ["/cluster/pools/"],
        keywords: "erasure coding replication pgs",
      },
      {
        to: "/monitoring",
        label: "Performance",
        icon: Activity,
        adminOnly: true,
        keywords: "monitoring metrics latency throughput",
      },
    ],
  },
  {
    title: "Access",
    items: [
      { to: "/tenants", label: "Tenants", icon: Building2, adminOnly: true, keywords: "quota" },
      { to: "/users", label: "Users and keys", icon: Users, keywords: "access keys groups iam service accounts" },
      { to: "/policies", label: "Policies", icon: FileText, keywords: "iam permissions" },
      { to: "/identity", label: "Sign-in providers", icon: LogIn, keywords: "oidc sso identity" },
    ],
  },
  {
    title: "Security",
    items: [{ to: "/encryption", label: "Encryption", icon: Lock, adminOnly: true, keywords: "kms sse keys" }],
  },
];

/// The sections a person sees: a tenant's console leaves out the admin pages,
/// and a section left empty.
export function visibleNav(isSystemAdmin: boolean): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => isSystemAdmin || !i.adminOnly) })).filter(
    (s) => s.items.length > 0,
  );
}

/// Whether `pathname` is this item's page or one of its detail pages.
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.to === "/") return pathname === "/";
  if (pathname === item.to || pathname.startsWith(item.to + "/")) return true;
  return (item.match ?? []).some((m) => pathname === m || pathname.startsWith(m));
}

/// The section and item a path belongs to, for the breadcrumb.
export function locate(pathname: string): { section?: string; item?: NavItem } {
  for (const s of NAV) {
    for (const i of s.items) {
      if (isActive(i, pathname)) return { section: s.title, item: i };
    }
  }
  return {};
}
