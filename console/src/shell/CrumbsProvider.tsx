import { useState, type ReactNode } from "react";
import { CrumbsContext, type Crumb } from "./crumbs-context";

export default function CrumbsProvider({ children }: { children: ReactNode }) {
  const [extra, setExtra] = useState<Crumb[]>([]);
  return <CrumbsContext.Provider value={{ extra, setExtra }}>{children}</CrumbsContext.Provider>;
}
