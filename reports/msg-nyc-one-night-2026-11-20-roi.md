# ROI report: One Night Only — Madison Square Garden, NYC

ARTIST NAME · launch Fri 9:00 PM ET · headliner ends Sat 12:30 AM ET · 19,500 seats · $500 owner seed · 24h coin window

Generated 2026-11-12T13:54:14.634Z · SOL/USD **$185** (held constant) · pump.fun parameters: live mainnet (2026-11-12T13:54:14.556Z)

## Launch rule: $0 at 0 attendance, +$1 per seat

- The coin launches at **Fri 9:00 PM ET exactly, with 0 seats counted**. Its **attendance value** (market cap above launch) is **$0**.
- Each person in the building adds **$1 of market cap**; each person who leaves takes it back. At the 19,200-seat peak, the attendance value is **$19,200**.
- pump.fun can't list a coin at a literal $0. A fresh curve opens at a **$5,172** market cap, and the owner's $500 buy at launch takes it to **$6,134**. That is the zero line; everything above it is attendance.
- Every minute, the crowd buys or sells on the real curve exactly enough to hold that line. This is the model's assumption; on pump.fun, price is set by whoever trades. Holding the peg live needs a market maker or program trading against the Switchboard attendance feed.
- Fees: 95 bps protocol + 30 bps creator on every trade (live). The owner is the coin creator and earns the creator fee on all crowd volume.
- Curve model checked against the pump.fun SDK: first buy 87,672,352 vs SDK 87,672,352 tokens (0.0000% diff); selling that bag 2.635969 vs SDK 2.635969 SOL (0.0000% diff).

## Attendance → value

| Time (ET) | Seats occupied | Fill | Attendance value | Market cap | vs launch |
|---|---:|---:|---:|---:|---:|
| Fri 9:00 PM (launch) | 0 | 0.0% | $0 | $6,134 | +0.0% |
| Fri 9:15 PM | 4,000 | 20.5% | $4,000 | $10,134 | +65.2% |
| Fri 9:30 PM | 9,500 | 48.7% | $9,500 | $15,634 | +154.9% |
| Fri 10:00 PM | 17,000 | 87.2% | $17,000 | $23,134 | +277.2% |
| Fri 10:30 PM | 19,200 | 98.5% | $19,200 | $25,334 | +313.0% |
| Fri 10:45 PM (mid-show) | 19,200 | 98.5% | $19,200 | $25,334 | +313.0% |
| Sat 12:25 AM (before crowd leaves) | 19,200 | 98.5% | $19,200 | $25,334 | +313.0% |
| Sat 12:30 AM (headliner ends) | 18,700 | 95.9% | $18,700 | $24,834 | +304.9% |
| Sat 12:40 AM | 11,500 | 59.0% | $11,500 | $17,634 | +187.5% |
| Sat 12:50 AM | 5,000 | 25.6% | $5,000 | $11,134 | +81.5% |
| Sat 1:00 AM | 1,800 | 9.2% | $1,800 | $7,934 | +29.3% |
| Sat 1:30 AM | 0 | 0.0% | $0 | $6,134 | +0.0% |

## Owner ROI by scenario

Owner cost: 2.7027 SOL seed ($500.00) + 0.0092 SOL account rent = **$501.70**. Bought at the zero line: 87,672,352 tokens (8.77% of supply).

| | Scenario | Sale proceeds | Creator fees | Bag left (value) | Owner total | **Owner ROI** | Crowd net |
|---|---|---:|---:|---:|---:|---:|---:|
| A | Owner sells 100% mid-show (Fri 10:45 PM) | $1,857.44 | $48.72 | — | $1,906.15 | **+279.9%** ($1,404.45) | -$1,572.78 |
| B | Owner sells 100% right before the crowd leaves (Sat 12:25 AM) | $1,857.44 | $48.72 | — | $1,906.15 | **+279.9%** ($1,404.45) | -$1,572.78 |
| C | Owner sells 50% mid-show, 50% before the crowd leaves | $2,011.45 | $49.66 | — | $2,061.10 | **+310.8%** ($1,559.40) | -$1,730.69 |
| D | Owner holds; settlement burn at peak fill (baseline rules) | $0.00 | $37.43 | 1,350,154 ($8.17) | $45.60 | **-90.9%** (-$456.10) | -$155.97 |
| E | Owner holds, no burn; sells at window close (reference) | $487.65 | $38.92 | — | $526.57 | **+5.0%** ($24.87) | -$155.97 |

"Crowd net" is what everyone else, all buyers together, ends with: SOL out − SOL in + the value of tokens still held.

## What each owner sale does to the price

| | Sale | Time (ET) | Tokens sold | Proceeds | Market cap: peg → right after | Crowd SOL to restore the peg |
|---|---|---|---:|---:|---:|---:|
| A | mid-show | Fri 10:45 PM | 87,672,352 | $1,857.44 | $25,334 → $18,169 (-28.3%) | $1,904.46 |
| B | before crowd leaves | Sat 12:25 AM | 87,672,352 | $1,857.44 | $25,334 → $18,169 (-28.3%) | $1,904.46 |
| C | mid-show | Fri 10:45 PM | 43,836,176 | $1,005.72 | $25,334 → $21,307 (-15.9%) | $1,031.19 |
| C | before crowd leaves | Sat 12:25 AM | 43,836,176 | $1,005.72 | $25,334 → $21,307 (-15.9%) | $1,031.19 |
| E | window close | Sat 9:00 PM | 87,672,352 | $487.65 | $6,134 → $5,172 (-15.7%) | — (window closed, peg ended) |

## Settlement

- **A:** nothing to burn: the owner already sold the whole bag, so holders don't get the attendance burn.
- **B:** nothing to burn: the owner already sold the whole bag, so holders don't get the attendance burn.
- **C:** nothing to burn: the owner already sold the whole bag, so holders don't get the attendance burn.
- **D:** burns 86,322,198 tokens (98.5% peak fill × 1); owner keeps 1,350,154.

## Takeaways

1. **Launching at zero attendance gives the owner the cheapest entry.** The owner buys at the zero line, before anyone is counted, so the full $19,200 of attendance value builds on top of the owner's bag. Market cap peaks at +313.0% over launch.
2. **Mid-show (A) and just before the crowd leaves (B) pay the same: +279.9% / +279.9%.** The building is full (19,200) from Fri 10:30 PM to Sat 12:25 AM, so both sales hit the same peg. Ten minutes after the headliner ends, the attendance value is down 40.1%.
3. **Splitting the exit (C) earns more: +310.8%.** Each half knocks the market cap -15.9% instead of -28.3%. Buyers restore the peg between the two sales, at the crowd's expense (crowd net -$1,730.69 vs -$1,572.78).
4. **Holding under the burn rule (D): -90.9%.** The burn destroys the bag the attendance built. Holding without a burn (E): +5.0%. Once the venue empties, value returns to the zero line.
5. **Every owner sale is paid for by the crowd.** In A, buyers spend $1,904.46 to undo a -28.3% drop, and settlement has nothing left to burn. If owners can sell mid-event, disclose it up front, or lock the owner bag until settlement.

## Assumptions

- Attendance is the modeled occupancy profile in `events/msg-nyc-one-night.json` (0 at launch, peak 19,200); it must come from a real Switchboard feed (door scans in and out) before launch.
- SOL/USD stays at $185 throughout. No other traders, bots or snipers: crowd trades are exactly what holds the peg.
- The settlement burn uses peak occupancy (19,200), because occupancy is 0 by the time the window closes.
- Creator fees are counted on crowd trades only, and claimable by the owner whether or not they sold.
- Not financial advice. This models one rule set; real markets won't hold a peg on their own.
