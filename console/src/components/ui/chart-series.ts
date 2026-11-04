/// Categorical series colours, assigned in a fixed hue order and never cycled
/// (chart-palette.json rules). Callers pass the series index so a series keeps
/// its colour when others are toggled off — assigning by position in whatever
/// happens to be visible is how a chart silently changes meaning.
///
/// The colour is a CSS variable (`--oio-chart-N`, console-tokens.css), so a
/// chart follows the theme without re-rendering.
export function seriesColor(index: number): string {
  return `var(--oio-chart-${(index % MAX_SERIES) + 1})`;
}

/// Max series per the same rules; beyond this a chart should switch to small
/// multiples or fold the tail into "Other".
export const MAX_SERIES = 4;
