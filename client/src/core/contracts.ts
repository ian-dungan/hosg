// Shady Grove 2 — demo contracts.
// This file is the ONLY coupling between modules. Do not change it; if it is
// wrong or missing something, report that back instead of editing it.
// Units: metres, seconds, radians. Babylon left-handed, Y up. Ground plane is X/Z.
// "facing" is a yaw angle: 0 faces +Z, positive turns toward +X.
import type { Scene, Vector3, TransformNode, ArcRotateCamera } from '@babylonjs/core';

// ───────────────────────── shared data ─────────────────────────
export interface Vec2 { x: number; z: number }
export type ZoneId = 'grove' | 'beacon' | 'arena';
export type Quality = 'low' | 'med' | 'high';
export type WeaponId = 'blade' | 'bow';
export type EntityKind = 'player' | 'companion' | 'grunt' | 'archer' | 'brute' | 'warden';
export type StatusId = 'soaked' | 'burning' | 'marked' | 'stunned' | 'staggered' | 'guard' | 'regen' | 'slowed';

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
  anchor(name: AnchorName): Anchor;
  /** 6-10 spawn points for ordinary enemies on the Beacon, between dock and arena gate. */
  enemySpawns(): Vector3[];
  /** The Beacon island starts hidden under the cloud sea. This plays the beam from the
   *  statue's spyglass + the island rising (about 8 s) and resolves when finished. */
  raiseBeacon(): Promise<void>;
  readonly beaconRaised: boolean;
  /** Arena visuals for the boss phase (2 = outer ring crumbles to ARENA_RADIUS[2], 3 = storm light). */
  setArenaPhase(phase: 1 | 2 | 3): void;
  /** World position of the statue's spyglass lens (for the beam / camera work). */
  readonly statueLens: Vector3;
  setQuality(q: Quality): void;
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
  setWeapon(w: WeaponId | 'none'): void;
  /** Ring under the feet when targeted. */
  setTargeted(on: boolean): void;
  update(dt: number): void;
  dispose(): void;
}
/** Implemented in src/player/character.ts */
export type MakeCharacter = (scene: Scene, opts: CharacterOpts) => CharacterView;

export interface TapInfo { entityId: number | null; point: Vector3 | null }
export interface PlayerRigOpts {
  canvas: HTMLCanvasElement;
  world: WorldApi;
  /** Touch joystick vector from the HUD, screen space: x right, y up, each -1..1. */
  joystick: () => { x: number; y: number };
  /** A short tap/click on the 3D view (not a drag, not on HUD). */
  onTap: (tap: TapInfo) => void;
}
export interface PlayerRig {
  readonly view: CharacterView;
  readonly camera: ArcRotateCamera;
  /** Feet position, owned by the rig. */
  readonly position: Vector3;
  readonly facing: number;
  /** True while the player is providing movement input. */
  readonly moving: boolean;
  teleport(pos: Vector3, facing: number): void;
  /** 0 = rooted, 1 = normal. Used for stuns, dialogue and cutscenes. */
  setMoveScale(s: number): void;
  /** Turn the character to face a world point (used when attacking). */
  faceTowards(x: number, z: number): void;
  /** When true the camera stops following the player (cutscenes drive camera.target/alpha/beta/radius). */
  setCinematic(on: boolean): void;
  /** Jump if on the ground (Space also does this). */
  jump(): void;
  update(dt: number): void;
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
  castTime: number;      // 0 = instant
  weapon: WeaponId | 'any';
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
  player: HudBar & { level: number; weapon: WeaponId; cast: { name: string; frac: number } | null };
  target: (HudBar & { stagger: number; maxStagger: number; isBoss: boolean; cast: { name: string; frac: number; interruptible: boolean } | null }) | null;
  party: HudBar[];                       // companions (empty when solo)
  slots: { ability: AbilityDef; cdRemaining: number; usable: boolean }[];   // 5 entries
  quest: { title: string; steps: { text: string; done: boolean }[] } | null;
  /** Context action near the player, e.g. "Talk to Old Marrow". null hides the button. */
  prompt: string | null;
  inCombat: boolean;
}
export type HudEvent =
  | { type: 'ability'; slot: number }   // button tap or keys 1-5
  | { type: 'interact' }                // prompt button or E key
  | { type: 'swapWeapon' }              // button or Q key
  | { type: 'openLoadout' }             // button or L key
  | { type: 'clearTarget' };            // Esc key / tap on target frame close
export interface HudApi {
  /** Call every frame; must be cheap (only touch DOM nodes whose values changed). */
  render(state: HudState): void;
  on(cb: (e: HudEvent) => void): void;
  /** Touch joystick vector, screen space, -1..1 (0,0 when idle or on desktop). */
  joystick(): { x: number; y: number };
  banner(title: string, subtitle: string): void;                 // big location banner, fades after ~4 s
  toast(text: string): void;                                     // small message, e.g. "Out of range"
  /** Floating combat text at a screen position (px). */
  floatText(x: number, y: number, text: string, kind: 'damage' | 'crit' | 'heal' | 'combo' | 'hurt' | 'info'): void;
  /** Dialogue box; resolves with the index of the chosen option (0 if there are no choices) after the last line. */
  dialogue(speaker: string, lines: string[], choices?: string[]): Promise<number>;
  titleScreen(): Promise<void>;                                  // "Shady Grove 2" + Play
  /** Pick 5 abilities from the pool; resolves with the chosen ids. */
  loadout(pool: AbilityDef[], current: string[], weapon: WeaponId): Promise<string[]>;
  endScreen(kind: 'victory' | 'defeat', lines: string[], buttons: string[]): Promise<number>;
  /** Fade to/from a colour for cutscenes (resolves when done). */
  fade(toOpaque: boolean, color?: string, seconds?: number): Promise<void>;
  /** Hide/show the combat HUD (cutscenes, dialogue). */
  setVisible(on: boolean): void;
}
/** Implemented in src/hud/index.ts */
export type CreateHud = (root: HTMLElement) => HudApi;
