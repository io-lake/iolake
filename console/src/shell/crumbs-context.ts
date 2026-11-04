import { createContext } from "react";

/// A breadcrumb step past the nav item: a bucket, a prefix, a table. `to`
/// makes it a link.
export interface Crumb {
  label: string;
  to?: string;
  /// Identifiers (bucket names, keys) are set in mono.
  mono?: boolean;
}

export interface CrumbsState {
  extra: Crumb[];
  setExtra: (c: Crumb[]) => void;
}

export const CrumbsContext = createContext<CrumbsState>({ extra: [], setExtra: () => {} });
