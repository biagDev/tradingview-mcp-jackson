# Product Strategy — NQ Daily Bias

A strategic memo for taking the local MVP toward a paid product.
Written while the local system is still a single-user research tool; intended as a pre-commitment "what's the shape of the actual product?" exercise.

---

## What we have (evidence-based, not hype)

After ~90 days of backfilled history evaluated honestly on chronological splits:

- **The rules engine is real.** 53.6% hit rate on 3-way bias (vs 33% baseline chance, 39.3% majority baseline). That's ~20 percentage points over chance — meaningful alpha for a deterministic, auditable system.
- **The edge concentrates in structure.** Biggest wins: NORMAL regime (61%), Friday (80% on small n), NYSE RTH sessions. The rules engine knows when to have conviction.
- **The weak spot is range sizing.** Current `expected_range` from value-area width has MAE 128.68pt — worse than a naive mean predictor (MAE 88.14). This is an improvement opportunity, not a defect.
- **ML is noise right now.** 28.6% hit rate, 17.9% agreement with rules, 0 regime wins. With 62 weighted training rows against 67 features, this is expected. The promotion gate correctly rejects.
- **The system is honest about itself.** Every ML claim is cross-checked against a baseline and the rules engine. Every backfilled row is fidelity-flagged. The grading and analytics layers never flatter the output.

That honesty is the product's moat. Most trading-signal services don't publish their hit rates. We literally print them on the home page.

---

## Positioning

### Not this
- "Our AI predicts NQ direction with X% accuracy."
- "Beat the market with quant-grade models."
- Any mention of profit curves or P&L.

### This
- "A rules-based NQ daily bias engine. Structured, auditable, graded every day, and published with its own hit rate."
- "You get the same three-line call a prop desk would start its morning with — plus the levels, the scenarios, the invalidation, and the receipts."
- "We show you when the system is working and when it isn't. No cherry-picking."

### Target audience, in order of fit
1. **Self-directed futures traders** who already have a process but want a disciplined premarket structure. They don't need signals — they need a consistent, structured read.
2. **Proprietary-desk juniors** who need to produce a morning brief and would rather reference a systematic one than write from scratch.
3. **Learning traders** who want to watch a system call days out loud and measure itself honestly.

Not: institutions, algo traders, or anyone expecting an execution signal.

---

## Name / brand options

Working on a name should come *after* deciding tone. The tone is:
- Technical but not arrogant
- Transparent about what it is
- Trader-feel, not fintech-feel

### Candidates (not endorsements, just anchors to pick from)

| Name | Vibe | Notes |
|---|---|---|
| **Daily Bias** | Plain-English, trader-vernacular | Generic, hard to own |
| **Session Bias** | Same, more technical | Implies RTH focus, which matches |
| **The Open** | Evocative, minimalist | Confusing with the Golf term |
| **First Call** | Trader-vernacular, premarket-connotation | Memorable, decent |
| **Premarket Bias** | Descriptive | Boring, forgettable |
| **Benchmark NQ** | Implies it's the "neutral" reference | Too close to existing products |
| **Morning Read** | Simple, trader-native phrase | Very fit; easy to name a newsletter |
| **Session Read** | Similar | A touch more differentiated |
| **Daily Structure** | Methodology-forward | Matches the rules-engine framing |
| **Open Bias** | Sharpest | Probably the strongest two-word option |

Recommendation: start with **Morning Read** or **Open Bias**. Both map to what a trader actually says about the product ("did you see this morning's bias?").

---

## Value proposition (one-liner drafts)

1. "A deterministic premarket bias for NQ, graded every day. You see the call and you see the scorecard."
2. "The structured morning brief for NQ. Rules-based, receipt-driven, grade-on-itself every day."
3. "One page every day at 9:00 AM ET: the bias, the levels, the invalidation, the scenarios. Graded after close."

The grading angle is the strongest differentiator. Most signal products never show their misses. This one does it on the home page.

---

## MVP shape — pick one, then iterate

### Option A: Daily email / Substack

- Subscribe, get one email at 9:15 AM ET
- One page: bias, confidence, expected range, key levels, scenarios, invalidation, watchouts
- Following week's email links back to the previous day's grade
- Monthly: hit-rate scorecard

**Build effort:** minimal — the narrative already exists, the scorecard already exists. Add a tiny static-site generator that renders the daily JSON to HTML and ships it.

**Pricing:** free for 2 weeks / $15–29 per month.

**Why this first:** lowest-friction test of demand. If nobody pays for the email, the dashboard won't save you.

### Option B: Web dashboard (paid login)

- What the current `/` page is, minus the dev affordances
- Single subscription unlocks today + history archive
- Dashboard at `open.yourdomain.com`, daily updated at 9:00 ET

**Build effort:** moderate — needs auth, billing, multi-tenant DB, hosted DB. All the Stage 6A "don't do" list.

**Pricing:** $29–49 per month.

**Why not first:** commits you to hosting, uptime, support. Email is the same product with none of that.

### Option C: Alert feed

- Daily bias + expected range + live alerts when price crosses key levels
- Push notifications / Discord / Telegram

**Build effort:** high — live price monitoring infrastructure, routing, delivery guarantees. Not worth building until A or B has paying users.

### Option D: Hybrid (A+B)

Exactly the right shape eventually, but do NOT start here.

---

## Concrete recommendation: Path A → B → maybe C

**Week 0–2: land a payable email.**
- Pick a name (choose one of the shortlist today, don't overthink).
- Set up a Substack/Beehiiv/Ghost with a $29/mo paid tier.
- Send the daily email for 2 weeks for free to a small seed list (20 people from your network).
- Use only the existing structured JSON + narrative. No new engineering.

**Gate: does anyone pay?**
If 3+ people convert to paid after 4 free weeks, the product is real. If zero, the email isn't compelling yet — work on narrative quality (Step 4 of the current roadmap) before building anything else.

**Weeks 3–6: if email converts, build the dashboard.**
- Port the existing `/` and `/history` pages to a multi-tenant Next.js deployment with auth (Clerk/Auth.js).
- Re-use the local SQLite schema; switch to Postgres.
- Charge $49/mo for the dashboard, bundle with the email.

**Month 2+: only if both A+B are working, consider C.**
- Alerts need execution infrastructure and SLAs. Don't touch until there's revenue covering the cost.

---

## Landing page draft

### Above the fold

> **Morning Read**  
> The structured NQ bias, every trading day at 9:00 AM ET.  
> Deterministic. Graded. Published with its own scorecard.
>
> [ Subscribe — $29/mo ]  [ See yesterday's read ]

### Three sections below

1. **What you get (every morning at 9):**
   - Bias + confidence band
   - Expected range + structural level map
   - 3-scenario playbook (primary / alt / invalidation)
   - Intermarket context
   - Session-structure watchouts

2. **We grade ourselves.**
   - Every day gets a letter grade after close (A–F)
   - Running hit-rate on the bias call (currently 53.6% on 3-way, vs 33% chance)
   - [ See the full grading archive → ]
   - Honesty is the product. We don't cherry-pick.

3. **Who it's for.**
   - Self-directed futures traders
   - Prop desk juniors writing morning reports
   - Anyone learning to read a session structurally

### Footer

- Not advice. Not financial advice. Not a signal service. A structured read.
- Past performance etc. etc.

---

## Pricing calibration

For a well-researched NQ product with public grading:

- $19–29/mo is too cheap — implies you're not confident
- $99+/mo implies execution alpha — you don't have that
- **$29–49/mo is the honest range**
- Annual: ~10x monthly ($299–479) to anchor "long-term user" vibes

Do NOT offer free tiers beyond a 2-week trial. Free tiers attract browsers and inflate server costs.

---

## Legal hygiene (non-negotiable before charging)

- "Not investment advice" disclaimer on every page + email
- Published methodology page describing the rules engine at a high level (not the DBE source, just the concept — components + grading)
- Terms of service: no refunds after 7 days, no liability for trading decisions
- If you're US-based, do not call yourself an "investment adviser" — you aren't one
- An LLC between you and the product is worth $500 of setup effort

---

## What NOT to do first

- **Don't** build a phone app.
- **Don't** add social features (comments, public leaderboards).
- **Don't** add crypto.
- **Don't** charge less than $29.
- **Don't** promise alerts until the daily email has 10+ paying users.
- **Don't** spend on ads before organic conversion proves out.
- **Don't** touch auth / billing in the local repo. Keep that for a separate deployment repo.

---

## The single most important next commit

Before any of this strategy work matters, **do one end-to-end dry run** of the email:
1. Run the 9:00 AM scheduler.
2. Copy the `premarket_narrative` + today's stat strip into a draft email.
3. Send it to yourself.
4. After close, copy the grade into a short follow-up email.
5. Ask: "Would I pay $29/month for this in my inbox?"

If the answer is yes, you have a product. If no, identify exactly what's missing, fix it, and try again next day.

The engineering is 95% done. The product is the last 5%.
