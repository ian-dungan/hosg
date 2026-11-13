// The quest dialogue's sheet (Plan 6): Plan 1's dialogue box with `closable`, as a bottom sheet that never
// covers the speaker (the camera frames them in the top half meanwhile, story/scenes.ts) and never traps input:
// only the panel takes taps (the whole panel advances: one big target), the world above it stays live, and a
// 48 px close button (or Esc) puts it away to be resumed at the same page.
export const DIALOGUE_SHEET_CSS = /* css */ `
.sg-dlg.sg-dlg-sheet{pointer-events:none;background:linear-gradient(180deg,transparent 55%,rgba(14,14,36,.32))}
.sg-dlg-sheet .sg-dlg-panel{pointer-events:auto;cursor:pointer;touch-action:manipulation;max-height:calc(56vh - var(--sb))}
.sg-dlg-sheet .sg-dlg-name{display:flex;align-items:baseline;gap:8px;max-width:calc(100% - 80px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-dlg-role{font:italic 500 14px/1 var(--serif);color:#5a3c10;opacity:.9;overflow:hidden;text-overflow:ellipsis}
.sg-dlg-x{position:absolute;right:6px;top:6px;width:48px;height:48px;padding:14px;border:0;border-radius:50%;color:var(--cream);
  background:rgba(255,255,255,.08);cursor:pointer;z-index:1}
.sg-dlg-x:active{transform:scale(.92)}
.sg-dlg-sheet .sg-dlg-text{padding-right:34px}
.sg-dlg-sheet .sg-dlg-foot{min-height:30px}
.sg-dlg-sheet .sg-dlg-next{font-size:14px;letter-spacing:.08em}
.sg-dlg-narration .sg-dlg-text{font-style:italic;text-align:center;padding:0 34px}
.sg-dlg-sheet .sg-choice{min-height:52px;font-size:16px;line-height:1.3}
@media (max-width:420px){ .sg-dlg-role{display:none} }
@media (max-width:700px){
  .sg-dlg.sg-dlg-sheet{padding:0 calc(var(--sr) + 8px) calc(var(--sb) + 8px) calc(var(--sl) + 8px)}
  .sg-dlg-sheet .sg-dlg-panel{padding:26px 16px 10px 18px}
  .sg-dlg-sheet .sg-dlg-text{font-size:17px;line-height:1.5;min-height:3em}
  .sg-dlg-sheet .sg-choice{padding:8px 12px;font-size:15px}
}
@media (max-height:500px){
  .sg-dlg-sheet .sg-dlg-panel{max-height:calc(56vh - var(--sb));padding:22px 18px 8px}
  .sg-dlg-sheet .sg-dlg-text{font-size:16px;min-height:2.4em}
  .sg-dlg-sheet .sg-dlg-choices{flex-direction:row;flex-wrap:nowrap}
  .sg-dlg-sheet .sg-choice{flex:1 1 0;min-width:0;min-height:48px;font-size:14px;padding:6px 10px}
}
`;
