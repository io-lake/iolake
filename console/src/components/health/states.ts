import type { BadgeKind } from "../ui";
import type { DriveState, HostGroup } from "./data";

/// How each drive state is drawn and named. The border differs in style as
/// well as colour (solid, dashed, dotted), and every state has a word in the
/// legend, the tooltip and the tile's accessible name, so none is told by
/// colour alone.
export const DRIVE_STATES: Record<
  DriveState,
  { label: string; badge: BadgeKind; tile: string; text: string; fill: boolean }
> = {
  up: {
    label: "Up",
    badge: "ok",
    tile: "border border-border-strong bg-surface",
    text: "text-text-2",
    fill: true,
  },
  unhealthy: {
    label: "Disk unhealthy",
    badge: "warn",
    tile: "border-2 border-warn-dot bg-warn-soft",
    text: "text-warn",
    fill: false,
  },
  draining: {
    label: "Draining",
    badge: "warn",
    tile: "border-2 border-dashed border-warn-dot bg-surface",
    text: "text-warn",
    fill: true,
  },
  down: {
    label: "Down",
    badge: "err",
    tile: "border-2 border-err bg-err-soft",
    text: "text-err",
    fill: false,
  },
  out: {
    label: "Out",
    badge: "neutral",
    tile: "border-2 border-dotted border-border-strong bg-surface-2",
    text: "text-muted",
    fill: false,
  },
};

export const LEGEND_ORDER: DriveState[] = ["up", "unhealthy", "draining", "down", "out"];

/// A host's status in a word, most severe first.
export function hostStatus(h: HostGroup): { kind: BadgeKind; label: string } {
  const n = (s: DriveState) => h.drives.filter((d) => d.state === s).length;
  const down = n("down");
  if (h.drives.length > 0 && down === h.drives.length) return { kind: "err", label: "Down" };
  if (down) return { kind: "err", label: `${down} down` };
  const unhealthy = n("unhealthy");
  if (unhealthy) return { kind: "warn", label: `${unhealthy} unhealthy` };
  const draining = n("draining");
  if (draining) return { kind: "warn", label: `${draining} draining` };
  const out = n("out");
  if (out) return { kind: "neutral", label: `${out} out` };
  return { kind: "ok", label: "Healthy" };
}
