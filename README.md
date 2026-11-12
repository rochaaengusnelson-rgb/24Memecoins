# eventcoins

Launch a **24-hour event coin on pump.fun** where:

- the **event owner funds the launch** with a USD amount ($500 by default) as the coin's first buy on the bonding curve,
- a **Switchboard SOL/USD feed** converts that $500 into the exact SOL amount at launch time,
- a **Switchboard attendance feed** (seats filled across every venue) is the coin's oracle: it can gate the launch, it's shown live during the 24h window, and at the end it decides how much of the owner's bag gets **burned**.

## Example: arena show + NYC simulcast

`events/example-la-arena-nyc-broadcast.json`. An artist plays an LA arena and the show is broadcast live to 35 NYC theaters:

| Venue | Locations | Seats |
|---|---|---|
| LA Arena (main show) | 1 | 20,000 (placeholder, set the real capacity) |
| NYC theater simulcast | 35 | 4,000 total |
| **Total** | | **24,000** |

Flow:

1. **Launch** at showtime. The owner's wallet creates the coin and buys ~$500 of it in a single transaction (`create_v2` + buy via the official `@pump-fun/pump-sdk`).
2. **24h window.** The attendance feed reports seats filled (arena check-ins + theater check-ins). `status` shows the live fill rate.
3. **Settle** after 24h. Read the final attendance, compute `fill = seatsFilled / 24,000`, then burn `fill × burnShareAtFullHouse` of the owner's tokens. A sold-out night burns the owner's whole bag, which shrinks supply for holders. A half-empty night burns half.

> pump.fun has no "deposit into the pool" option. Liquidity on a pump.fun coin is the bonding curve, and the creator's first buy is how an owner puts money in. On pump.fun the $500 therefore goes in as a first buy. Once the curve fills, pump.fun migrates it to PumpSwap automatically.

## The oracles

### SOL/USD (sizing the $500)
Set `SB_SOL_USD_FEED` to a Switchboard On-Demand SOL/USD pull feed (find one on the Switchboard explorer). Launch refuses to run if the value is older than `SB_MAX_PRICE_AGE_SEC`.

### Attendance (the event oracle)
`feeds/attendance-job.json` is a Switchboard OracleJob template. Oracles fetch your ticketing/check-in endpoint and report `seatsFilled` as one number covering all venues. Create a pull feed with that job, then put its pubkey in `oracle.attendanceFeed`.

Pull feeds only update when someone pushes an update. During the event, run a crank (Switchboard's crank service, or a cron that calls `PullFeed.fetchUpdateIx`) every few minutes. The CLI refuses to act on a value older than `oracle.maxAgeSec`.

The endpoint is the trust point: whoever controls it controls the oracle. Use the venue/ticketing provider's API (scans at the door, theater POS counts) rather than a number the artist's team types in.

## Usage

```bash
npm install
```

```bash
cp .env.example .env   # set RPC_URL, OWNER_KEYPAIR, SB_SOL_USD_FEED
```

```bash
npm run quote -- events/example-la-arena-nyc-broadcast.json
```

```bash
npm run launch -- events/example-la-arena-nyc-broadcast.json --dry-run
```

```bash
npm run launch -- events/example-la-arena-nyc-broadcast.json
```

```bash
npm run status -- events/example-la-arena-nyc-broadcast.json
```

```bash
npm run settle -- events/example-la-arena-nyc-broadcast.json
```

### Live dry run (no keys, no SOL)

```bash
npm run dryrun -- events/example-la-arena-nyc-broadcast.json --network mainnet --sol-usd 185 --seats 23180
```

```bash
npm run dryrun -- events/example-la-arena-nyc-broadcast.json --network devnet --sol-usd 185 --seats 13908
```

Reads the live pump.fun `Global` + `FeeConfig`, builds the real create_v2 + first buy, and runs it through `simulateTransaction` against the real pump.fun program on mainnet or devnet. Signature checks are off, so a funded wallet (the fee payer of a recent pump.fun trade) stands in for the event owner. Nothing is signed or sent. The run reports success or failure, compute units, the instructions executed, tokens received, SOL spent and the settlement burn. Each run writes a JSON report to `state/dryrun/`.

- Devnet's pump.fun curve is 100× smaller (0.3 vs 30 virtual SOL), so the dry run scales the seed to buy the same share of supply.
- `--sol-usd` is used only when the Switchboard SOL/USD feed (`SB_SOL_USD_FEED` / `--sb-feed`) is stale. In Nov 2026 every classic SOL/USD pull feed on mainnet was weeks stale and the Switchboard crossbar was unreachable, so a real launch needs a feed you crank yourself.
- `--seats` stands in for the attendance feed until one exists.
- With a real-length IPFS URI the transaction is 1,248 bytes. A lookup table can only be simulated once it exists on chain, so the dry run shortens the URI to fit and reports the real size.

Cloud environment: the `24Memecoins` Claude Code environment allows `api.mainnet-beta.solana.com`, `api.devnet.solana.com`, `pump.fun` and `crossbar.switchboard.xyz`, and runs `npm ci` at startup. Node's networking only goes through the proxy with `NODE_USE_ENV_PROXY=1`, which the npm scripts set.

### ROI scenarios (value pegged to attendance, launch at $0)

```bash
npm run roi -- events/msg-nyc-one-night.json --sol-usd 185
```

The coin goes live at `launchAt` (before the show, e.g. doors; defaults to `startsAt`) with 0 seats counted, and its window runs from there. Market cap = launch market cap + `rules.pegUsdPerSeat` (default $1) × seats occupied, so the attendance value starts at $0 and moves $1 per person entering or leaving. A literal $0 price isn't possible on pump.fun: a fresh curve opens at ~$5.2k market cap and the owner's $500 seed takes it to ~$6.1k, so that level is the zero line. The crowd trades on the pump.fun curve math (live mainnet Global and fee rates, checked against the SDK) to hold that peg every minute. Owner ROI is compared across five cases: sell mid-show, sell just before the crowd leaves, a 50/50 split, hold with the burn, and hold without it. Writes `reports/<event>-roi.md`, `reports/<event>-roi-chart.html` (seats and attendance value on one time axis, owner-sale price drops, hover readout, light/dark), a 5-minute timeline CSV and a summary JSON.

### Market scenarios (micro traders + whales, Monte Carlo)

```bash
npm run market -- events/msg-nyc-one-night.json --runs 200 --sol-usd 185 --seed 1
```

Agent-based market on the pump.fun curve math, around the event's attendance profile:
- ~2,000 micro-trader wallets (lognormal $2–$500 trades). They buy as people arrive or when the price is below the attendance value, sell as people leave or when it's above, and take profits.
- Four whales: doors sniper, momentum, front-runner, late FOMO. Timing and size are randomized each run.
- An optional attendance market maker, and the owner.

Five scenarios: organic, organic + market maker, owner sells mid-show, owner sells before the crowd leaves, and micro traders only. Each reports the median and 10th–90th percentile range across seeded runs for market cap, distance from the attendance value, owner ROI (with creator fees shown separately), each whale's P&L and win rate, and micro-trader P&L. Writes `reports/<event>-market.md`, `-market-chart.html` (median and percentile band against the attendance value, with one sample run's whale and owner trades) and `-market-summary.json`. Behavior parameters live in `src/model/market.ts`.

### Offline simulation

```bash
npm run sim
```

Runs the whole lifecycle (quote → launch → 24h status → settle) for two scenarios, a near sell-out and a soft night, plus the guard-rail refusals. It uses the real event config, sizing math, pump.fun SDK instruction builder, transaction signing and burn instruction. Only the chain is mocked: pump.fun's Global parameters, the Switchboard feed values on a scripted check-in timeline, the wallet and the clock. Nothing is sent.

`launch` uploads the image + metadata to pump.fun's IPFS endpoint (or pass `--uri`), checks the owner holds the seed amount plus ~0.05 SOL for rent and fees, then sends the create+buy. With a real IPFS metadata URI, create+buy comes to ~1,248 bytes, over Solana's 1,232-byte limit. `launch` therefore first creates an address lookup table for that launch (one extra tx, ~0.003 SOL rent), then sends create+buy atomically at ~631 bytes. Launch info goes to `state/<event-id>.json`, which `status` and `settle` read.

## Event config

| Field | Meaning |
|---|---|
| `venues[]` | name, city, `locations` (e.g. 35 theaters), `seats`. Capacity = sum of seats |
| `funding.usd` | owner's seed, default 500 |
| `funding.slippageBps` | SOL headroom over the quote + min-token slippage on the buy |
| `oracle.attendanceFeed` | Switchboard pull feed pubkey for seats filled |
| `rules.windowHours` | coin window, default 24 |
| `rules.minSeatsToLaunch` | launch gate on the attendance feed |
| `rules.burnShareAtFullHouse` | share of the owner bag burned at 100% fill |

## Layout

```
src/cli.ts                 quote / launch / status / settle
src/event.ts               event schema (zod) + capacity
src/math.ts                USD→lamports, fill rate, burn amount, window (unit-tested)
src/oracle/switchboard.ts  read + staleness-check Switchboard pull feeds
src/pumpfun/metadata.ts    pump.fun IPFS upload
src/pumpfun/launch.ts      create_v2 + first buy, signed by owner + fresh mint
src/dryrun.ts              live simulateTransaction dry run (mainnet/devnet)
src/roi.ts                 ROI scenarios with an attendance-pegged price
src/report/chart.ts        self-contained HTML time chart for the ROI report
src/market.ts              Monte Carlo market scenarios (micro traders, whales, market maker)
src/model/market.ts        agent-based market simulation
src/model/pump.ts          live pump.fun params + fresh curve
src/report/marketChart.ts  small-multiple fan charts for market scenarios
src/model/curve.ts         pump.fun bonding-curve math (buy/sell/fees)
src/sim/run.ts             offline lifecycle simulation (mocked chain)
src/settle.ts              owner bag lookup + burn (Token-2022 aware)
feeds/attendance-job.json  Switchboard job template
```

## Notes

- Settlement is a promise the owner keeps by running `settle` with their own key. To make the burn trustless, move the owner's tokens into an escrow program that reads the attendance feed on-chain and burns at the end of the window. That program is the natural next step.
- Meme coins are speculative, and launching one tied to a real artist needs that artist's permission and should go through legal/compliance review.
