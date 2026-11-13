// Shady Grove 2 — demo contracts.
// This file is the ONLY coupling between modules. Do not change it; if it is
// wrong or missing something, report that back instead of editing it.
// Units: metres, seconds, radians. Babylon left-handed, Y up. Ground plane is X/Z.
// "facing" is a yaw angle: 0 faces +Z, positive turns toward +X.
import type { Scene, Vector3, TransformNode, ArcRotateCamera } from '@babylonjs/core';
import type { CharSheetHandle, CharSheetView, CharTab, LevelShow, LootShow, SheetAct, SheetHandle, VendorView } from './gearViews';
import type { Body, Displacement, ElementId, EmoteId, FutureJobId, GearLook, JobId, Look as AdventurerLook, QuestId, WeaponId as SharedWeaponId } from '@sg2/shared';

// ───────────────────────── shared data ─────────────────────────
export interface Vec2 { x: number; z: number }
/** 'lampfall' (Plan 4's dungeon): a plain placeholder look from its shared layout until Plan 4 Task 9 builds the real one. */
export type ZoneId = 'grove' | 'beacon' | 'arena' | 'greenway' | 'lampfall';
export type Quality = 'low' | 'med' | 'high';
/** The shared weapons (one per job; the Staff is both mages'). */
export type WeaponId = SharedWeaponId;
export type EntityKind = 'player' | 'companion' | 'grunt' | 'archer' | 'brute' | 'warden';
export type StatusId = 'soaked' | 'burning' | 'marked' | 'stunned' | 'staggered' | 'guard' | 'regen' | 'slowed'
  // marks on enemies (Plan 3b), enemy debuffs, adventurer buffs (from the state's bits)
  | 'rooted' | 'dazed' | 'blinded' | 'weakpoint'
  | 'roar' | 'aegis' | 'sheltered' | 'rain' | 'pact' | 'mist' | 'bloodbond';

/** Palette from concepts/02-skybound/ART.md. Use these, not new colours. */
export const PALETTE = {
  skyDeep: '#1754D1', sky: '#479AF2', horizon: '#FCB380', cloud: '#FFFAF3',
  stone: '#ECD9B8', roof: '#EC6A4C', teal: '#3FB0A6', meadow: '#8FD16A',
  cliff: '#C0605A', rock: '#5D4675', gold: '#F2B742',
} as const;

/** Boss arena walkable radius per phase (centre = anchor 'arenaCenter'). */
export const ARENA_RADIUS: Record<1 | 2 | 3, number> = { 1: 15, 2: 12, 3: 12 };

// ───────────────────────── world (src/world) ─────────────────────────
export type AnchorName =
  | 'playerStart'   // in Shady Grove, a few steps from the statue, facing it
  | 'statuePlinth'  // interact point at the foot of the Ellie & Felix statue
  | 'marrow'        // where NPC Old Marrow stands (near the statue)
  | 'pim'           // the talking figurehead above the harbour tavern door (ground point below it)
  | 'groveDock'     // ferry boarding point in Shady Grove
  | 'beaconDock'    // ferry arrival point on the Beacon
  | 'arenaGate'     // entrance to the lighthouse arena on the Beacon
  | 'arenaCenter'   // centre of the boss arena (flat disc, radius ARENA_RADIUS[1])
  | 'arenaExit';    // where the player is put after the boss fight
export interface Anchor { pos: Vector3; facing: number }

export interface WorldApi {
  /** Ground height under (x,z), or null where the player may not stand
   *  (off the island edge, inside a house/tree trunk/plinth, outside the arena disc while in it). */
  groundAt(x: number, z: number): number | null;
  /** Height of whatever the player would stand on at (x,z): the terrain or a platform top (bench, crate,
   *  Lookout tier...), or null where groundAt is null for any other reason. Drives the character controller. */
  surfaceAt(x: number, z: number): number | null;
  anchor(name: AnchorName): Anchor;
  /** 6-10 spawn points for ordinary enemies on the Beacon, between dock and arena gate. */
  enemySpawns(): Vector3[];
  /** The Beacon island starts hidden under the cloud sea. This plays the beam from the
   *  statue's spyglass + the island rising (about 8 s) and resolves when finished. */
  raiseBeacon(): Promise<void>;
  readonly beaconRaised: boolean;
  /** Shows or hides the Beacon at once (no rise): a returning adventurer past the plaque (online). The Greenway's sky
   *  shows it far off; zones without a sky for it do nothing. */
  setBeaconRaised(on: boolean): void;
  /** A 3 s streak from the Beacon down past the grove's east edge toward the Greenway, with a soft flash on the
   *  horizon; resolves when it lands. (The Greenway: from its far Beacon into the crater; elsewhere it resolves at once.) */
  fallingStar(): Promise<void>;
  /** Arena visuals for the boss phase (2 = outer ring crumbles to ARENA_RADIUS[2], 3 = storm light). */
  setArenaPhase(phase: 1 | 2 | 3): void;
  /** World position of the statue's spyglass lens (for the beam / camera work). */
  readonly statueLens: Vector3;
  setQuality(q: Quality): void;
  /** Register a character's meshes so they cast shadows (and get outlines, where the world draws them). */
  addShadowCaster(root: TransformNode): void;
  /** Call once the player camera exists, so the world can attach post-processing to it. */
  attachCamera(camera: ArcRotateCamera): void;
  update(dt: number): void;
}
/** Implemented in src/world/index.ts */
export type BuildWorld = (scene: Scene) => WorldApi;

// ───────────────────────── characters + player rig (src/player) ─────────────────────────
export type Pose = 'idle' | 'run' | 'attack' | 'cast' | 'hit' | 'staggered' | 'dead' | 'parry' | 'charge';
export interface CharacterOpts {
  kind: EntityKind | 'npc';
  /** main cloth colour (hex); sensible default per kind if omitted */
  color?: string;
  weapon?: WeaponId | 'none';
  /** The adventurer's look (players only): absent, today's default adventurer (the offline demo). */
  look?: AdventurerLook;
  /** The worn gear as the model shows it (Plan 5 Task 9 builds it; null or absent: the starter look). */
  gear?: GearLook | null;
  /** The level of detail of a look-driven body (default: the game's quality, setCharacterDetail). */
  detail?: Quality;
}
export interface CharacterView {
  /** Position/rotate this. root.position.y is the feet. Every pickable child mesh must carry
   *  metadata = { entityId } once setEntityId is called. */
  readonly root: TransformNode;
  readonly height: number;
  setEntityId(id: number): void;
  /** Looping poses (idle, run, staggered, dead, charge) persist; one-shot poses
   *  (attack, cast, hit, parry) play once (~0.4 s) then return to the last looping pose. */
  setPose(pose: Pose): void;
  /**
   * The weapon carried (drawn in combat, sheathed on the back or hip otherwise). `tint` picks the staff: 'white'
   * (teal-white crystal in a pale ring, the White Mage) or 'black' (ember-violet crystal in iron prongs, the Black Mage).
   */
  setWeapon(w: WeaponId | 'none', tint?: 'white' | 'black'): void;
  /** Loops the cast pose (staff raised, free hand forward) over the legs' pose while on. */
  setCasting(on: boolean): void;
  /** The body's opacity (Mist Form: 0.5; 1: solid). */
  setFade(alpha: number): void;
  /** Whether its body casts a shadow (remotes far from the camera do not: the shadow map renders every caster). */
  setCastShadow(on: boolean): void;
  /** Recolours the cape (and hood) to `color` (hex), keeping its shading; null: the colour it was built in. */
  setCape(color: string | null): void;
  /** Ring under the feet when targeted. */
  setTargeted(on: boolean): void;
  /** A short white flash (it was hit). */
  flash(): void;
  /**
   * Rebuilds the body for a new look and/or gear (queued: at most 2 rebuilds per frame across the scene, done in a
   * later update(); the mesh, its shadow and its outline stay the same objects). Players only.
   */
  setAppearance(look: AdventurerLook, gear: GearLook | null): void;
  /** Plays an emote over the idle pose (sit holds until a move); a move, a fight or a fall ends it; null stops it. */
  emote(id: EmoteId | null): void;
  update(dt: number): void;
  dispose(): void;
}
/** Implemented in src/player/character.ts */
export type MakeCharacter = (scene: Scene, opts: CharacterOpts) => CharacterView;

export interface TapInfo {
  /** The nearest entity under the tap (null: none). */
  entityId: number | null;
  point: Vector3 | null;
  /** Every entity under the tap, nearest first (absent: only `entityId`). */
  entityIds?: readonly number[];
}
export interface PlayerRigOpts {
  canvas: HTMLCanvasElement;
  world: WorldApi;
  /** Touch joystick vector from the HUD, screen space: x right, y up, each -1..1. */
  joystick: () => { x: number; y: number };
  /** A short tap/click on the 3D view (not a drag, not on HUD). */
  onTap: (tap: TapInfo) => void;
  /** Called when the player lands, with how far they fell (metres from the highest point of the jump or fall).
   *  Nothing passes it yet (online fall damage comes from the server); kept for later local landing effects. */
  onLand?: (drop: number) => void;
}
export interface PlayerRig {
  readonly view: CharacterView;
  readonly camera: ArcRotateCamera;
  /** Feet position, owned by the rig (the body's x, y, z). */
  readonly position: Vector3;
  /** The live character-controller body (shared stepBody over WorldApi.surfaceAt). */
  readonly body: Readonly<Body>;
  readonly facing: number;
  /** True while the player is providing movement input. */
  readonly moving: boolean;
  teleport(pos: Vector3, facing: number): void;
  /** Moves the feet to `pos` (a server correction): stands on the surface there, or falls from `pos.y` if that is
   *  above it. Keeps the facing and the camera angle, and stops any jump in progress. */
  place(pos: Vector3): void;
  /** 0 = rooted, 1 = normal, up to 1.5 (Sprint). Used for stuns, dialogue, cutscenes, charging and sprinting. */
  setMoveScale(s: number): void;
  /**
   * Plays a displacement (a dodge or a knockback): stands the body at `from` and replays the shared
   * simulateDisplacement from there, ignoring input meanwhile. The end is exactly where the server puts it.
   */
  displace(from: { x: number; z: number; y: number }, d: Displacement): void;
  /** True while a displacement plays. */
  readonly displacing: boolean;
  /** Turn the character to face a world point (used when attacking). */
  faceTowards(x: number, z: number): void;
  /** When true the camera stops following the player (cutscenes drive camera.target/alpha/beta/radius). */
  setCinematic(on: boolean): void;
  /** Jump on the next step if on the ground (Space also does this). */
  jump(): void;
  update(dt: number): void;
  /** Removes the rig's input listeners and disposes its character and camera (a zone change builds a new rig). */
  dispose(): void;
}
/** Implemented in src/player/rig.ts. Desktop: WASD/arrows move, drag rotates, wheel zooms.
 *  Touch: joystick moves, one-finger drag on the view rotates, pinch zooms. Movement is camera-relative. */
export type CreatePlayerRig = (scene: Scene, opts: PlayerRigOpts) => PlayerRig;

// ───────────────────────── combat sim (src/combat) — NO Babylon imports ─────────────────────────
export interface StatusInst { id: StatusId; remaining: number }
export interface SimEntity {
  id: number;
  kind: EntityKind;
  name: string;
  team: 'player' | 'enemy';
  pos: Vec2;
  facing: number;
  radius: number;
  hp: number; maxHp: number;
  /** Only bosses/elites have a stagger bar (maxStagger > 0). */
  stagger: number; maxStagger: number;
  statuses: StatusInst[];
  alive: boolean;
  targetId: number | null;
  /** Current wind-up, if any (drives 'cast'/'charge' poses and the cast bar). */
  casting: { abilityId: string; remaining: number; total: number; interruptible: boolean } | null;
  moving: boolean;
}
export interface Telegraph {
  id: number;
  team: 'player' | 'enemy';
  shape: 'circle' | 'cone' | 'line' | 'ring';
  origin: Vec2;
  dir: number;       // yaw, for cone/line
  radius: number;    // circle radius, cone length, ring outer radius
  inner: number;     // ring inner radius (else 0)
  angle: number;     // cone full angle in radians (else 0)
  width: number;     // line width (else 0); line length = radius
  remaining: number; total: number;
}
export interface AbilityDef {
  id: string;
  name: string;
  /** 1-2 character glyph for the button (plain text or a simple symbol, no emoji). */
  glyph: string;
  desc: string;          // one short sentence incl. its combo
  cooldown: number;
  range: number;         // 0 = self
  castTime: number;      // 0 = instant (Charged Shot: the time to a full charge)
  /** The job it belongs to (tooltips show JOBS[job].name). */
  job: JobId;
  element?: ElementId;
  /** Reaches other adventurers (a heal, a shield, a buff). */
  support: boolean;
  kind: 'damage' | 'heal' | 'defence' | 'utility';
}
export type SimEvent =
  | { type: 'damage'; targetId: number; sourceId: number; amount: number; crit: boolean; combo: string | null }
  | { type: 'heal'; targetId: number; sourceId: number; amount: number }
  | { type: 'status'; targetId: number; status: StatusId; applied: boolean }
  | { type: 'ability'; sourceId: number; abilityId: string; targetId: number | null }
  | { type: 'projectile'; sourceId: number; from: Vec2; to: Vec2; duration: number; style: 'arrow' | 'bolt' | 'orb' | 'water' | 'fire' }
  | { type: 'telegraph'; telegraph: Telegraph; started: boolean }   // started=false => it just resolved
  | { type: 'interrupted'; targetId: number }
  | { type: 'parry'; entityId: number }
  | { type: 'staggerBreak'; targetId: number }
  | { type: 'bossPhase'; phase: 1 | 2 | 3 }
  | { type: 'death'; entityId: number }
  | { type: 'xp'; amount: number; level: number; levelUp: boolean }
  | { type: 'defeat' }      // the player died
  | { type: 'victory'; solo: boolean; seconds: number };  // the boss died

export interface CombatSimOpts {
  /** May an entity stand at (x,z)? (wraps WorldApi.groundAt !== null) */
  walkable: (x: number, z: number) => boolean;
}
export interface CombatSim {
  readonly entities: ReadonlyMap<number, SimEntity>;
  readonly telegraphs: readonly Telegraph[];
  readonly playerId: number;
  readonly level: number;
  readonly weapon: WeaponId;
  /** Ability ids in the 5 slots. */
  readonly loadout: readonly string[];
  /** Seconds left per slot. */
  readonly cooldowns: readonly number[];
  readonly bossPhase: 0 | 1 | 2 | 3;   // 0 = no boss fight running
  /** The player's position is owned by the PlayerRig; push it in every frame before update(). */
  setPlayerPose(pos: Vec2, facing: number, moving: boolean): void;
  /** Movement scale the rig should apply this frame (0 while stunned/rooted, <1 while slowed, lower while casting). */
  playerMoveScale(): number;
  setTarget(id: number | null): void;
  /** Basic attacks fire automatically at the target when in range. */
  useAbility(slot: number): { ok: boolean; reason?: 'cooldown' | 'range' | 'no-target' | 'weapon' | 'busy' | 'dead' };
  setLoadout(ids: string[]): void;
  setWeapon(w: WeaponId): void;
  /** Gear tier 1-3 scales the player's damage and health (3 = "great gear"). */
  setGearTier(t: 1 | 2 | 3): void;
  spawnEnemy(kind: 'grunt' | 'archer' | 'brute', pos: Vec2): number;
  /** Removes all enemies/companion and fully heals the player (zone change / retry). */
  reset(): void;
  /** Spawns the Lighthouse Warden at `center`. The boss is tuned for 3 average players and is NOT
   *  weakened for solo. With companion=true an AI ally (damage + heals) joins. */
  startBoss(center: Vec2, opts: { companion: boolean }): void;
  /** Advance the simulation; returns everything that happened this step. */
  update(dt: number): SimEvent[];
}
/** Implemented in src/combat/index.ts, which also exports ABILITIES. */
export type CreateCombatSim = (opts: CombatSimOpts) => CombatSim;

// ───────────────────────── HUD (src/hud) — DOM only, NO Babylon imports ─────────────────────────
export interface HudBar { name: string; hp: number; maxHp: number; statuses: StatusId[] }
export interface HudState {
  player: HudBar & {
    level: number; weapon: WeaponId;
    /** A cast or a charge; `mark` (0..1) draws a notch on the bar (Charged Shot's interrupt threshold). */
    cast: { name: string; frac: number; mark?: number } | null;
    /** Momentum 0..100 (undefined hides the bar: the offline demo). */
    momentum?: number;
    /** Dodge charges, and the next charge's refill progress 0..1 (undefined hides the dodge button). */
    dodge?: { charges: number; max: number; refill: number };
    dead?: boolean;
    /** Job changes and picks are refused in a fight: their buttons grey out. */
    jobLocked?: boolean;
    /** The current job (undefined: the offline demo, no badge). */
    job?: { id: JobId; name: string; glyph: string; level: number };
  };
  target: (HudBar & {
    stagger: number; maxStagger: number; isBoss: boolean; cast: { name: string; frac: number; interruptible: boolean } | null;
    /** Seconds until the stagger bar can fill again (0 = it can): the bar greys out meanwhile. */
    staggerImmune?: number;
    /** It is running to catch up (the chase surge). */
    surging?: boolean;
  }) | null;
  /** The other party members, in join order (empty without a party; the offline demo has none). */
  party: PartyBar[];
  /** The boss frame (a targeted boss, or an engaged boss in view), or null/absent. */
  boss?: BossBar | null;
  /** A passive line under the context prompt (the crater mouth's "a private dungeon for your party ..."), or null. */
  hint?: string | null;
  /** Online: the party button shows, teal in a party, with the pending invites counted (the offline demo has none). */
  social?: { inParty: boolean; invites: number } | null;
  /** Arrows at the screen edge toward party members off screen (CSS px; angle in rad, 0 = right). */
  edges?: readonly { id: number; x: number; y: number; angle: number; initial: string }[];
  /** The adventurer focused for ally-aimed abilities (a tap on them), or null. */
  ally?: (HudBar & { dead: boolean; inRange: boolean; glyph: string; cast: { name: string; frac: number } | null;
    /** Plan 4: its engine id, and whether the focus frame offers "Invite" (a stranger, and this adventurer may invite). */
    eid?: number; canInvite?: boolean }) | null;
  slots: { ability: AbilityDef; cdRemaining: number; usable: boolean }[];   // 5 entries
  /**
   * The tracked quest (Plan 6): its current step's objective lines with counts; `hint` is the step's hint (shown
   * when the tracker is tapped open on wide screens and in the journal), `more` the number of other active quests.
   */
  quest: { title: string; steps: { text: string; done: boolean }[]; hint?: string | null; more?: number; kicker?: string } | null;
  /** Context action near the player, e.g. "Talk to Old Marrow". null hides the button. */
  prompt: string | null;
  inCombat: boolean;
  /** Plan 5 (online): the character menu button shows, with a badge for open talent rows (the offline demo has none). */
  gear?: { badge: number } | null;
}
export type HudEvent =
  | { type: 'ability'; slot: number }   // button tap or keys 1-5
  | { type: 'abilityUp'; slot: number } // button released or key 1-5 up (Charged Shot fires on release)
  | { type: 'dodge'; dir: { x: number; y: number } | null } // Dodge button, Shift or a double tap (screen-space direction; null = facing)
  | { type: 'cycleTarget' }             // Tab
  | { type: 'respawn' }                 // the death screen's button
  | { type: 'jump' }                    // the touch Jump button (Space is the rig's own)
  | { type: 'interact' }                // prompt button or E key
  | { type: 'openJobs' }                // the Jobs button or J key
  | { type: 'openLoadout' }             // button or L key
  | { type: 'cycleAlly' }               // F key: the next adventurer within 18 m, nearest first
  | { type: 'clearAlly' }               // the focus frame's close button
  | { type: 'clearTarget' }             // Esc key / tap on target frame close
  | { type: 'openParty' }               // P key, the party button
  | { type: 'invite'; eid: number }     // the focus frame's Invite
  | { type: 'focusMember'; eid: number } // a tap on a party frame
  | { type: 'openJournal' }             // Q, a tap on the quest tracker (Plan 6)
  | { type: 'pointerTap' }              // a tap on the quest pointer chip: walk toward its target (Plan 6)
  | { type: 'release' }                 // dead in the Lampfall: get up at the checkpoint
  | { type: 'leaveInstance' }           // the victory screen's "Leave the Lampfall"
  | { type: 'openChar'; tab: CharTab | null }; // the menu button (null: the last tab), I (bag), C (gear and stats), O (wardrobe), T (talents)
export interface HudApi {
  /** Live player settings (the Settings panel changes them; saved in this browser). */
  readonly settings: { readonly tapToWalk: boolean };
  /** Call every frame; must be cheap (only touch DOM nodes whose values changed). */
  render(state: HudState): void;
  on(cb: (e: HudEvent) => void): void;
  /** Touch joystick vector, screen space, -1..1 (0,0 when idle or on desktop). */
  joystick(): { x: number; y: number };
  banner(title: string, subtitle: string): void;                 // big location banner, fades after ~4 s
  toast(text: string): void;                                     // small message, e.g. "Out of range"
  /** Floating combat text at a screen position (px). */
  floatText(x: number, y: number, text: string, kind: 'damage' | 'crit' | 'heal' | 'combo' | 'hurt' | 'info' | 'other'): void;
  /**
   * Dialogue box; resolves with the index of the chosen option (0 if there are no choices) after the last line.
   * With opts.closable it has a close button (and Esc closes it); closing it, or closeDialogue(), resolves -1.
   */
  dialogue(speaker: string, lines: string[], choices?: string[], opts?: DialogueOpts): Promise<number>;
  /** Closes the open dialogue (it resolves -1) and drops any queued behind it; nothing when none is open. */
  closeDialogue(): void;
  /** Plan 6: the journal sheet (Q, the tracker): resolves with an act (accept, abandon, skip), a re-track, or null on close. */
  journal(view: JournalView): Promise<JournalAnswer | null>;
  /** Plan 6: the completion moment of a quest step (a gold banner, the reward chips, a title toast). */
  questDone(g: QuestMoment): void;
  /** Plan 6: the edge pointer toward the tracked objective (screen px of the target; off screen it clamps to the edge with an arrow); null hides it. */
  pointer(p: { x: number; y: number; label: string; onScreen: boolean; angle: number } | null): void;
  /** Plan 6: a short, dismissible teaching hint (never modal); resolves true when the adventurer dismissed it, false when it went by itself or was replaced. */
  questHint(text: string | null, seconds?: number): Promise<boolean>;
  /** Plan 6: a small non-modal card (the epilogue's offer, the equip prompt): resolves with the button chosen, or -1 (closed, replaced, closeQuestCard). */
  questCard(card: QuestCardOpts): Promise<number>;
  /** Closes the quest card, if one is up (it resolves -1). */
  closeQuestCard(): void;
  titleScreen(): Promise<void>;                                  // "Shady Grove 2" + Play
  /** Pick `count` abilities from the pool; resolves with the chosen ids. `title` names it (the job's name). */
  loadout(pool: AbilityDef[], current: string[], title: string, count?: number): Promise<string[]>;
  /** The job board sheet: resolves with the job chosen ("Become a …"), 'talents' (its Talents button), or null when closed. */
  jobs(view: JobBoardView): Promise<JobId | 'talents' | null>;
  /**
   * opts.countdown: a line counting down `seconds` (its text has `{s}` for the seconds left);
   * opts.waitS: the buttons wake up after this long. Resolves with the button chosen, or -1 when dismissed.
   */
  endScreen(kind: 'victory' | 'defeat', lines: string[], buttons: string[], opts?: EndScreenOpts): Promise<number>;
  /**
   * The invite card ("Ann invites you to a party (2/4)", Accept / Decline): never modal, clear of the ability
   * cluster and the middle of the screen. Several queue. Resolves true (Accept) or false (Decline, or it
   * timed out after `seconds`, or closeInvite).
   */
  partyInvite(from: string, size: number, seconds?: number): Promise<boolean>;
  /** Closes the invite card for `from` (or every one: null), if open or queued (each resolves false). */
  closeInvite(from: string | null): void;
  /** Screen rectangles (CSS px) edge markers keep out of: the joystick zone, the ability cluster, the frames. Cached; cheap. */
  exclusions(): readonly { x0: number; y0: number; x1: number; y1: number }[];
  /** The party sheet (P, the party button): resolves with what was asked for, or null when closed. */
  partySheet(view: PartySheetView): Promise<PartyAction | null>;
  /** Closes the end screen, if one is open (it resolves with -1). */
  dismissEndScreen(): void;
  /** Closes the job board and the picks chooser, if open (each resolves as cancelled). */
  closeSheets(): void;
  /** The red screen edge: a flash (hurt), or held on while standing in a telegraph. */
  danger(mode: 'flash' | 'on' | 'off'): void;
  /** Fade to/from a colour for cutscenes (resolves when done). */
  fade(toOpaque: boolean, color?: string, seconds?: number): Promise<void>;
  /** Hide/show the combat HUD (cutscenes, dialogue). */
  setVisible(on: boolean): void;
  /**
   * The character creator (mode 'create': the first visit, free) or the Barber (mode 'barber': priced by barberCost,
   * free on the free visit). Resolves with the look (and the name, when `needsName`) on Done, or null when closed.
   */
  creator(o: CreatorOpts): Promise<{ look: AdventurerLook; name?: string } | null>;
  /** The emote wheel: resolves with the emote chosen, or null when closed. */
  emoteWheel(): Promise<EmoteId | null>;
  /**
   * Plan 5: the character sheet (tabs Gear, Bag, Talents, Wardrobe, and Vault at the Vault). It stays open across
   * inventory changes: update() redraws it in place. onAct gets each op the player asks for; onClosed runs once.
   * closeSheets() closes it (the room's controller going away).
   */
  charSheet(view: CharSheetView, tab: CharTab, onAct: (a: SheetAct) => void, onClosed: () => void): CharSheetHandle;
  /** A stall's sheet (the Smithy, the Lampwright, the Tailor); as charSheet. */
  vendor(view: VendorView, onAct: (a: SheetAct) => void, onClosed: () => void): SheetHandle;
  /** One kill's drops as a toast (stacked at the screen's edge, never over the fight). */
  loot(l: LootShow): void;
  /** The level-up moment; onTalent: its "New talent row" button. */
  levelUp(l: LevelShow, onTalent: () => void): void;
}
export interface CreatorOpts {
  look: AdventurerLook;
  mode: 'create' | 'barber';
  needsName: boolean;
  gold: number;
  free: boolean;
  /** validateAdventurerName: null when the name is fine, else the line to show. */
  validateName: (s: string) => string | null;
  /** A line shown over the buttons until the first change (why the creator opened again: a taken name, ...). */
  notice?: string;
}
/** The dialogue's options (Plan 6): a close button, the page to start on, and each page as it shows. */
export interface DialogueOpts { closable?: boolean; start?: number; onPage?: (page: number) => void }
/** The completion moment: the quest's name, the step's line, the rewards, the title earned, and whether the quest is done. */
export interface QuestMoment { title: string; step: string; xp: number; gold: number; item: string | null; title2: string | null; questDone: boolean }
/** A quest card: a kicker, a title, a line, its buttons (the first is gold). */
export interface QuestCardOpts { kicker: string; title: string; text: string; buttons: string[]; seconds?: number }
/** What the journal sheet answers. */
export type JournalAnswer =
  | { act: 'accept' | 'abandon' | 'skip'; quest: QuestId }
  | { act: 'track'; quest: QuestId };
/** The journal as the HUD shows it (net/quests.ts journalView builds it from the view and the shared text). */
export interface JournalView {
  active: {
    id: QuestId; name: string; blurb: string; kind: 'main' | 'side' | 'daily' | 'epilogue'; tracked: boolean;
    /** Past steps (struck, or skipped), then the current one with its lines, counts and hint. */
    steps: { text: string; state: 'done' | 'skipped' | 'current'; lines?: { text: string; done: boolean }[]; hint?: string | null }[];
    rewards: string;
    canDrop: boolean; canSkip: boolean;
  }[];
  offers: { id: QuestId; name: string; blurb: string; giver: string | null; rewards: string; canAccept: boolean }[];
  done: { id: QuestId; name: string; times: number; today: boolean; daily: boolean; title: string | null }[];
  /** The tab to open on. */
  tab?: 'active' | 'offers' | 'done';
}
/** opts.countdown: a line counting down; opts.waitS: the buttons wake after this; opts.title: instead of "Victory"/"Defeated". */
export interface EndScreenOpts { countdown?: { seconds: number; text: string; doneText?: string }; waitS?: number; title?: string }

/** One other party member as the party frames show it. */
export interface PartyBar extends HudBar {
  /** Its engine id in this room, or -1 (another room). */
  eid: number; dead: boolean; leader: boolean; online: boolean;
  /** Where it is when not in this room ("Offline", "Shady Grove", ...); null: here. */
  zoneLabel: string | null;
  /** In this room and within reach of ally abilities. */
  inRange: boolean;
  glyph: string; job: JobId | null; level: number;
  /** Searing stacks (0..5). */
  searing: number;
}
/** The boss frame. */
export interface BossBar {
  name: string; hp: number; maxHp: number;
  /** 0-based (already the next one during a transition); phases: how many it has. */
  phase: number; phases: number;
  /** The hp fractions where the next phase starts (Wickhound [0.5], Warden [0.7, 0.35]). */
  phaseMarks: number[];
  phaseName: string;
  warded: boolean;
  /** Seconds to its enrage, shown from 60 s before it (0 once enraged); null otherwise. */
  enrageIn: number | null;
  stagger: number; maxStagger: number;
  /** A Break is on (stunned, taking extra damage). */
  broken: boolean;
  /** Seconds until its stagger bar can fill again (0: it can). */
  staggerImmune: number;
  cast: { name: string; frac: number; interruptible: boolean; unavoidable: boolean } | null;
  /** Between phases (invulnerable). */
  transition: boolean;
  /** It is this adventurer's target (the frame's close button clears it). */
  targeted: boolean;
}
/** The party sheet. */
export interface PartySheetView {
  members: { name: string; leader: boolean; online: boolean; zone: string | null; job: string; level: number; glyph: string; me: boolean }[];
  amLeader: boolean;
  /** Without a party: inviting by name starts one. */
  canInvite: boolean;
}
export type PartyAction = { kind: 'invite'; name: string } | { kind: 'kick'; name: string } | { kind: 'lead'; name: string } | { kind: 'leave' };

/** The job board as the HUD shows it (hud/jobs.ts jobBoardView builds it from the shared job data). */
export interface JobBoardView {
  current: JobId;
  /** Where the adventurer stands allows a change (a town, a sanctuary); `note` says why not (the buttons stay on: the server decides). */
  canSwitch: boolean; note: string | null;
  rows: {
    id: JobId; name: string; glyph: string; role: string; level: number; xpFrac: number; weaponName: string;
    /** The trait's name and line (the job's one-line pitch). */
    traitName: string; trait: string;
    /** The bar (quick, finisher, signature) and the four picks of its pool; `chosen`: the two it has picked. */
    bar: AbilityDef[]; picks: AbilityDef[]; chosen: string[];
  }[];
  /** Plan 5: the current job's row offers "Talents" (it opens the character sheet's Talents tab). */
  talents?: boolean;
  /** Jobs to unlock later (data hooks only): shown locked. */
  locked: { id: FutureJobId; name: string; glyph: string; role: string; weaponName: string; unique: string }[];
}
/** Implemented in src/hud/index.ts */
export type CreateHud = (root: HTMLElement) => HudApi;
