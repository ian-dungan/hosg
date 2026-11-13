// Where the creator's 3D preview and its control panel go on a screen (pure: unit-tested at phone and desktop sizes).
// Phones in portrait: the preview fills the top 45%, the tabs and controls the rest. Landscape: the preview left, the
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
  const ph = Math.round(h * 0.45);
  return { kind: 'portrait', preview: { x: 0, y: 0, w, h: ph }, panel: { x: 0, y: ph, w, h: h - ph } };
}
