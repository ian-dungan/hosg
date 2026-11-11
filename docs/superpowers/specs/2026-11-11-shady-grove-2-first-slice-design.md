# Shady Grove 2 — First Playable Slice (Design)

Date: 2026-11-11. Status: awaiting owner review.

## Goal

Prove that Shady Grove 2 feels like a next-gen sequel: a bright 3D world in the browser, deep combat, parties, and many players online together. This slice is the foundation every later round builds on. Story source: `concepts/02-skybound/PITCH.md`.

## World shape

The player starts on solid ground. The first game was a small corner of a much larger continent, which is the main game. The floating islands are the endgame: they are where Ellie and Felix went, visible in the sky from the opening quest and reached only late.

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
   - Gliding is saved for the sky endgame.
6. **Combat**
   - Tap-target lock-on with automatic basic attacks in range.
   - Loadout of 5 abilities chosen from a pool of about 12, including heals.
   - Stagger bar on bosses and elites: hit weak points or interrupt marked attacks to fill it; a break stuns and adds bonus damage.
   - Combos: one ability applies a state (Soaked, Burning, Marked), another cashes it in. Any two players' abilities combine.
   - Two weapon types with their own rhythm: Blade (parry) and Bow (charged shot).
   - Every dangerous attack is telegraphed on the ground and can be dodged.
   - Wind is not a standing combat mechanic. A few set-piece battles may use it as their special twist, where it is done well.
7. **Parties**
   - Up to 4 players. Invite by tapping a player. Party health bars. Shared loot rolls.
   - No fixed classes: gear and loadout decide whether you lean damage, healing or tanking.
8. **Mega boss: the Fallen Warden** (a stone-and-brass lighthouse keeper that fell from the Beacon)
   - Tuned for 3 average players. It does not get weaker for fewer players; a 4th player adds 25% health.
   - Three phases; each one changes the arena.
   - Fought in a private arena per party (or per solo player) so tuning stays fair.
   - No "party required" gate. Solo is possible with top gear and near-perfect play.
   - A solo kill grants a unique title and a place on the boss leaderboard.
9. **Progression**: levels 1 to 10, three gear tiers, abilities unlocked by level and quest.
   - **Visible gear**: what you equip shows on your character and is seen by every other player. Slots: head, chest, legs, feet, hands, back (cape or pack), main weapon and off-hand. The first slice has three looks per slot, one per gear tier. A separate appearance slot lets you keep a look you like while wearing better stats.
10. **Online**: accounts (username and password, or play as guest), saved characters, chat, other players visible everywhere outside boss arenas. Death returns you to the statue with no item loss.

## Out of scope (later rounds, each with its own design)

Normandy (the capital), the wider continent, and the endgame sky region (floating islands, ships and crews, drifting islands, wind roads and gliding, player-drawn maps, trading, Wayglass echoes and duets), player-versus-player, further zones.

## Architecture

- **Client**: TypeScript, Babylon.js, built with Vite. Flat-shaded low-poly models with toon lighting and soft fog, matching `concepts/02-skybound/art.png`. Three quality levels so mid-range phones stay smooth.
- **Server**: Node.js with TypeScript and Colyseus. The server owns all game state; clients only send inputs. One room per zone, one room per boss arena. 15 updates per second, with the client smoothing movement between them.
- **Shared rules package**: combat maths, ability and item data live in one package used by both client and server, so they can never disagree.
- **Database**: PostgreSQL for accounts, characters, inventory and leaderboards. Passwords hashed with argon2.
- **Hosting**: Docker Compose on the Hetzner server with Caddy for HTTPS, on its own subdomain and port so the existing Shady Grove game keeps running beside it.
- **Art**: models built in code or taken from CC0 low-poly packs, then recoloured to the game palette. The statue is modelled specially.

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

## Open questions for the owner

1. The web address to use. (Server: Ubuntu, 16 GB RAM, which is enough.)
