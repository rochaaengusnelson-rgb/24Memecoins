# Market scenarios: One Night Only — Madison Square Garden, NYC

ARTIST NAME · coin live Fri 7:00 PM ET · show Fri 9:00 PM – Sat 12:30 AM ET · 19,500 seats · $500 owner seed · 24h window

200 seeded runs per scenario (seed 1) · SOL/USD $185 (constant) · pump.fun curve math with live mainnet (2026-11-12T14:23:57.826Z) parameters

Each cell shows the **median**, with the 10th–90th percentile range across runs in brackets. The **attendance value** line is the launch market cap ($6,134) + $1 per seat occupied. Traders watch it, but nothing forces the price onto it unless a market maker is running (S2).

## Who trades

- **Micro traders:** 2,000 wallets (fans in the building and online). Trades arrive at 0.4/min on an empty night, up to 9.4/min at a full house, plus a burst when the crowd leaves. Buys are lognormal, median $25 ($2–$500). They lean toward buying while people are arriving or the price is below the attendance value, and toward selling when people leave or the price runs above it. A seller up more than 30% sells everything; otherwise half.
- **W1, Doors sniper: buys at 7:00 PM, sells half at showtime and the rest mid-show:** budget ~$2,500 (±25% per run, timing ±10–20 min).
- **W2, Momentum: buys when arrivals surge, sells when the crowd starts leaving:** budget ~$1,500 (±25% per run, timing ±10–20 min).
- **W3, Front-runner: buys at full house, sells just before the headliner ends:** budget ~$2,000 (±25% per run, timing ±10–20 min).
- **W4, Late FOMO: buys late in the show, panic-sells after a 30% drop:** budget ~$3,000 (±25% per run, timing ±10–20 min).
- **Owner:** $500 first buy at Fri 7:00 PM; holds into the settlement burn unless the scenario says otherwise.

## Results

| | Scenario | Peak market cap | Market cap at window close | Off attendance value (avg) | Owner creator fees | Owner ROI (incl. fees) |
|---|---|---:|---:|---:|---:|---:|
| S1 | Organic market: micro traders + 4 whales, owner holds (burn at settlement) | $44,380 <sub>($40,498 to $49,147)</sub> | $8,923 <sub>($8,099 to $9,938)</sub> | 37.2% <sub>(32.3% to 43.2%)</sub> | $291 <sub>($280 to $302)</sub> | −40.1% <sub>(−42.2% to −37.7%)</sub> |
| S2 | Same, plus an attendance market maker ($4,000 budget incl. $1,500 inventory bought at launch, ±5% band, ≤$400/min) | $44,617 <sub>($40,401 to $49,523)</sub> | $8,286 <sub>($7,564 to $9,310)</sub> | 31.5% <sub>(27.5% to 37.5%)</sub> | $320 <sub>($307 to $331)</sub> | −34.4% <sub>(−37.0% to −32.1%)</sub> |
| S3 | Organic market, owner sells 100% mid-show (Fri 10:45 PM) | $42,287 <sub>($39,145 to $46,747)</sub> | $8,505 <sub>($7,751 to $9,321)</sub> | 35.1% <sub>(30.1% to 40.3%)</sub> | $301 <sub>($290 to $313)</sub> | +361.9% <sub>(+279.3% to +467.2%)</sub> |
| S4 | Organic market, owner sells 100% right before the crowd leaves (Sat 12:25 AM) | $44,380 <sub>($40,498 to $49,147)</sub> | $8,256 <sub>($7,657 to $9,061)</sub> | 36.5% <sub>(31.7% to 42.0%)</sub> | $296 <sub>($285 to $308)</sub> | +341.5% <sub>(+275.2% to +464.2%)</sub> |
| S5 | Micro traders only, no whales, owner holds (baseline) | $34,388 <sub>($33,002 to $35,799)</sub> | $9,304 <sub>($8,441 to $10,433)</sub> | 20.4% <sub>(17.9% to 22.7%)</sub> | $264 <sub>($253 to $273)</sub> | −45.4% <sub>(−47.5% to −43.5%)</sub> |

### Whales (P&L in USD; win rate = share of runs in profit)

| | W1 | W2 | W3 | W4 |
|---|---:|---:|---:|---:|
| S1 | $4,551 <sub>($4,050 to $5,133)</sub> · 100% win | $531 <sub>($140 to $1,121)</sub> · 98% win | −$348 <sub>(−$919 to −$91)</sub> · 4% win | −$1,072 <sub>(−$1,449 to −$843)</sub> · 0% win |
| S2 | $3,528 <sub>($2,497 to $4,666)</sub> · 100% win | $770 <sub>($443 to $1,407)</sub> · 100% win | −$317 <sub>(−$933 to −$105)</sub> · 6% win | −$1,082 <sub>(−$1,435 to −$829)</sub> · 0% win |
| S3 | $4,203 <sub>($3,597 to $4,861)</sub> · 100% win | $487 <sub>($68 to $1,000)</sub> · 93% win | −$414 <sub>(−$965 to −$171)</sub> · 3% win | −$1,035 <sub>(−$1,380 to −$845)</sub> · 0% win |
| S4 | $4,551 <sub>($4,050 to $5,133)</sub> · 100% win | −$42 <sub>(−$269 to $212)</sub> · 40% win | −$391 <sub>(−$1,250 to −$101)</sub> · 3% win | −$1,093 <sub>(−$1,454 to −$861)</sub> · 0% win |

### Micro traders and market maker

| | Micro P&L (all wallets) | Micro wallets in profit | Wallets that traded | Micro trades | Market maker P&L |
|---|---:|---:|---:|---:|---:|
| S1 | −$4,844 <sub>(−$5,467 to −$4,246)</sub> | 34% <sub>(30% to 38%)</sub> | 841 | 3,065 | — |
| S2 | −$4,532 <sub>(−$5,435 to −$3,508)</sub> | 37% <sub>(32% to 40%)</sub> | 832 | 3,068 | $239 <sub>(−$286 to $826)</sub> |
| S3 | −$6,054 <sub>(−$6,698 to −$5,344)</sub> | 32% <sub>(29% to 36%)</sub> | 864 | 3,059 | — |
| S4 | −$5,645 <sub>(−$6,381 to −$4,907)</sub> | 34% <sub>(30% to 38%)</sub> | 851 | 3,065 | — |
| S5 | −$1,120 <sub>(−$1,160 to −$1,076)</sub> | 37% <sub>(34% to 40%)</sub> | 905 | 3,061 | — |


## Takeaways

1. **Without a market maker, price follows the crowd only loosely.** In the organic market (S1) the price averages 37% off the attendance value. Peak market cap is a median $44,380 against an attendance peak of $25,334.
2. **A small market maker barely moves the price:** S2 averages 31% off the attendance value, against 37% without one. It sells its inventory into the hype rally and buys back when people leave. Median P&L $239, holding whatever it couldn't sell once the venue empties.
3. **Timing beats size among whales.** The best is W1 (doors-sniper: median $4,551, 100% of runs in profit). The worst is W4 (late-fomo: median −$1,072, 0% win). Whoever buys before the crowd arrives and sells before it leaves takes the move; late buyers fund it.
4. **Micro traders lose in aggregate** (S1 median −$4,844, 34% of wallets in profit). Without whales (S5) they lose −$1,120. Fees on ~3,065 trades plus buying high during the show are the cost.
5. **Owner exits:** selling mid-show (S3) returns a median +361.9%, and just before the crowd leaves (S4) +341.5%. Holding into the burn (S1) returns −40.1%: the burn wipes out the bag, and creator fees on the crowd's trading (median $291) recover part of the seed. Every owner sale lands on the same micro traders. If owners may sell, disclose it before launch, or lock the owner bag.

## Assumptions

- Trader behavior is a model with made-up but plausible parameters (see `src/model/market.ts`), not data. Change them and the numbers move; compare scenarios against each other rather than taking absolute values as forecasts.
- Tokens still held at window close are valued together at what selling all of them into the curve would return, split pro rata, so no paper gains are counted. Burned tokens are gone, which raises everyone else's share.
- No snipers or MEV in the same block as the launch, no outside news, and SOL/USD is constant.
- Attendance is the modeled profile in `events/msg-nyc-one-night.json`.
- Not financial advice.
