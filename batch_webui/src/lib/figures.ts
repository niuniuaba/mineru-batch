const FIGURE_MARKER = /<!--\s*figure omitted:\s*([A-Za-z0-9_]+)\s*-->/g

/**
 * The engine omits figures and leaves an HTML comment. React-markdown drops comments, so
 * without this the preview would silently lose all trace of a figure. Render a visible,
 * honest note instead.
 */
export function renderFigureMarkers(markdown: string): string {
  return markdown.replace(FIGURE_MARKER, (_match, kind: string) => `> _[figure omitted: ${kind}]_`)
}
