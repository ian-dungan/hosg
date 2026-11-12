# Putting Shady Grove 2 on the server

This guide is for the Ubuntu server at **116.203.110.214**. When you have finished it, players open
**http://116.203.110.214:2570** in a web browser.

## What this creates, and what it leaves alone

Shady Grove 2 runs in Docker as two containers, and it creates **only these things**:

| Name | What it is |
| --- | --- |
| `sg2-server` | container: the game server, which also serves the game page (memory limit 1 GB) |
| `sg2-db` | container: the PostgreSQL 16 database (memory limit 512 MB, never reachable from outside) |
| `sg2-pgdata` | Docker volume: the saved accounts and adventurers |
| `sg2-net` | Docker network: links the two containers |
| `sg2-server` | Docker image, built on this machine |

It does not stop, change or remove any other container. Your other games' containers (`ffxi-*`,
`sg-*`, `ac-*`) keep running. The names all start with `sg2-` (with a 2), so they never match `sg-*`.

The server uses about 100 MB of memory with 100 players online, and the database about 60 MB.

Every command below goes in a terminal on the server (log in with `ssh`). Lines that start with `$`
are commands: type what follows the `$`. Lines under them show what you should see.

## Before you start

1. Check that Docker and its compose plugin are installed:

   ```
   $ docker --version
   Docker version 27.x.x, build ...
   $ docker compose version
   Docker Compose version v2.x.x
   ```

   Any version number is fine. If `docker compose version` says `'compose' is not a docker command`,
   install the plugin with `sudo apt-get install docker-compose-plugin` and try again.
   If a Docker command answers `permission denied`, put `sudo ` in front of it (and of every later
   `docker` command too).

2. Check that nothing else uses port 2570:

   ```
   $ sudo ss -ltnp | grep ':2570 '
   ```

   This should print **nothing**. If it prints a line, another program has the port: choose another
   port (for example 2580) and use it in step 5 and everywhere this guide says 2570.

3. Check there is free memory:

   ```
   $ free -h
   ```

   In the `available` column of the `Mem:` row you want at least `2.0Gi`.

> **What has not been tested yet.** This guide was checked on a test machine, but:
>
> - the `Dockerfile` exactly as it is in the repository has never been built (only a slightly
>   changed copy that the test machine needed for its network);
> - downloading the base images from Docker Hub, and running on this server, are untested;
> - real iPhones and iPads (Safari) are untested; only a simulated iPhone was tried.
>
> So if step 6 fails the first time, nothing is broken: run
> `docker compose build 2>&1 | tail -n 30`, copy those last 30 lines, and send them to whoever
> maintains the game. Your other games are not affected.

## First installation

4. Download the game into a folder called `shady-grove-2` in your home folder:

   ```
   $ cd ~
   $ git clone https://github.com/ian-dungan/hosg.git shady-grove-2
   Cloning into 'shady-grove-2'...
   $ cd shady-grove-2
   ```

   If the online version has not been merged into the main branch yet, clone its branch instead:
   `git clone -b claude/kaetram-sequel-design-aduo3e https://github.com/ian-dungan/hosg.git shady-grove-2`.
   You can tell you have the right version when `ls` shows `docker-compose.yml` and a `deploy` folder.

5. Make the settings file `.env` and fill in its two secrets. Copy and paste these four lines exactly;
   each of the two `sed` lines puts a new random value into the file:

   ```
   $ cp .env.example .env
   $ sed -i "s/^SG2_JWT_SECRET=.*/SG2_JWT_SECRET=$(openssl rand -hex 32)/" .env
   $ sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
   $ chmod 600 .env
   ```

   Check that both were replaced:

   ```
   $ grep CHANGE-ME .env
   ```

   This should print **nothing**. If it prints a line, run the `sed` line for that setting again.

   - `SG2_JWT_SECRET` signs players' logins. `POSTGRES_PASSWORD` is the database password.
   - Never share `.env` or put it in Git (Git is already told to ignore it). Keep a copy somewhere
     safe: the `sg2-pgdata` volume only opens with the `POSTGRES_PASSWORD` it was made with.
     (Backups do not need it: a backup goes into any new database.)
   - The database password is set once, the first time the database starts. Changing it in `.env`
     later does not change the database's password, and the server could no longer log in.
   - If you chose another port in step 2, change the `SG2_PORT=2570` line in `.env` to it.

6. Build and start the game:

   ```
   $ docker compose up -d --build
   ```

   The first time, this downloads the base images and builds the game, which takes a few minutes.
   It ends with lines like these:

   ```
    ✔ Network sg2-net       Created
    ✔ Volume "sg2-pgdata"   Created
    ✔ Container sg2-db      Healthy
    ✔ Container sg2-server  Started
   ```

7. Check that it works. Wait about 30 seconds, then:

   ```
   $ docker compose ps
   NAME         IMAGE         ...   STATUS                    PORTS
   sg2-db       postgres:16   ...   Up 1 minute (healthy)     5432/tcp
   sg2-server   sg2-server    ...   Up 1 minute (healthy)     0.0.0.0:2570->2570/tcp
   ```

   Both should say `Up` and `(healthy)`. (Just after starting, `sg2-server` can say
   `(health: starting)` for up to a minute.) Then ask the server directly:

   ```
   $ curl http://localhost:2570/healthz
   {"ok":true,"players":0,"tickHz":15,"rssMb":85,"peakRssMb":85}
   ```

   `"ok":true` means the game server is running and its database works. `tickHz` is the number of
   updates a second it sends to players (15 when all is well); `rssMb` is its memory in MB.

   The server's own messages:

   ```
   $ docker compose logs sg2-server
   sg2-server  | Shady Grove 2 server listening on port 2570, serving /app/client/dist-online.
   sg2-server  | Shady Grove 2 server: SG2_TRUST_PROXY is off; login limits count each connection's own address.
   ```

   If something is wrong, this log says what in one line. For example
   `SG2_JWT_SECRET is too short` means step 5 was not finished: fix `.env`, then run
   `docker compose up -d` again.

8. Let players reach the port through the firewall. First see whether the `ufw` firewall is on:

   ```
   $ sudo ufw status
   Status: active
   ```

   If it says `Status: active`, open the port:

   ```
   $ sudo ufw allow 2570/tcp
   Rule added
   Rule added (v6)
   ```

   If it says `Status: inactive`, skip this. (Docker often makes published ports reachable even when
   `ufw` would block them, so the game may work without this rule; adding it does no harm.)
   If the server also has a firewall in the Hetzner Cloud Console (Firewalls), add an inbound rule
   there for TCP port 2570 as well.

9. On your own computer or phone, open **http://116.203.110.214:2570**. You should see the
   Shady Grove 2 login screen. Click **Play as guest** to try it: your adventurer appears in the
   plaza and the top right says `Adventurers online: 1`.

   If the page does not load from outside but step 7 worked, the port is still blocked: check
   step 8 (and the Hetzner firewall).

   When you invite players, tell them **not to use a password they use anywhere else** until the
   game has HTTPS (the last section of this guide): over plain `http://`, passwords are not encrypted.

10. Check that your other games are untouched:

    ```
    $ docker ps --format '{{.Names}}  {{.Status}}'
    ```

    Your `ffxi-*`, `sg-*` and `ac-*` containers should be listed as `Up` just as before, next to
    `sg2-server` and `sg2-db`. To see how much memory the game uses:

    ```
    $ docker stats --no-stream sg2-server sg2-db
    ```

## Everyday tasks

Run these from the game folder: `cd ~/shady-grove-2` first.

### Update to a new version

```
$ cd ~/shady-grove-2
$ git pull
$ docker compose up -d --build
```

Players are disconnected for a few seconds while the server restarts; adventurers are saved first.
Saved accounts and adventurers are kept. Afterwards, check with step 7.

**The update that brings jobs (database migration 004) is one-way.** It turns every adventurer's
Plan 3 weapon and picks into a job (the Blade becomes the Warrior, the Bow the Ranger) and from then
on the server saves only the jobs. So, for that update only:

1. Back up the database first (see "Back up the database" below).
2. Stop the game completely before updating (`docker compose down`), so no older server keeps
   saving while the new one migrates; then `git pull` and `docker compose up -d --build`.
3. Going back to a version from before jobs afterwards loses every job change and all job progress
   made since (the old server reads only the old weapon column, which is no longer written). To
   really go back, restore the backup from step 1 instead.

**The update that brings parties and the Fallen Warden (database migration 005) is not one-way.** It
only adds: three new adventurer columns (Warden's Seals, the day of the last Seal, titles) with
defaults, and a new `boss_kills` table for the leaderboard. Nothing existing is changed, and it is safe
to run again. So:

1. A backup first is still good practice (see "Back up the database" below), but no special steps are
   needed: `git pull` and `docker compose up -d --build` as usual.
2. Going back to an older version afterwards works: the older server ignores the new columns and the
   table. Seals, titles and leaderboard entries won while on the older version are simply not
   recorded, and come back into use when you update again.
3. Nobody is ever saved inside the Lampfall: an adventurer in a dungeon run is saved at the crater mouth
   in the Greenway, so a restart (or going back) puts it there.

**The update that brings gear, levels and looks (database migration 006) has no way back.** The
migration itself only adds: the inventory, its version, the look and the free creator visit as new
adventurer columns, two checks that gold and Seals never go below 0, and a `gm_audit` table. It also
changes the default of the jobs column for new rows. It never changes an existing adventurer's jobs.
But the new server moves each adventurer's job xp onto the new level curve the first time it joins
(no job loses a level), and from then on saves that xp marked as "on the new curve". An older server
does not know that mark: it drops it on its next save, and when you update again the xp would be
moved onto the new curve a second time (an adventurer could jump several levels). So, for this update:

1. Back up the database first (see "Back up the database" below).
2. `git pull` and `docker compose up -d --build` as usual.
3. **Do not go back** to a version from before this update. If you really must, restore the backup
   from step 1 instead (everything played since is lost), never just `git checkout` the older version.

**The update that brings the opening quest (database migration 008) is not one-way.** It only adds one
adventurer column, `quests` (each adventurer's quest progress), empty for everyone. Nothing existing is
changed, and it is safe to run again. An empty `quests` reads as the opening quest at its first step, so
every adventurer, new or old, starts The Solstice Crossing at Old Marrow on its next join; nothing is
written for it until the adventurer makes progress. Quest progress is only ever written together with the
inventory, in the same write as the reward it pays. So:

1. A backup first is still good practice (see "Back up the database" below), but no special steps are
   needed: `git pull` and `docker compose up -d --build` as usual.
2. Going back to an older version afterwards works: the older server ignores the column (and keeps
   saving the inventory without touching it). Quest progress made on the older version is simply not
   recorded, and the progress made before comes back into use when you update again. Rewards already paid
   (xp, gold, items, the title) are kept either way.

### Back up the database

```
$ cd ~/shady-grove-2
$ mkdir -p ~/sg2-backups && chmod 700 ~/sg2-backups
$ docker compose exec -T sg2-db pg_dump -U sg2 -d sg2 > ~/sg2-backups/sg2-backup-$(date +%F).sql
$ ls -lh ~/sg2-backups
```

The file (for example `~/sg2-backups/sg2-backup-2026-11-12.sql`) should be larger than 0 bytes.
Backups go in their own folder, outside the game folder, because they hold every account's
(scrambled) password: never put one in Git or share it. Copy them to another computer from time
to time, for example with `scp` from your own machine.

To restore a backup, it must go into an **empty** database, before the game server has started on
it (the server creates the tables the first time it starts). On a fresh installation, do this
instead of step 6 (any `POSTGRES_PASSWORD` works, a new one too):

```
$ docker compose up -d --wait sg2-db
$ docker compose exec -T sg2-db psql -q -U sg2 -d sg2 < ~/sg2-backups/sg2-backup-2026-11-12.sql
$ docker compose up -d --build
```

The `--wait` line ends with `Container sg2-db Healthy`. The `psql` line prints a short
`set_config` table; it worked if no line starts with `ERROR`. Then check with step 7.

### Make an account a GM

Game masters (GMs) can announce, give gold, items and costumes, teleport themselves, kick and run events,
by typing `/gm …` lines in the chat (`/gm help` lists them; nobody else sees those lines or the list).
The GM role can be given or taken away **only here, on the server's shell**: no web page, game message,
chat command or setting can do it, and a GM cannot make other GMs. Put the account's name where it says
`TheirName` (capital letters do not matter; guest accounts, called `Guest-` and six digits, cannot be GMs):

```
$ cd ~/shady-grove-2
$ docker compose exec sg2-server node server/dist/gm.js grant TheirName
TheirName is a game master now
```

To take the role away again (it works at once: the next `/gm` line is refused):

```
$ docker compose exec sg2-server node server/dist/gm.js revoke TheirName
TheirName is not a game master any more
```

`list` shows every GM account. Add `--by YourName` to a `grant` or `revoke` to record who did it
(the shell user is recorded as well). The tool never changes the database's tables (the server's update does). The tool reads the database address (`DATABASE_URL`) from the container's
environment, exactly as the game server does, so it needs no password typed in. Outside Docker (a
development machine), the same tool is `DATABASE_URL=… npm run gm -w server -- grant TheirName`.

**The GM audit log.** Every GM line (done or refused, including too-fast ones), the first refused `/gm` line
of the day from each account that is not a GM (only the command word, never the text), and every `grant` and `revoke` above is written to the `gm_audit` table in
the database: when, which account (empty for this shell tool), the command, its target, what was typed
and the result. Costumes given with `/gm event award` are marked as event grants there, with the event's
title. The table only grows: the database refuses to change or delete its rows (update 007 adds that
guard), and no GM command can touch it. To read the newest 50 rows (or another number up to 1000):

```
$ docker compose exec sg2-server node server/dist/gm.js audit 50
```

or with `psql`: `docker compose exec sg2-db psql -U sg2 -d sg2 -c "SELECT * FROM gm_audit ORDER BY id DESC LIMIT 50;"`.
Backups (see above) include it.

**Known limits of the audit log.** The append-only rule is a database trigger. In the shipped
`docker-compose.yml` the game server connects as `sg2`, the database's owner and a superuser, so anyone
with that password on the server's shell could still drop the trigger and edit the table. If you want the
log protected even from that account, split the roles (do it once, after a backup; this does not change
the compose file's credentials, which you would edit yourself afterwards):

```
$ docker compose exec sg2-db psql -U sg2 -d sg2
sg2=# CREATE ROLE sg2_app LOGIN PASSWORD 'pick-a-long-random-password';
sg2=# GRANT CONNECT ON DATABASE sg2 TO sg2_app;
sg2=# GRANT USAGE ON SCHEMA public TO sg2_app;
sg2=# GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO sg2_app;
sg2=# GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sg2_app;
sg2=# REVOKE UPDATE, DELETE, TRUNCATE ON gm_audit FROM sg2_app;
sg2=# GRANT SELECT, INSERT ON gm_audit TO sg2_app;
```

Then the game server's `DATABASE_URL` would use `sg2_app`, and migrations (which need the owner) would be
run by `sg2` before each update. The shipped setup keeps one role for simplicity; with it, the trigger
guards against mistakes and against everything the game itself can do, not against the database's owner.

**Limits:** each GM may run 20 commands a minute; there is one announcement every 30 seconds for the whole
server; each GM may give at most 100 000 gold a day (10 000 at a time; items count at their sell value), never past an adventurer's purse
limit; items need a free bag slot (a full bag is refused, and nothing is lost). Announcements are plain text
of at most 200 characters.

### Stop the game, or go back to an earlier version

Stop the game (the saved accounts and adventurers stay in the `sg2-pgdata` volume):

```
$ docker compose down
```

This removes only `sg2-server`, `sg2-db` and `sg2-net`. Start it again with `docker compose up -d`.

If a new version misbehaves, go back to the one before (but not back across the jobs update, nor
across the gear, levels and looks update: see "Update to a new version"):

```
$ git log --oneline -5          # the newest version is on top; copy the code of the one below it
$ git checkout <that code>
$ docker compose up -d --build
```

When a fixed version is out, return to the latest one with `git checkout -` (or the branch name,
as in step 4) and then `git pull && docker compose up -d --build`.

Things **not** to do, because they delete data:

- `docker compose down -v` deletes the `sg2-pgdata` volume, which holds every account and adventurer.
  Use it only to remove the game completely, after a backup.
- `docker system prune -a` or `docker volume prune` can also delete other games' images and data.

### Remove the game completely

```
$ cd ~/shady-grove-2
$ docker compose down -v
$ docker image rm sg2-server
$ sudo ufw delete allow 2570/tcp     # only if you added the rule in step 8
```

## Later: a web address with HTTPS (shadygrove2.mooo.com)

The first installation works on the IP address only, and nothing depends on a domain name. When
you want players to use **https://shadygrove2.mooo.com** instead, follow these steps in order.
Caddy, a small web server, then sits in front of the game: it gets the HTTPS certificate by itself
and passes everything, the game's live connection too, on to the game server.

1. At FreeDNS (mooo.com), point `shadygrove2.mooo.com` at `116.203.110.214` (an `A` record).
   Wait a few minutes, then check it from the server:

   ```
   $ getent hosts shadygrove2.mooo.com
   116.203.110.214  shadygrove2.mooo.com
   ```

   Do not go on until it prints `116.203.110.214`.

2. Caddy needs ports 80 and 443. Check what uses them:

   ```
   $ sudo ss -ltnp | grep -E ':(80|443) '
   ```

   - If that prints **nothing**, install Caddy (see https://caddyserver.com/docs/install, the
     "Debian, Ubuntu" section), then replace the contents of `/etc/caddy/Caddyfile` with these
     three lines:

     ```
     shadygrove2.mooo.com {
         reverse_proxy 127.0.0.1:2570
     }
     ```

     and run `sudo systemctl reload caddy`.
   - If another game's web server already uses ports 80/443, do not install a second one: add the
     same `reverse_proxy 127.0.0.1:2570` site to that web server instead. If that web server itself
     runs in a Docker container, it cannot reach `127.0.0.1` on the server: stop here and ask for help.

   (If you chose another port in step 2 of the first installation, put it in place of 2570 here and
   in step 4.)

3. If `ufw` is active, allow the web ports:

   ```
   $ sudo ufw allow 80/tcp
   $ sudo ufw allow 443/tcp
   ```

   In the Hetzner Cloud Console firewall (if you use one), add inbound rules for TCP 80 and 443 too.

4. Tell the game it is behind Caddy, and close the plain port to the internet, **both in this one
   step**. Run these lines from the game folder:

   ```
   $ cd ~/shady-grove-2
   $ sed -i 's/^SG2_PORT=.*/SG2_PORT=127.0.0.1:2570/' .env
   $ sed -i '/^SG2_TRUST_PROXY=/d' .env
   $ echo 'SG2_TRUST_PROXY=1' >> .env
   $ grep -E '^SG2_(PORT|TRUST_PROXY)=' .env
   SG2_PORT=127.0.0.1:2570
   SG2_TRUST_PROXY=1
   $ docker compose up -d
   ```

   `SG2_TRUST_PROXY=1` makes the login limit count each player's own address, which Caddy passes on,
   instead of Caddy's (otherwise all players together would share one limit of 10 sign-ins a
   minute). `SG2_PORT=127.0.0.1:2570` is not optional: with the setting on and the port still open
   to the internet, anyone could connect directly with a made-up address and dodge the login limit.

   Then remove the old firewall rule (and the Hetzner rule for port 2570, if you added one):

   ```
   $ sudo ufw delete allow 2570/tcp
   ```

5. Check it:

   ```
   $ docker compose ps
   NAME         IMAGE         ...   STATUS                    PORTS
   sg2-server   sg2-server    ...   Up 1 minute (healthy)     127.0.0.1:2570->2570/tcp
   $ docker compose logs sg2-server | grep TRUST
   sg2-server  | Shady Grove 2 server: SG2_TRUST_PROXY=1; login limits count the address the proxy forwards.
   ```

   The `PORTS` column must start with `127.0.0.1:`. Open **https://shadygrove2.mooo.com**: you
   should see the login screen with a padlock in the address bar. **http://116.203.110.214:2570**
   no longer works from outside; that is expected.

To go back to the IP address, undo step 4: set `SG2_PORT=2570`, delete the `SG2_TRUST_PROXY=1`
line, run `docker compose up -d`, and open the port again as in step 8 of the first installation.
