// Talents: three rows per job, unlocked at job levels 4, 7 and 10, one choice of three in each.
// They are sidegrades (they change how a job plays, not how strong it is), and every effect is a Mod.
import { deepFreeze } from './combat/freeze';
import type { JobId } from './combat/jobs';
import type { Mod } from './mods';
import { TALENT_LEVELS } from './progression';

export type TalentRow = 1 | 2 | 3;
export type TalentLetter = 'a' | 'b' | 'c';
export type TalentId = `${JobId}_${TalentRow}${TalentLetter}`;
/** row and choice count from 0 (row 0 unlocks at TALENT_LEVELS[0]). */
export interface TalentData {
  readonly id: TalentId; readonly job: JobId; readonly row: 0 | 1 | 2; readonly choice: 0 | 1 | 2;
  readonly name: string; readonly desc: string; readonly mods: readonly Mod[];
}

type Entry = readonly [name: string, desc: string, mods: readonly Mod[]];
type Rows = readonly [readonly [Entry, Entry, Entry], readonly [Entry, Entry, Entry], readonly [Entry, Entry, Entry]];

const momentumOnHit = (amount: number): Mod => ({ k: 'momentumOn', on: 'hitTaken', amount, everyS: 1 });

/** The table, in JOB_IDS order: [row 1, row 2, row 3], each [a, b, c]. */
const TABLE: Readonly<Record<JobId, Rows>> = {
  warrior: [
    [
      ['Keen Edge', 'Slash hits 15% harder but its cooldown is half a second longer.', [{ k: 'coef', ability: 'slash', mult: 1.15 }, { k: 'cd', ability: 'slash', add: 0.5 }]],
      ['Heavy Swing', 'Sunder hits 12% harder.', [{ k: 'coef', ability: 'sunder', mult: 1.12 }]],
      ['Riposte', 'A successful parry gives 15 more Momentum.', [{ k: 'momentumOn', on: 'parry', amount: 15 }]],
    ],
    [
      ['Long Cry', 'Rallying Roar lasts 3 seconds longer.', [{ k: 'buffS', ability: 'rallying_roar', add: 3 }]],
      ['Ringing Blow', 'Skullringer comes back 3 seconds sooner.', [{ k: 'cd', ability: 'skullringer', add: -3 }]],
      ['Second Wind', 'Mend heals 30% more.', [{ k: 'amount', ability: 'mend', mult: 1.3 }]],
    ],
    [
      ['Unbroken', 'Bulwark absorbs 40% more.', [{ k: 'amount', ability: 'bulwark', mult: 1.4 }]],
      ['Blade Rhythm', 'A perfect dodge gives 10 more Momentum.', [{ k: 'momentumOn', on: 'perfectDodge', amount: 10 }]],
      ['Executioner', 'Sunder deals 10 more stagger.', [{ k: 'stagger', ability: 'sunder', add: 10 }]],
    ],
  ],
  ranger: [
    [
      ['Quick Nock', 'Snap Shot comes back a second sooner.', [{ k: 'cd', ability: 'snap_shot', add: -1 }]],
      ['Wildfire Tips', 'Pitch Arrow hits 15% harder.', [{ k: 'coef', ability: 'pitch_arrow', mult: 1.15 }]],
      ['Drawn Breath', 'Charged Shot hits 12% harder.', [{ k: 'coef', ability: 'charged_shot', mult: 1.12 }]],
    ],
    [
      ['Field Medic', 'Field Dressing heals 30% more.', [{ k: 'amount', ability: 'field_dressing', mult: 1.3 }]],
      ['Pinned Fast', 'Pinning Shot comes back 2 seconds sooner.', [{ k: 'cd', ability: 'pinning_shot', add: -2 }]],
      ['Light Feet', 'Sprint lasts 2 seconds longer and dodge charges refill 15% sooner.', [{ k: 'buffS', ability: 'sprint', add: 2 }, { k: 'dodge', refillMult: 0.85 }]],
    ],
    [
      ['Hailstorm', 'Barbed Rain hits 25% harder.', [{ k: 'coef', ability: 'barbed_rain', mult: 1.25 }]],
      ['Steady Aim', 'Interrupting a wind-up gives 20 more Momentum.', [{ k: 'momentumOn', on: 'interrupt', amount: 20 }]],
      ["Hunter's Patience", 'Charged Shot comes back 2 seconds sooner.', [{ k: 'cd', ability: 'charged_shot', add: -2 }]],
    ],
  ],
  paladin: [
    [
      ['Ringing Rap', 'Shield Rap hits 20% harder.', [{ k: 'coef', ability: 'shield_rap', mult: 1.2 }]],
      ["Verdict's Weight", 'Bright Verdict hits 12% harder.', [{ k: 'coef', ability: 'bright_verdict', mult: 1.12 }]],
      ['Stand Firm', 'Each hit you take gives 2 more Momentum, at most once a second.', [momentumOnHit(2)]],
    ],
    [
      ['Long Shelter', 'Shelter lasts 4 seconds longer.', [{ k: 'buffS', ability: 'shelter', add: 4 }]],
      ['Warm Kindle', 'Kindle heals 25% more.', [{ k: 'amount', ability: 'kindle', mult: 1.25 }]],
      ['Wide Ward', 'Dawn Ward absorbs 25% more.', [{ k: 'amount', ability: 'dawn_ward', mult: 1.25 }]],
    ],
    [
      ['Lasting Aegis', 'Aegis lasts a second longer.', [{ k: 'buffS', ability: 'aegis', add: 1 }]],
      ['Stern Gaze', 'Taunt comes back 3 seconds sooner.', [{ k: 'cd', ability: 'taunt', add: -3 }]],
      ['Mercy', 'Your heals also shield the healed for a fifth of the amount, up to 15.', [{ k: 'healShield', frac: 0.2, cap: 15 }]],
    ],
  ],
  dark_knight: [
    [
      ['Thirsting Rend', 'Grim Rend costs half as much health.', [{ k: 'hpCost', ability: 'grim_rend', mult: 0.5 }]],
      ['Long Night', 'Nightfall hits 12% harder.', [{ k: 'coef', ability: 'nightfall', mult: 1.12 }]],
      ['Pain Engine', 'Each hit you take gives 2 more Momentum, at most once a second.', [momentumOnHit(2)]],
    ],
    [
      ['Shared Vein', 'Bloodbond lasts 3 seconds longer.', [{ k: 'buffS', ability: 'bloodbond', add: 3 }]],
      ['Howling Dark', 'Dread Howl comes back 5 seconds sooner.', [{ k: 'cd', ability: 'dread_howl', add: -5 }]],
      ['Deep Brand', 'Umbral Brand hits 25% harder.', [{ k: 'coef', ability: 'umbral_brand', mult: 1.25 }]],
    ],
    [
      ['Pact of Ash', 'Crimson Pact costs half as much health.', [{ k: 'hpCost', ability: 'crimson_pact', mult: 0.5 }]],
      ['Grave Bulwark', 'Grave Ward absorbs 30% more.', [{ k: 'amount', ability: 'grave_ward', mult: 1.3 }]],
      ['Unending', 'Crimson Pact lasts 2 seconds longer.', [{ k: 'buffS', ability: 'crimson_pact', add: 2 }]],
    ],
  ],
  ninja: [
    [
      ['Fang Flurry', 'Crossed Fangs comes back half a second sooner.', [{ k: 'cd', ability: 'crossed_fangs', add: -0.5 }]],
      ['Hobble', 'Hamstring hits 12% harder.', [{ k: 'coef', ability: 'hamstring', mult: 1.12 }]],
      ['Ghost Step', 'Ghost Edge comes back 2 seconds sooner.', [{ k: 'cd', ability: 'ghost_edge', add: -2 }]],
    ],
    [
      ['Thick Smoke', 'Ashcloud comes back 4 seconds sooner.', [{ k: 'cd', ability: 'ashcloud', add: -4 }]],
      ['Exposed', 'Weak Point lasts 3 seconds longer.', [{ k: 'buffS', ability: 'weak_point', add: 3 }]],
      ['Quick Hands', 'Quickstep comes back 3 seconds sooner.', [{ k: 'cd', ability: 'quickstep', add: -3 }]],
    ],
    [
      ['Veil of Mist', 'Mist Form lasts a second and a half longer.', [{ k: 'buffS', ability: 'mist_form', add: 1.5 }]],
      ['Shadow Tempo', 'A perfect dodge gives 10 more Momentum.', [{ k: 'momentumOn', on: 'perfectDodge', amount: 10 }]],
      ['Fourth Roll', 'You have one more dodge charge.', [{ k: 'dodge', charges: 1 }]],
    ],
  ],
  white_mage: [
    [
      ['Tidecall', 'Tidelash hits 15% harder.', [{ k: 'coef', ability: 'tidelash', mult: 1.15 }]],
      ['Bright Flare', "Lantern Flare's heal is 30% stronger.", [{ k: 'amount', ability: 'lantern_flare', mult: 1.3 }]],
      ['Swift Spring', 'Wellspring casts 20% faster.', [{ k: 'cast', ability: 'wellspring', mult: 0.8 }]],
    ],
    [
      ['Dawn Haste', 'Second Dawn casts 25% faster.', [{ k: 'cast', ability: 'second_dawn', mult: 0.75 }]],
      ['Long Rain', 'Soft Rain lasts 2 seconds longer.', [{ k: 'buffS', ability: 'soft_rain', add: 2 }]],
      ['Thick Veil', 'Mistveil absorbs 25% more.', [{ k: 'amount', ability: 'mistveil', mult: 1.25 }]],
    ],
    [
      ['Mote Swarm', 'Sun Mote hits 20% harder.', [{ k: 'coef', ability: 'sun_mote', mult: 1.2 }]],
      ['Calm Font', 'Your heals also shield the healed for 15% of the amount, up to 15.', [{ k: 'healShield', frac: 0.15, cap: 15 }]],
      ['Deep Well', 'Wellspring heals 20% more.', [{ k: 'amount', ability: 'wellspring', mult: 1.2 }]],
    ],
  ],
  black_mage: [
    [
      ['Hot Coals', 'Cinder Dart hits 15% harder.', [{ k: 'coef', ability: 'cinder_dart', mult: 1.15 }]],
      ['Quick Arc', 'Skyfall Arc casts 20% faster.', [{ k: 'cast', ability: 'skyfall_arc', mult: 0.8 }]],
      ['Banked Fire', 'Hearthfall casts 20% faster.', [{ k: 'cast', ability: 'hearthfall', mult: 0.8 }]],
    ],
    [
      ['Kinship', 'Kindred Spark comes back 5 seconds sooner.', [{ k: 'cd', ability: 'kindred_spark', add: -5 }]],
      ['Bedrock Ward', 'Bastion Stone absorbs 25% more.', [{ k: 'amount', ability: 'bastion_stone', mult: 1.25 }]],
      ['Cage Snap', 'Stormcage comes back 3 seconds sooner.', [{ k: 'cd', ability: 'stormcage', add: -3 }]],
    ],
    [
      ['Deep Roots', 'Rootbreak hits 25% harder.', [{ k: 'coef', ability: 'rootbreak', mult: 1.25 }]],
      ['Live Wire', 'An element reaction you trigger gives 10 more Momentum.', [{ k: 'momentumOn', on: 'react', amount: 10 }]],
      ['Wildfire', 'Hearthfall hits 12% harder.', [{ k: 'coef', ability: 'hearthfall', mult: 1.12 }]],
    ],
  ],
};

const LETTERS: readonly TalentLetter[] = ['a', 'b', 'c'];

function build(): { all: Record<TalentId, TalentData>; byJob: Record<JobId, [TalentData, TalentData, TalentData][]> } {
  const all = {} as Record<TalentId, TalentData>;
  const byJob = {} as Record<JobId, [TalentData, TalentData, TalentData][]>;
  for (const job of Object.keys(TABLE) as JobId[]) {
    byJob[job] = TABLE[job].map((row, r) => row.map(([name, desc, mods], c) => {
      const id = `${job}_${(r + 1) as TalentRow}${LETTERS[c]!}` as TalentId;
      const t: TalentData = { id, job, row: r as 0 | 1 | 2, choice: c as 0 | 1 | 2, name, desc, mods };
      all[id] = t;
      return t;
    }) as [TalentData, TalentData, TalentData]);
  }
  return { all, byJob };
}
const built = build();

/** Every talent by id. */
export const TALENTS: Readonly<Record<TalentId, TalentData>> = deepFreeze(built.all);
const BY_JOB: Readonly<Record<JobId, readonly (readonly [TalentData, TalentData, TalentData])[]>> = deepFreeze(built.byJob);

const own = (o: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export function isTalentId(v: unknown): v is TalentId {
  return own(TALENTS, v);
}

/** `job`'s three rows, each [a, b, c]. */
export function talentsFor(job: JobId): readonly (readonly [TalentData, TalentData, TalentData])[] {
  return BY_JOB[job];
}

/** The level a talent row (0..2) unlocks at. */
export const talentLevel = (row: 0 | 1 | 2): number => TALENT_LEVELS[row];

/**
 * The talents of `ids` that `job` may hold at `level`: ids of that job, the first one per row, with the
 * row unlocked (TALENT_LEVELS); in the order given. What parseJobsSave keeps and talentMods reads.
 */
export function validTalents(job: string, level: number, ids: readonly unknown[]): TalentId[] {
  const seen = [false, false, false];
  const out: TalentId[] = [];
  for (const id of ids) {
    if (!isTalentId(id)) continue;
    const t = TALENTS[id];
    if (t.job !== job || seen[t.row] || !(level >= TALENT_LEVELS[t.row])) continue;
    seen[t.row] = true;
    out.push(id);
  }
  return out;
}

/** The mods of the talents `job` holds at `level` (only unlocked rows, one per row), as one list. */
export function talentMods(job: JobId, level: number, ids: readonly string[]): Mod[] {
  return validTalents(job, level, ids).flatMap((id) => TALENTS[id].mods);
}

/** The simulation's default build per job: one talent per row (Task 5 may change the letters). */
export const SIM_TALENTS: Readonly<Record<JobId, readonly TalentId[]>> = deepFreeze({
  warrior: ['warrior_1a', 'warrior_2a', 'warrior_3a'],
  ranger: ['ranger_1a', 'ranger_2a', 'ranger_3a'],
  paladin: ['paladin_1a', 'paladin_2a', 'paladin_3a'],
  dark_knight: ['dark_knight_1a', 'dark_knight_2a', 'dark_knight_3a'],
  ninja: ['ninja_1a', 'ninja_2a', 'ninja_3a'],
  white_mage: ['white_mage_1a', 'white_mage_2a', 'white_mage_3a'],
  black_mage: ['black_mage_1a', 'black_mage_2a', 'black_mage_3a'],
});
