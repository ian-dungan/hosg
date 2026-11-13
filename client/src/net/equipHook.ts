// Opens the character sheet on its Gear tab from elsewhere (the quest UI's "equip your reward" step), like barberHook:
// the room's gear controller installs it on entering and clears it on leaving; null between rooms (a no-op).
export const equipHook: { open: (() => void) | null } = { open: null };
