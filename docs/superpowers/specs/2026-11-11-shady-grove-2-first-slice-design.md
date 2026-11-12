# Shady Grove 2 — First Playable Slice (Design)

Date: 2026-11-11. Status: approved by the owner.

## Goal

Prove that Shady Grove 2 feels like a next-gen sequel: a bright 3D world in the browser, deep combat, parties, and many players online together. This slice is the foundation every later round builds on. Story source: `concepts/02-skybound/PITCH.md`.

## World shape

The player starts on solid ground. The first game was a small corner of a much larger continent, which is the main game. The floating islands are a later-game region, not necessarily the final one: they are where Ellie and Felix went, visible in the sky from the opening quest and reached well into the game.

## Hard requirements

- Player characters are called **adventurers**, in the game's text and its story (Ellie and Felix were the greatest of them).
- Runs in a web browser on phones, tablets and computers. No install.
- 100 players online at once on the owner's Hetzner server.
- Ellie and Felix are the legendary heroes; their statue stands in the starting town.
- Fresh build. Nothing from the old game or the old HOSG code is reused.

## In scope

1. **Shady Grove** (starting town): a quaint town on solid ground in a green valley, under the old trees it is named for. The statue of Ellie (pointing at the sky) and Felix (spyglass) stands in its square, the Plaza of the Two.
2. **Opening quest, "The Solstice Crossing"**: talk to Old Marrow, find Pim, read the plaque. The beam leaves the statue and a floating island, the Beacon, appears far off in the sky. Something falls from it into the woods.
3. **The Greenway**: the woods and old road outside town. One combat zone with ordinary enemies, a few side quests, and the mega boss arena where the thing from the sky landed.
4. **Controls**
   - Touch: virtual joystick to move, tap to target, ability buttons under the right thumb.
   - Computer: WASD to move, click to target, keys 1 to 5 for abilities.
   - Overhead three-quarter camera that rotates and zooms.
   - Tap-to-walk: tap or click the ground to walk there, or a person to walk over and talk, with path-finding around obstacles. It works alongside the joystick and keys, and a "Tap to walk" switch in Settings turns it off for players who find it gets in the way (for example when tapping to target in combat).
5. **Physical movement**
   - Jumping (Space on a computer, a jump button on touch), gravity and falling, with ledges you can drop from and low obstacles you can hop over.
   - Knockback and launches in combat: heavy hits push characters, and being knocked off a ledge matters.
   - Short falls are free; long falls cost some health but never kill outright.
   - Built as simple character physics that the server checks, not a full physics engine, so it stays fair online and smooth on phones.
   - Gliding is saved for the later sky region.
6. **Combat** (revised 2026-11-12, owner direction: solid mechanics, some hard fights, gear that matters, a magic system and a skill system)
   - **Core loop**: tap an enemy to target it; the adventurer attacks automatically in range; attacks build **Momentum** (one bar, 0 to 100); Momentum is spent on finishers; dangerous attacks are marked on the ground and dodged.
   - **Five buttons**: three come from the equipped weapon (a quick skill that builds Momentum, a finisher that spends it, a signature move) and two are chosen freely from a shared pool (heal, taunt, shield, speed boost and the like). A **dodge roll** has its own button with two charges that refill over time.
   - **Weapons**: Blade (signature: parry), Bow (signature: charged shot) and Staff (magic). The weapon comes with the job.
   - **Magic**: the Staff casts spells from the same Momentum bar. Four elements: Fire (damage over time), Water (heals, Soaked), Lightning (bursts, interrupts), Earth (shields, slows). Spells have a cast time; bigger spells take longer and can be interrupted.
   - **Combos**: every finisher leaves a mark (Soaked, Burning, Marked); a different finisher sets it off for bonus damage, and elements react (Lightning on Soaked stuns, Fire on Marked explodes). A solo player combos within their job's own abilities; a party does it more often and harder.
   - **Enemies**: ordinary (10 to 15 seconds, one marked attack), elite (dangerous if careless) and boss. Elites and bosses have a stagger bar filled by dodging well, parrying, interrupting and combos; a break stuns and adds bonus damage.
   - **Difficult fights**: bosses punish mistakes, not low numbers. Each has two or three attacks that must be dodged, interrupted or parried. Mega bosses have an enrage timer. Hard-mode versions, unlocked after the first kill, add a mechanic and give better rewards.
   - **Jobs** (owner direction 2026-11-12; replaces weapon skill levels and mid-fight weapon swapping): one adventurer can learn every job, levels each separately and keeps them all. A job is a weapon, a role and an ability set; its bar comes from the job plus two free picks, which may be abilities learned on other jobs. Jobs are changed only in towns and sanctuary zones (safe camps in the wild), never in the field. Each job remembers its own outfit. Starting jobs: Blade (sword, close damage, parry), Guardian (sword and shield, tank), Ranger (bow, charged shot), Mender (Water staff, healer), Elementalist (Fire and Lightning staff, magic damage), Warden (Earth staff, shields and control). More jobs are unlocked by quests later. Each job has a small talent tree (about ten points) with real choices; retraining costs gold. Solo combos come from within a job's own abilities.
   - Left out on purpose: long rotations, a required healer or tank, a second resource bar, split-second timing.
   - Wind is not a standing combat mechanic. A few set-piece battles may use it as their special twist, where it is done well.
   - Being in the air never dodges a ground attack: the server decides hits by position on the ground, because it cannot fully trust a client's reported height (a modified client can float up to one jump high). Knockback and launches are applied by the server, not reported by clients.
7. **Parties**
   - Up to 4 players. Invite by tapping a player. Party health bars. Shared loot rolls.
   - No locked classes: any adventurer can level every job and picks the one the situation calls for before leaving town.
8. **Mega boss: the Fallen Warden** (a stone-and-brass lighthouse keeper that fell from the Beacon)
   - Tuned for 3 average players. It does not get weaker for fewer players; a 4th player adds 25% health.
   - Three phases; each one changes the arena.
   - Fought in a private arena per party (or per solo player) so tuning stays fair.
   - No "party required" gate. Solo is possible with top gear and near-perfect play.
   - A solo kill grants a unique title and a place on the boss leaderboard.
9. **Progression**: levels 1 to 10, three gear tiers, abilities unlocked by level and quest.
   - **Visible gear**: what you equip shows on your character and is seen by every other player. Slots: head, chest, legs, feet, hands, back (cape or pack), main weapon and off-hand.
   - **Armour types**: cloth (for casters and healers: stronger abilities, low defence), light (faster Momentum and critical hits) and heavy (defence, stagger resistance, and enemies prefer to attack the wearer). Any adventurer can wear any type; the choice is how you lean toward a role, since there are no fixed classes.
   - **Gear matters**: stats are few and visible (Power, Defence, Health, plus one special stat per armour type). Tier gaps are large: a boss tuned for three players is soloable only in the top tier.
   - **Set bonuses**: wearing three and five pieces of a set gives a named effect (for example, heals also shield, or dodging refunds Momentum).
   - **Armour sets**: each set has its own style and colours. The first slice has one set per armour type per gear tier (nine sets).
   - **Weapons**: each weapon has its own look wherever possible (shape, colour, glow or trail), so a named or rare weapon is recognisable in another adventurer's hands. Boss drops and quest rewards always get a unique model; only common starter weapons may share one. Named weapons carry a unique effect, not only bigger numbers. The first slice has about six blades, six bows and six staves.
   - **Costumes**: purely cosmetic outfits worn over your gear in a separate costume slot, so they never change stats. Adventurers buy them from a costume shop for in-game gold (never real money) or win them at GM-run events.
   - **Character creation** (owner direction 2026-11-12: personalising must be in-depth): four playable peoples that differ in looks only, sliders for body and face, hair and facial hair, free colour pickers, stance, walk and emotes, dye slots on armour, and a barber to change it later for gold.
   - **GM tools**: game masters can start an event, announce it to the server and award a costume or item to the winners.
10. **Online**: accounts (username and password, or play as guest), saved characters with a name the player chooses (no bad words, no impersonating staff or the heroes), chat, other players visible everywhere outside boss arenas. Death returns you to the statue with no item loss.

## Out of scope (later rounds, each with its own design)

Player homes and neighbourhoods (owner direction 2026-11-12; see the roadmap), Normandy (the capital), the wider continent, and the later-game sky region (floating islands, ships and crews, drifting islands, wind roads and gliding, player-drawn maps, trading, Wayglass echoes and duets), player-versus-player, further zones.

## Architecture

- **Client**: TypeScript, Babylon.js, built with Vite. Flat-shaded low-poly models with toon lighting and soft fog, matching `concepts/02-skybound/art.png`. Three quality levels so mid-range phones stay smooth.
- **Server**: Node.js with TypeScript and Colyseus. The server owns all game state; clients only send inputs. One room per zone, one room per boss arena. 15 updates per second, with the client smoothing movement between them.
- **Shared rules package**: combat maths, ability and item data live in one package used by both client and server, so they can never disagree.
- **Database**: PostgreSQL for accounts, characters, inventory and leaderboards. Passwords hashed with argon2.
- **Hosting**: Docker Compose on the Hetzner server on its own port, so the existing Shady Grove game keeps running beside it.
- **Address**: to begin with, players open the server's IP address and port directly over plain HTTP. Later it moves to `shadygrove2.mooo.com` with HTTPS (Caddy), which needs the DNS name pointed at the server; nothing in the game depends on which address is used.
- **Art**: everything is built in code for now (owner decision); bought or generated 3D model files may be revisited later. The statue is modelled specially.

## Error handling

- Dropped connection: the client reconnects automatically and the character stays in the world for 30 seconds.
- Inside a boss arena a disconnected player's slot is held for 2 minutes.
- The server rejects impossible inputs (speed, range, cooldowns).
- Characters are saved every 60 seconds and on logout.

## Testing

- Unit tests for combat rules in the shared package (damage, stagger, combos, boss scaling).
- A bot script that connects 100 simulated players and checks the server holds 15 updates per second.
- Browser smoke tests at phone, tablet and desktop sizes: log in, move, fight, form a party.
- A scripted solo run and a scripted 3-player run of the Fallen Warden to check tuning.
