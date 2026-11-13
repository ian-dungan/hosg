// The crater mouth's hint (the Greenway): what the Lampfall is, who comes along, and the level it is tuned for. New
// adventurers are level 1 and the Fallen Warden is tuned for level 10, so the hint says so plainly; entry is never blocked.
/** The level the hint recommends for the Lampfall. */
export const MOUTH_RECOMMENDED_LEVEL = 8;

/** The hint by the mouth: `mates` the other party members' names, `level` the adventurer's current job level. */
export function mouthHintText(mates: readonly string[], level: number): string {
  const what = mates.length
    ? `The Lampfall: a private dungeon for your party (you, ${mates.join(', ')}). Party members who walk in join you.`
    : 'The Lampfall: a private dungeon. Alone unless you form a party first (tap an adventurer, then Invite).';
  const rec = `Recommended: level ${MOUTH_RECOMMENDED_LEVEL} or higher${level < MOUTH_RECOMMENDED_LEVEL ? ` (you are level ${level})` : ''}.`;
  return `${rec} ${what}`;
}
