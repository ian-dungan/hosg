# Kaetram: Windward — First Playable Slice (Design)

Date: 2026-11-11. Status: awaiting owner review.

## Goal

Prove that Windward feels like a next-gen sequel: a bright 3D world in the browser, deep combat, parties, and many players online together. This slice is the foundation every later round builds on. Story source: `concepts/02-skybound/PITCH.md`.

## Hard requirements

- Runs in a web browser on phones, tablets and computers. No install.
- 100 players online at once on the owner's Hetzner server.
- Ellie and Felix are the legendary heroes; their statue stands in the starting town.
- Fresh build. Nothing from the old game or the old HOSG code is reused.

## In scope

1. **Lanternrest**: the terraced sky-port, with the Plaza of the Two and the statue of Ellie (pointing) and Felix (spyglass).
2. **Opening quest, "The Solstice Crossing"**: talk to Old Marrow, watch the beam leave the statue and the Beacon island rise, meet Pim, take the ferry to the Beacon Shelf.
3. **The Beacon Shelf**: one combat zone with ordinary enemies, a few side quests, and the mega boss arena at the lighthouse.
4. **Controls**
   - Touch: virtual joystick to move, tap to target, ability buttons under the right thumb.
   - Computer: WASD to move, click to target, keys 1 to 5 for abilities.
   - Overhead three-quarter camera that rotates and zooms.
5. **Combat**
   - Tap-target lock-on with automatic basic attacks in range.
   - Loadout of 5 abilities chosen from a pool of about 12, including heals.
   - Stagger bar on bosses and elites: hit weak points or interrupt marked attacks to fill it; a break stuns and adds bonus damage.
   - Combos: one ability applies a state (Soaked, Burning, Marked), another cashes it in. Any two players' abilities combine.
   - Two weapon types with their own rhythm: Blade (parry) and Bow (charged shot).
   - Every dangerous attack is telegraphed on the ground and can be dodged.
   - No wind in combat.
6. **Parties**
   - Up to 4 players. Invite by tapping a player. Party health bars. Shared loot rolls.
   - No fixed classes: gear and loadout decide whether you lean damage, healing or tanking.
7. **Mega boss: the Lighthouse Warden**
   - Tuned for 3 average players. It does not get weaker for fewer players; a 4th player adds 25% health.
   - Three phases; each one changes the arena.
   - Fought in a private arena per party (or per solo player) so tuning stays fair.
   - No "party required" gate. Solo is possible with top gear and near-perfect play.
   - A solo kill grants a unique title and a place on the boss leaderboard.
8. **Progression**: levels 1 to 10, three gear tiers, abilities unlocked by level and quest.
9. **Online**: accounts (username and password, or play as guest), saved characters, chat, other players visible everywhere outside boss arenas. Death returns you to the statue with no item loss.

## Out of scope (later rounds, each with its own design)

Ships and crews, drifting islands, wind roads and gliding, player-drawn maps, trading, Wayglass echoes and duets, player-versus-player, further zones.

## Architecture

- **Client**: TypeScript, Babylon.js, built with Vite. Flat-shaded low-poly models with toon lighting and soft fog, matching `concepts/02-skybound/art.png`. Three quality levels so mid-range phones stay smooth.
- **Server**: Node.js with TypeScript and Colyseus. The server owns all game state; clients only send inputs. One room per zone, one room per boss arena. 15 updates per second, with the client smoothing movement between them.
- **Shared rules package**: combat maths, ability and item data live in one package used by both client and server, so they can never disagree.
- **Database**: PostgreSQL for accounts, characters, inventory and leaderboards. Passwords hashed with argon2.
- **Hosting**: Docker Compose on the Hetzner server with Caddy for HTTPS, on its own subdomain and port so the existing Kaetram game keeps running beside it.
- **Art**: models built in code or taken from CC0 low-poly packs, then recoloured to the Windward palette. The statue is modelled specially.

## Error handling

- Dropped connection: the client reconnects automatically and the character stays in the world for 30 seconds.
- Inside a boss arena a disconnected player's slot is held for 2 minutes.
- The server rejects impossible inputs (speed, range, cooldowns).
- Characters are saved every 60 seconds and on logout.

## Testing

- Unit tests for combat rules in the shared package (damage, stagger, combos, boss scaling).
- A bot script that connects 100 simulated players and checks the server holds 15 updates per second.
- Browser smoke tests at phone, tablet and desktop sizes: log in, move, fight, form a party.
- A scripted solo run and a scripted 3-player run of the Lighthouse Warden to check tuning.

## Open questions for the owner

1. Hetzner server size (CPU cores and RAM), and the web address to use.
2. Does "leave out the wind" cover only combat, or also wind roads and gliding in later rounds?
