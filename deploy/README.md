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

Put the account's name where it says `TheirName` (capital letters do not matter):

```
$ docker compose exec sg2-db psql -U sg2 -d sg2 -c "UPDATE accounts SET is_gm = true WHERE lower(username) = lower('TheirName');"
UPDATE 1
```

`UPDATE 1` means it worked; `UPDATE 0` means no account has that name (guest accounts are called
`Guest-` and six digits). To take GM away again, run the same line with `false` instead of `true`.

### Stop the game, or go back to an earlier version

Stop the game (the saved accounts and adventurers stay in the `sg2-pgdata` volume):

```
$ docker compose down
```

This removes only `sg2-server`, `sg2-db` and `sg2-net`. Start it again with `docker compose up -d`.

If a new version misbehaves, go back to the one before:

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

## Later: a web address with HTTPS (shadygrove2.mooo.com) — NOT READY, do not follow yet

> **Do not follow this section yet.** Behind Caddy, the game server would see every player as
> coming from the same address, so its login limit (10 sign-ins a minute) would be shared by all
> players together and most of them could not sign in. A later update of the game will fix this,
> and this section will then say it is ready. Until then, use http://116.203.110.214:2570.

The first installation works on the IP address only, and nothing depends on a domain name. The
outline below is kept so you can see what the switch will involve; **do not follow it yet**.

1. At FreeDNS (mooo.com), point `shadygrove2.mooo.com` at `116.203.110.214` (an `A` record).
   Check it from the server: `getent hosts shadygrove2.mooo.com` should print `116.203.110.214`.
2. Caddy will need ports 80 and 443. Check what uses them:
   `sudo ss -ltnp | grep -E ':(80|443) '`.
   - If that prints **nothing**, install Caddy (see https://caddyserver.com/docs/install, the
     "Debian, Ubuntu" section), then replace the contents of `/etc/caddy/Caddyfile` with:

     ```
     shadygrove2.mooo.com {
         reverse_proxy localhost:2570
     }
     ```

     and run `sudo systemctl reload caddy`. Caddy gets the HTTPS certificate by itself and passes
     the game's WebSocket connections through.
   - If another game's web server already uses ports 80/443, do not install a second one: add the
     same `reverse_proxy localhost:2570` site to that web server instead.
3. If `ufw` is active, allow the web ports: `sudo ufw allow 80/tcp` and `sudo ufw allow 443/tcp`.
4. Open **https://shadygrove2.mooo.com**; you should see the login screen.
5. Optional, once the address works: stop offering the plain port to the internet. In `.env`,
   change the port line to `SG2_PORT=127.0.0.1:2570`, run `docker compose up -d`, and remove the
   firewall rule with `sudo ufw delete allow 2570/tcp`. Caddy still reaches the game on the server
   itself, but http://116.203.110.214:2570 stops working from outside.
