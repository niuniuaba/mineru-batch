import { renderFigureMarkers } from './figures'

export type PreviewState = { text: string; error: null } | { text: null; error: string }

/**
 * Load one converted document for the preview pane, turning a failed fetch into a
 * message rather than a rejection the caller has to catch. Kept free of React so the
 * failure path can be tested directly.
 */
export async function loadPreview(
  fetchContent: (path: string) => Promise<string>,
  path: string,
): Promise<PreviewState> {
  try {
    return { text: renderFigureMarkers(await fetchContent(path)), error: null }
  } catch (failure) {
    return { text: null, error: failure instanceof Error ? failure.message : String(failure) }
  }
}
