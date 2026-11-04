import { useContext, useEffect } from "react";
import { CrumbsContext, type Crumb } from "./crumbs-context";

export type { Crumb };

/// The steps a page adds after its nav item, for as long as it is shown. The
/// bar updates whenever the labels change.
export function useCrumbs(crumbs: Crumb[]) {
  const { setExtra } = useContext(CrumbsContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    setExtra(JSON.parse(key) as Crumb[]);
    return () => setExtra([]);
  }, [key, setExtra]);
}

export function useExtraCrumbs(): Crumb[] {
  return useContext(CrumbsContext).extra;
}
