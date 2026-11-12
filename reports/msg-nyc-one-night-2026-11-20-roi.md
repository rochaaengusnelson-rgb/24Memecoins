# ROI report: One Night Only — Madison Square Garden, NYC

ARTIST NAME · Fri 9:00 PM – Sat 12:30 AM ET · 19,500 seats · $500 owner seed · 24h coin window

Generated 2026-11-12T13:45:08.875Z · SOL/USD **$185** (held constant) · pump.fun parameters: live mainnet (2026-11-12T13:45:08.758Z)

## How price is tied to attendance

- **Peg (1:1):** coin price = launch price × seats occupied ÷ 17,650 (seats at launch). +1% seats → +1% price, −1% seats → −1% price.
- Launch price is set by the owner's $500 buy on a fresh pump.fun curve: **$6,133.82 market cap**. At the 19,200-seat peak (98.5% full) the peg is +8.8%: **$6,672.49**.
- Every minute, the crowd buys or sells on the real curve exactly enough to hold the peg. This is the model's assumption; on pump.fun, price is set by whoever trades. Holding a 1:1 peg in production needs a market maker or program that trades against the Switchboard attendance feed.
- Seats are **occupancy** (people in the building), so price falls as the crowd leaves. The pump.fun curve can't trade below the price where every holder but the owner has sold, so after the venue empties the price sits at that floor rather than at $0.
- Fees: 95 bps protocol + 30 bps creator on every trade (live). The owner is the coin creator and earns the creator fee on all crowd volume.
- Curve model checked against the pump.fun SDK: first buy 87,672,352 vs SDK 87,672,352 tokens (0.0000% diff); selling that bag 2.635969 vs SDK 2.635969 SOL (0.0000% diff).

## Attendance → price (peg)

| Time (ET) | Seats occupied | Fill | Peg vs launch | Market cap at peg |
|---|---:|---:|---:|---:|
| Fri 9:00 PM (launch) | 17,650 | 90.5% | +0.0% | $6,133.82 |
| Fri 9:20 PM | 18,500 | 94.9% | +4.8% | $6,429.22 |
| Fri 10:00 PM | 19,200 | 98.5% | +8.8% | $6,672.49 |
| Fri 10:45 PM (mid-show) | 19,200 | 98.5% | +8.8% | $6,672.49 |
| Sat 12:25 AM (before crowd leaves) | 19,200 | 98.5% | +8.8% | $6,672.49 |
| Sat 12:30 AM (headliner ends) | 18,700 | 95.9% | +5.9% | $6,498.73 |
| Sat 12:40 AM | 11,500 | 59.0% | -34.8% | $3,996.54 |
| Sat 12:50 AM | 5,000 | 25.6% | -71.7% | $1,737.63 |
| Sat 1:00 AM | 1,800 | 9.2% | -89.8% | $625.55 |
| Sat 1:30 AM | 0 | 0.0% | -100.0% | $0.00 |

## Owner ROI by scenario

Owner cost: 2.7027 SOL seed ($500.00) + 0.0092 SOL account rent = **$501.70**. The owner bag is 87,672,352 tokens (8.77% of supply).

| | Scenario | Sale proceeds | Creator fees | Bag left (value) | Owner total | **Owner ROI** | Crowd net |
|---|---|---:|---:|---:|---:|---:|---:|
| A | Owner sells 100% mid-show (Fri 10:45 PM) | $528.62 | $6.25 | — | $534.87 | **+6.6%** ($33.17) | -$60.85 |
| B | Owner sells 100% right before the crowd leaves (Sat 12:25 AM) | $528.62 | $6.25 | — | $534.87 | **+6.6%** ($33.17) | -$60.85 |
| C | Owner sells 50% mid-show, 50% before the crowd leaves | $552.06 | $6.39 | — | $558.46 | **+11.3%** ($56.76) | -$84.88 |
| D | Owner holds; settlement burn at peak fill (baseline rules) | $0.00 | $1.56 | 1,350,154 ($8.17) | $9.73 | **-98.1%** (-$491.98) | -$6.49 |
| E | Owner holds, no burn; sells at window close (reference) | $487.65 | $3.04 | — | $490.69 | **-2.2%** (-$11.01) | -$6.49 |

"Crowd net" is what everyone else, all buyers together, ends with: SOL out − SOL in + the value of tokens still held. The owner's exit, every fee and the crowd's P&L account for all the SOL that moved.

## What each owner sale does to the price

| | Sale | Time (ET) | Tokens sold | Proceeds | Price drop vs peg | Crowd SOL to restore the peg |
|---|---|---|---:|---:|---:|---:|
| A | mid-show | Fri 10:45 PM | 87,672,352 | $528.62 | -16.3% | $542.01 |
| B | before crowd leaves | Sat 12:25 AM | 87,672,352 | $528.62 | -16.3% | $542.01 |
| C | mid-show | Fri 10:45 PM | 43,836,176 | $276.03 | -8.7% | $283.02 |
| C | before crowd leaves | Sat 12:25 AM | 43,836,176 | $276.03 | -8.7% | $283.02 |
| E | window close | Sat 9:00 PM | 87,672,352 | $487.65 | n/a (peg is $0, venue empty) | — (venue empty, no peg left to defend) |

## Settlement

- **A:** nothing to burn: the owner already sold the whole bag, so holders don't get the attendance burn.
- **B:** nothing to burn: the owner already sold the whole bag, so holders don't get the attendance burn.
- **C:** nothing to burn: the owner already sold the whole bag, so holders don't get the attendance burn.
- **D:** burns 86,322,198 tokens (98.5% peak fill × 1); owner keeps 1,350,154.

## Takeaways

1. **A 1:1 peg caps the price.** Seats can only rise from 17,650 at launch to 19,500 (+10.5% max). This show peaks at +8.8%. Every trade pays about 125 bps in fees.
2. **Mid-show (A) and just before the crowd leaves (B) pay the same: +6.6%.** Occupancy is flat at 19,200 from Fri 10:00 PM until Sat 12:25 AM, so both sales hit the same peg price. The window to sell closes at Sat 12:30 AM: ten minutes later the peg is down 40.1% from peak.
3. **Splitting the exit (C) beats one dump: +11.3% vs +6.6%.** Each half moves the price -8.7% instead of -16.3%. Buyers restore the peg between the sales, so the second half also sells at the peak. That extra gain comes from the crowd (crowd net -$84.88 vs -$60.85).
4. **Holding under the burn rule (D) costs the owner -98.1%.** That is the design: the seed pays for a burn that rewards holders. Without a burn (E), the owner exits at -2.2% after the venue empties: fees, offset by creator-fee income.
5. **An owner sale breaks the attendance peg and removes the burn.** The owner holds 8.8% of supply. In A–C the price drops below the peg until buyers spend $542.01 to restore it, and settlement has nothing left to burn. If owners can sell, say so up front, or lock the owner bag in an escrow that only settlement can release.

## Assumptions

- Attendance is the modeled occupancy profile in `events/msg-nyc-one-night.json`; it has to come from a real Switchboard feed (door scans / exits) before launch.
- SOL/USD stays at $185 throughout. No other traders, bots or snipers: crowd trades are exactly what holds the peg.
- The settlement burn uses peak occupancy (19,200), the event's attendance count, because occupancy is 0 by the time the window closes.
- Creator fees are counted on crowd trades only, and claimable by the owner whether or not they sold.
- Not financial advice. This models one rule set; real markets won't hold a peg on their own.
