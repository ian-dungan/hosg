# Load test: 100 adventurers in the grove

`server/scripts/bots.ts` signs in `--count` guest adventurers, has each walk in random legal steps
at the server's update rate (15 a second, at running speed) and say a chat line every 20 seconds, then
prints what it measured. It exits with status 1 unless every bot stayed connected, the mean
state-update rate the bots saw was at least 14 a second, and no bot had a step corrected.

## How to run it

1. Start a server. For this test only, raise the login limit: by default the server allows 10
   logins per IP address a minute, and all bots sign in from the same address.

   ```sh
   SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_AUTH_RATE_PER_MIN=1000 npm start -w server
   ```

   Do not leave `SG2_AUTH_RATE_PER_MIN` raised on a public server: the limit is what slows down
   password guessing.

2. In a second terminal:

   ```sh
   npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 60
   ```

The bots stand still for a little over a second after joining (a new session starts with only 0.5 m
of movement banked), then measure for `--seconds` after all of them have joined.
`/healthz` reports the server's own measured patch rate over the last 5 seconds (`tickHz`) and its
memory (`rssMb` now, `peakRssMb` the most it has held), which the script samples every second.

## Results

2026-11-11, development sandbox (4 CPU cores, 16 GB RAM), server and bots on the same machine,
`SG2_STORE=memory`, server run with `tsx server/src/index.ts`:

```
players: 100
patch rate seen by bots: mean 15.12 Hz, min 15.12 Hz (over 60.0 s)
server patch rate (/healthz, 5 s window): min 15 Hz, max 15.2 Hz
server peak RSS: 117 MB
corrections: 0; disconnected bots: 0; chat lines heard: 30800
PASS
```

Exit status 0. The rate is slightly above 15 because Node runs the 66.7 ms patch timer every 66 ms.
No server changes were needed to pass.
