// Hook points between the quest (Plan 6) and sheets other work builds, like net/looks.ts's barberHook. The equip
// sheet's own hook is net/equipHook.ts (Plan 5 Task 10's gear controller fills it; the quest's "Open bag" calls it).

/** The quest's new chest piece (its bag uid) while the equip step is on, for the bag sheet to pulse its tile; null after. */
export const newPieceHook: { uid: number | null } = { uid: null };

/** The journal, for a character menu's "Journal" button: online.ts fills `open` (null in the offline demo). */
export const journalHook: { open: (() => void) | null } = { open: null };
