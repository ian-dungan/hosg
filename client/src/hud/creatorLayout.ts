// Where the creator's 3D preview and its control panel go on a screen (pure: unit-tested at phone and desktop sizes).
// Phones in portrait: the preview fills the top 40%, the tabs and controls the rest. Landscape: the preview left, the
// panel right. Desktop (1000 px and wider): the preview centred in the room the 420 px panel leaves.
export interface Rect { x: number; y: number; w: number; h: number }
export interface CreatorLayout { kind: 'portrait' | 'landscape' | 'desktop'; preview: Rect; panel: Rect }

/** The panel's width on desktop (the global constraint: a sheet is a panel of at most 420 px there). */
export const DESKTOP_PANEL_W = 420;

export function creatorLayout(w: number, h: number): CreatorLayout {
  if (w >= 1000) {
    return { kind: 'desktop', preview: { x: 0, y: 0, w: w - DESKTOP_PANEL_W, h }, panel: { x: w - DESKTOP_PANEL_W, y: 0, w: DESKTOP_PANEL_W, h } };
  }
  if (w > h) {
    const pw = Math.min(DESKTOP_PANEL_W + 60, Math.max(Math.round(w * 0.56), Math.min(w, 340)));
    return { kind: 'landscape', preview: { x: 0, y: 0, w: w - pw, h }, panel: { x: w - pw, y: 0, w: pw, h } };
  }
  const ph = Math.round(h * 0.4);
  return { kind: 'portrait', preview: { x: 0, y: 0, w, h: ph }, panel: { x: 0, y: ph, w, h: h - ph } };
}

/** The preview's own controls: the camera group (Face, Body, Full) and the history group (Undo, Redo, Compare). */
export type PreviewToolId = 'face' | 'body' | 'full' | 'undo' | 'redo' | 'compare';
export interface PreviewTool { id: PreviewToolId; icon: string; label: string; aria: string }
export const PREVIEW_TOOLS: readonly PreviewTool[] = [
  { id: 'face', icon: '', label: 'Face', aria: 'Camera: the face' },
  { id: 'body', icon: '', label: 'Body', aria: 'Camera: the upper body' },
  { id: 'full', icon: '', label: 'Full', aria: 'Camera: the whole adventurer' },
  { id: 'undo', icon: '↶', label: 'Undo', aria: 'Undo the last change' },
  { id: 'redo', icon: '↷', label: 'Redo', aria: 'Redo the change undone' },
  { id: 'compare', icon: '◐', label: 'Compare', aria: 'Compare with the look as it was' },
];
/** Sizes of the preview's controls (each at least 48 px each way). */
export const TOOL_CAM = { w: 60, h: 48 }, TOOL_HIST = { w: 56, h: 52 }, TOOL_GAP = 6, TOOL_MARGIN = 8;

/**
 * Where the preview's controls go inside a preview of `w`×`h` (pure: unit-tested at every phone size and desktop): the
 * camera group a column down the right edge, the history group a row along the top left (a column down the left edge
 * when the preview is too narrow for the row beside the camera column). Nothing overlaps; the groups stand apart.
 */
export function previewToolsLayout(w: number, _h: number): { camera: Rect[]; history: Rect[] } {
  const m = TOOL_MARGIN, g = TOOL_GAP;
  const cx = w - m - TOOL_CAM.w;
  const camera = [0, 1, 2].map((i) => ({ x: cx, y: m + i * (TOOL_CAM.h + g), w: TOOL_CAM.w, h: TOOL_CAM.h }));
  const rowW = 3 * TOOL_HIST.w + 2 * g;
  const row = m + rowW + 3 * g <= cx;
  const history = [0, 1, 2].map((i) => row
    ? { x: m + i * (TOOL_HIST.w + g), y: m, w: TOOL_HIST.w, h: TOOL_HIST.h }
    : { x: m, y: m + i * (TOOL_HIST.h + g), w: TOOL_HIST.w, h: TOOL_HIST.h });
  return { camera, history };
}
