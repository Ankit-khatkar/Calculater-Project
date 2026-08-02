# Distance-Based Delivery Pricing (Server-Controlled) — Build Plan v2

> **Status:** Proposed (not yet implemented)
> **Author:** Ankit
> **Revision:** v2 — 2026-08-02. Rewritten against the Zomato/Swiggy fee-stack model after the v1 draft was found to be **structurally loss-making at its own seed values** (§1.3). v1's config-row pattern, snapshot doctrine, trust model, and RPC mechanics survive; the pricing curve, the free-delivery rule, the revenue split, and the ceiling are replaced.
> **Depends on:** migration 006 (pricing breakdown + `discount_config`), 015 (delivery pin + address book), **021 (`restaurants.delivery_radius_km`)**.
> **Supersedes:** the *"Flat ₹25 — no distance-based pricing in v1.x"* line in `discount_and_delivery_fee_plan.md` §2.1, and that doc's §6 open question.
> **Migration number:** **`022_distance_based_delivery.sql`**. (v1 of this plan said `020`; 020 and 021 were consumed by `device_tokens` and `delivery_radius` while this plan sat unimplemented.)

> **One-line summary:** Replace the flat ₹25/free-above-₹150 fee with a **five-component, fully server-controlled fee stack** — base + per-km distance + surge + platform fee, with a **distance-capped** free-delivery waiver — where the per-km rate is constrained by database CHECKs to **never fall below the marginal cost of the ride**, and every component is snapshotted per order so settlement stays exact across retunes.

---

## 0. The three decisions this plan needs from Ankit

Everything else follows mechanically. Flagging them up front because two of them change partner-facing commitments.

| # | Decision | This plan recommends | Why it matters |
|---|---|---|---|
| **D1** | **Who keeps the delivery fee?** Today it is RedLotus revenue, settled monthly against the subscription invoice — while the *partner* does the riding. | **Flip it: the whole delivery fee + surge goes to the partner.** RedLotus's per-order line becomes the new `platform_fee`. | §7. This is forced, not stylistic — see §1.3. Any model where the partner rides and RedLotus keeps the kilometre money leaves the partner underwater on far orders, and partner churn is the loss that actually kills a ₹1,500/mo subscription business. Requires a `PartnerProgram.tsx` disclosure rewrite (good news for partners) and changes the monthly invoice math. |
| **D2** | **Do we introduce a platform fee at all?** It is a visible +₹6-ish on *every* order, including the ₹0-delivery ones customers see today. | **Yes, but ship it at ₹0 and turn it on in the Dashboard ~30 days after launch** (§8 staged activation). | It is the only unwaivable, distance-independent, basket-independent revenue line. It is precisely what Zomato and Swiggy added when their delivery economics stopped working. Config-gated means the decision is reversible without a deploy. |
| **D3** | **How much of the village stays "cheap"?** `base_distance_km` is the price-sensitivity lever; `per_km_fee` is the loss-protection lever. | Seed `base_distance_km = 2.0 km`, `base_fee = ₹25`. Widening to 3 km forces `base_fee` to ~₹30 to satisfy the cost CHECK (§3.7) — the guardrail makes the trade-off explicit rather than silent. | §3.2. Gudha Gorji is small enough that a 2 km base covers most orders at today's price. The curve only bites on genuinely far runs. |

---

## 1. Why This Change — the loss, quantified

### 1.1 What v1.x does today

Flat ₹25, waived at subtotal ≥ ₹150, hardcoded in `src/lib/pricing.ts` and the `place_order` RPC. Justified at the time by *"single-zone delivery in Gudha Gorji makes per-km irrelevant."* The fee is RedLotus revenue; **the restaurant does the delivery and receives none of it.**

### 1.2 What actually changed under it

1. **The pin exists and is now mandatory.** 015 put a GPS pin on orders; the current `Checkout.tsx` has `!needsDeliveryPin` inside `canPlace`, so **every order carries measurable coordinates**. Distance is no longer a nice-to-have input — it is reliably available at placement time.
2. **021 made service area per-restaurant.** `restaurants.delivery_radius_km` (default 4 km, admin-tunable, measured from the restaurant's own `lat/lng`) already answers *"will they deliver there?"*. What is still unanswered is *"what does that ride cost, and who pays for it?"*
3. **Restaurants handle their own delivery.** Every marginal kilometre lands on the partner's fuel bill. Under the flat model, a 5 km run on a ₹300 basket is priced at **₹0**.

### 1.3 The number that forced this rewrite

A 2-wheeler doing local stop-start delivery, Rajasthan, 2026:

| Cost line | Planning figure | Notes |
|---|---|---|
| Petrol | ₹105/L ÷ ~44 km/L | Real delivery mileage, not the sticker figure |
| ⇒ fuel | **₹2.40/km** | |
| Consumables (oil, chain, tyres, brakes, servicing) | **₹0.70/km** | |
| Depreciation (₹85k bike → ₹25k resale over ~60,000 km) | **₹1.00/km** | Felt on replacement, not weekly |
| **Cash cost (what the partner feels each week)** | **≈ ₹3.10/km** | fuel + consumables |
| **Fully-loaded vehicle cost** | **≈ ₹4.10/km** | incl. depreciation |
| **Planning figure used by this plan** | **₹3.50/km** | `delivery_config.assumed_cost_per_km` — Dashboard-tunable |

**A delivery is a round trip.** A customer 3 km away is 6 km ridden. So the marginal vehicle cost is **2 × `assumed_cost_per_km` = ₹7.00 per km of delivery distance**, before any rider labour.

Now price the same order under **v1 of this plan** (base ₹25 waived at ₹150+, surcharge ₹10 for 2–4 km):

| ₹220 cart, customer 3.0 km away | v1 plan |
|---|---|
| Base (waived, subtotal ≥ ₹150) | ₹0 |
| Distance surcharge | ₹10 |
| **Collected for the ride** | **₹10** |
| **Round-trip cost** (6 km @ ₹3.50) | **₹21** |
| **Partner's delivery P&L** | **−₹11** |

And at the top of v1's range — 5.9 km, ₹700 cart — v1 collects ₹20 against ₹41 of cash cost: **−₹21**. **v1's fee curve loses money at every distance above the waiver threshold, and loses more the farther it goes.** The surcharge was set from intuition about what a village customer would tolerate, not from the cost of the ride.

That is the specific defect this revision fixes. The rule the new curve is built around:

> **Cost-Floor Invariant — the marginal fee per kilometre must exceed the marginal cost per kilometre of the round trip.** Enforced as a database CHECK (§3.7), so a loss-making configuration is *unrepresentable*, not merely discouraged.

### 1.4 Which "loss" we are actually protecting against

Two different losses hide behind the word, and they need different instruments:

- **Partner loss** (the real threat). The restaurant's delivery cost exceeds what the order contributes. Left alone this shows up as partners quietly refusing far orders, then disputing, then churning off the ₹1,500–2,000/month subscription. **Instrument: the distance fee, paid to the partner (D1).**
- **RedLotus loss.** The platform's own revenue is subscription-only once the ₹25 base is waived — which it is on most orders. **Instrument: the platform fee (D2).**

Copying Zomato's stack without this split would have RedLotus collecting kilometre money it does not spend while the partner still eats the fuel. §7 keeps the two ledgers separate.

### 1.5 What deliberately does not change

The discount model and `discount_config`; COD-only; the single-restaurant cart; the `place_order`-only write path; 15-minute expiry; cancellation and ETA rules; subscription pricing. And per §8, **the seed configuration reproduces today's pricing exactly** — shipping the migration changes no customer's total until Ankit stages the knobs.

---

## 2. What Zomato and Swiggy Actually Do — and what RedLotus should copy

> **Figures below are indicative.** Both platforms change fees frequently, vary them by city, restaurant, and time of day, and A/B test them continuously. Treat the *structure* as the durable lesson and spot-check the *numbers* in the apps before committing to any of them.

### 2.1 Their fee stack

| Component | Typical shape | Purpose |
|---|---|---|
| **Delivery fee** | Distance-based. A base covering the first ~2–3 km, then a per-km rate, with the rate **stepping up** past a long-distance threshold. | Cover the rider. |
| **Platform fee** | Flat per order, **never waived** — not by basket size, not by membership. Started ~₹2, ratcheted up repeatedly, higher on peak days. | Pure margin. Basket- and distance-independent. |
| **Surge / rain fee** | Additive, switched on during rain, peak hours, festivals. | Rider supply collapses exactly when demand spikes. |
| **Small-order fee** | Flat fee below a minimum cart value. | Make thin baskets worth dispatching. |
| **Membership (Gold / One)** | Free delivery **only above a min cart value AND only within a distance cap**, at eligible restaurants. Platform fee still applies. | Retention, without unbounded subsidy. |
| **Packaging / restaurant charges** | Passed through from the restaurant. | Not RedLotus's concern (partner sets menu prices). |

### 2.2 The four structural lessons

1. **Per-km beyond a base, not fixed slabs.** Slabs create cliffs (a 4.01 km order jumping ₹10 is a support ticket) and go stale on expansion. A per-km curve extends to any distance and retunes with one number.
2. **The steeper second rate.** Long runs are *disproportionately* expensive — rider time, not just fuel, and the round-trip dead leg is unproductive. Both platforms charge more per km at distance. So does §3.2.
3. **Free delivery is never unconditional.** This is the single most important lesson and the one v1 of this plan missed. On both platforms free delivery is bounded on **three** axes simultaneously: minimum cart value, **maximum distance**, and eligible-restaurant set. RedLotus today bounds it on *one* (cart value), which is why a ₹300 order 5 km away is free.
4. **A flat, unwaivable per-order fee is what fixed their unit economics.** Not the delivery fee — that mostly passes through to riders. The platform fee is the line that survives every discount, every membership, and every basket size.

### 2.3 What we deliberately do NOT copy

Naming these matters as much as the borrowings — each is a considered "no", not an oversight:

| Not copying | Why |
|---|---|
| **Small-order fee** | Redundant here. The base-fee waiver *is* our small-order mechanism — below `free_delivery_min_subtotal` the customer already pays full delivery. Charging both a "delivery fee" and a "small order fee" for the same signal reads as double-dipping. Run the numbers: a ₹60 order at 3 km yields the partner ~₹36 food contribution + ₹35 delivery fee − ₹21 cost = **+₹50**. No dispatch problem to solve. |
| **Membership tier (Gold/One equivalent)** | Needs scale and a payments rail. RedLotus is COD-only with ~5 restaurants. The free-delivery waiver already plays the retention role. v2. |
| **Real-time algorithmic surge** | Needs a rider-supply signal RedLotus does not have (partners dispatch their own people). Replaced by a **manual Dashboard toggle + optional scheduled window** (§3.5) — at this scale, Ankit flipping a switch when it starts raining is operationally realistic and infinitely simpler than a weather API. |
| **Road distance via routing API** | Cost, latency, an API key to rotate, and a hard dependency in the placement path. Crow-flies haversine is adequate at village scale; §11 lists the trigger for revisiting. |
| **Per-restaurant fee overrides** | Real (a partner with a scooter vs one walking), but over-engineering at 5 restaurants in one village. The resolver seam is designed for it (§5.4); the columns are v2 (§11). |
| **Restaurant packaging charges** | Partners set their own menu prices; a separate packaging line would just confuse. |

---

## 3. The Pricing Model

All values below are **seed defaults** of the new `delivery_config` row. Every one is Dashboard-editable at runtime with no deploy. What the *code* fixes is the **shape** — base + per-km curve + waiver + surge + platform fee — not the numbers.

### 3.1 The five components

```
Item total          (subtotal)                            — menu list prices
− Discount                                                — unchanged, discount_config
+ Delivery fee      = base + distance component           → PARTNER   (D1)
+ Surge fee         = surge_fee when live                 → PARTNER
+ Platform fee      = platform_fee, ALWAYS                → REDLOTUS
─────────────────────────────────────────────────────────
= To pay (cash)     total_amount
```

| Component | Config fields | Waivable? | Owner |
|---|---|---|---|
| Base delivery | `base_fee`, `base_distance_km` | **Yes** — but only when subtotal ≥ `free_delivery_min_subtotal` **AND** distance ≤ `free_delivery_max_km` (§3.3) | Partner |
| Distance | `per_km_fee`, `long_distance_km`, `long_distance_per_km_fee`, `max_delivery_fee` | **Never** | Partner |
| Surge | `surge_fee`, `surge_active`, `surge_starts_at/ends_at`, `surge_label` | Never (only ever ₹0 when not live) | Partner |
| Platform | `platform_fee` | **Never** | RedLotus |

### 3.2 The distance curve

`distance_km` = haversine from `restaurants.lat/lng` to the confirmed pin (`orders.delivery_lat/lng`), **quantised to 2 dp (10 m) before pricing** — see §3.6.

```
distance_fee(d) =
      max(0, min(d, long_distance_km) − base_distance_km) × per_km_fee
    + max(0, d − long_distance_km)                        × long_distance_per_km_fee

delivery_fee(d, subtotal) = min( round( base_component + distance_fee(d) ), max_delivery_fee )
```

Seed values and the resulting curve:

| Field | Seed | |
|---|---|---|
| `base_fee` | ₹25 | covers the first `base_distance_km` |
| `base_distance_km` | 2.0 km | |
| `per_km_fee` | ₹10/km | applies from 2.0 → 5.0 km |
| `long_distance_km` | 5.0 km | where the steeper rate starts |
| `long_distance_per_km_fee` | ₹14/km | beyond 5.0 km |
| `max_delivery_fee` | ₹90 | absolute ceiling on the delivery line |

| Distance | Delivery fee | Round-trip cost @ ₹3.50/km | Fully-loaded @ ₹4.10/km | Partner margin |
|---|---|---|---|---|
| 1.0 km | ₹25 | ₹7 | ₹8 | **+₹18** |
| 2.0 km | ₹25 | ₹14 | ₹16 | **+₹11** |
| 3.0 km | ₹35 | ₹21 | ₹25 | **+₹14** |
| 4.0 km | ₹45 | ₹28 | ₹33 | **+₹17** |
| 5.0 km | ₹55 | ₹35 | ₹41 | **+₹20** |
| 6.0 km | ₹69 | ₹42 | ₹49 | **+₹27** |
| 7.0 km | ₹83 | ₹49 | ₹57 | **+₹34** |
| 8.0 km | ₹90 (capped) | ₹56 | ₹66 | **+₹34** |

Margin is computed against the ₹3.50/km planning figure (`assumed_cost_per_km`), the same basis used in §1.3, §3.3 and §4 so the tables are comparable; the loaded column is the sensitivity check. Margin is positive at every distance and **grows** with distance — the opposite of v1's curve. The cap starts binding at 8 km and goes below fully-loaded cost around 11 km; see §3.6 for the ops rule that keeps it honest.

**Why continuous per-km rather than v1's three fixed slabs:** no ₹10 cliff at a boundary to explain or dispute; one rate to retune instead of three prices; extends to any distance so expansion needs no new slab; and — see §3.6 — it makes the client/server agreement problem trivial instead of requiring v1's three-invocation tolerance dance.

### 3.3 Free delivery, redefined — the actual loss fix

**v1's rule:** waive the base whenever `subtotal ≥ ₹150`, at any distance.
**New rule:** waive the base only when **both** conditions hold:

```
subtotal ≥ free_delivery_min_subtotal   (seed ₹150)
AND  distance ≤ free_delivery_max_km    (seed 2.0 km)
```

Beyond `free_delivery_max_km`, **the full fee including base is charged regardless of basket size.** This is the Gold/One distance cap from §2.2, and it is the single change that stops the bleeding:

| ₹220 cart, 3.0 km | v1 plan | This plan |
|---|---|---|
| Base | ₹0 (waived) | **₹25** (distance > 2 km ⇒ no waiver) |
| Distance | ₹10 | ₹10 |
| Collected for the ride | ₹10 | **₹35** |
| Round-trip cash cost | ₹21 | ₹21 |
| **Partner delivery P&L** | **−₹11** | **+₹14** |

A CHECK enforces `free_delivery_max_km <= base_distance_km`, so **the waiver can never extend into the distance-priced region.** The subsidy is structurally bounded to the base fee on short runs.

**The subsidy that remains is deliberate.** Inside 2 km on a ₹150+ basket, delivery is genuinely free and the partner absorbs ≤ ₹16 of fully-loaded cost. That is affordable because it is measured against food contribution, not against zero: a ₹150 basket at a typical ~55–60% gross margin contributes ~₹85, so the subsidy is ~19% of contribution. That is the promotional lever, and it is bounded on both axes.

**Tuning rule for the threshold** (worth writing down, because it is the retune Ankit will actually make):

```
free_delivery_min_subtotal  ≥  round_trip_cost(free_delivery_max_km) / (target_subsidy_share × food_margin_share)
```

At the seed — ₹16 loaded cost, a 15% target subsidy share, 58% food margin — that gives **₹184**, i.e. the ₹150 threshold is already slightly generous. §8 stages it to ₹199.

### 3.4 Platform fee

Flat, per order, **never waived by anything** — not basket size, not distance, not the discount campaign. Seeded at **₹0** so launch is behaviour-preserving; §8 stages it to ₹6.

This is RedLotus's replacement for the base-fee revenue that D1 hands to the partner. Modelled: if ~70% of orders clear ₹150 today, RedLotus averages ₹25 × 30% ≈ **₹7.50/order** — but only from small baskets, so the revenue *shrinks* as the business succeeds. A ₹6–7 flat fee on 100% of orders is comparable in level and **stable against basket mix**. That is the whole argument for it.

Honest counterweight: it is a visible price increase on every order including the currently-free ones, and village price sensitivity is higher than metro. Hence D2's staging — ship at ₹0, watch order volume for a month, then flip.

### 3.5 Surge

One additive fee, off by default:

```
surge_live = surge_active
             AND (surge_starts_at IS NULL OR now() >= surge_starts_at)
             AND (surge_ends_at   IS NULL OR now() <  surge_ends_at)
```

Same predicate shape as `is_discount_active()`, minus the day-of-week mask. `surge_label` (seed `'Rain fee'`) is the customer-facing line label, so Ankit can retitle it `'Peak hour'` or `'Festival surcharge'` without a deploy.

Operationally: it rains, Ankit sets `surge_active = true`, Realtime pushes it to every open tab within seconds, and the checkout shows a labelled `Rain fee ₹15` line. It stops raining, he flips it back — or he sets a window in advance for a known peak (Diwali evening) and lets it expire itself. Goes to the partner, because the extra cost is theirs.

### 3.6 Boundaries, rounding, caps, and the unknown-distance case

**Quantise, then price.** Both runtimes round the raw haversine to **2 dp (10 m)** *before* it enters the fee function. Float divergence between JS `Math` trig and Postgres `float8` trig at these magnitudes is ~1e-10 km, which can only flip a 2-dp rounding when the raw value lands within 1e-10 of a `.005` boundary. Combined with the ₹1 tolerance below, client/server agreement becomes structural.

> This replaces v1's ±25 m tolerance band, which required calling the fee function **three times** per placement (at `d`, `d−0.025`, `d+0.025`) to avoid deadlocking a customer whose pin sat on a slab edge. A continuous curve plus quantisation removes the failure mode instead of forgiving it.

**Rounding.** The delivery fee is rounded to whole rupees once, at the end. Platform and surge fees are configured as whole rupees. COD means no coins below ₹1.

**Fee tolerance.** `place_order` accepts a client delivery-fee claim within **±₹1.00** (up from ±₹0.01 for the flat model), writing the client's value when it falls inside. Rationale: after quantisation the only residual disagreement source is a `.5` rounding straddle, worth exactly ₹1. A stale-config claim differs by far more than ₹1 and still hard-fails to `PRICING_MISMATCH:` — the "Pricing updated, please review" toast, unchanged. Accepted leak: ≤ ₹1/order, and only when a retune moves a fee by exactly ₹1. Subtotal and discount keep their ±₹0.01 checks.

**Cap vs. radius — the ops rule.** `max_delivery_fee` (₹90) sits above the fee at 8 km. If any restaurant's `delivery_radius_km` is ever raised past ~10 km, the cap starts binding below cost. This *cannot* be a CHECK (it spans two tables), so it is a **monitoring lint** (§9) plus a line in the onboarding checklist.

**Unknown distance.** The pin is mandatory at checkout, so the only remaining unmeasurable case is *a restaurant with no `lat/lng`*. This plan closes that structurally rather than pricing around it:

```sql
ALTER TABLE public.restaurants
  ADD CONSTRAINT active_restaurants_need_coords
    CHECK (NOT is_active OR (lat IS NOT NULL AND lng IS NOT NULL));
```

An active restaurant without coordinates is already broken (it cannot appear in discovery, which filters by radius). Making it unrepresentable removes v1's entire §2.3 fallback branch **and** its §4 "skip-the-pin to dodge the surcharge" gaming vector — the customer cannot skip the pin, and the restaurant cannot lack coords.

Defensive residue: if `distance_km` is somehow NULL, both runtimes charge **base only** and the order still places (never block a customer over our own data gap). Pre-flight the constraint with `SELECT id, name FROM restaurants WHERE is_active AND (lat IS NULL OR lng IS NULL);` before running the migration.

### 3.7 The Cost-Floor Invariant — making a loss-making config unrepresentable

`delivery_config` stores the cost assumption itself (`assumed_cost_per_km`, seed ₹3.50 — internal, **not** granted to the client), and three CHECKs bind the price knobs to it:

```sql
-- Marginal fee per km ≥ marginal cost per km of the ROUND trip
CONSTRAINT delivery_config_per_km_covers_cost
  CHECK (per_km_fee >= 2 * assumed_cost_per_km),                    -- 10 ≥ 7.00  ✓

-- The base fee must cover the round trip it includes
CONSTRAINT delivery_config_base_covers_cost
  CHECK (base_fee >= 2 * assumed_cost_per_km * base_distance_km),   -- 25 ≥ 14.00 ✓

-- Farther is never cheaper per km
CONSTRAINT delivery_config_long_rate_not_cheaper
  CHECK (long_distance_per_km_fee >= per_km_fee),                   -- 14 ≥ 10    ✓
```

The practical effect: Ankit cannot save a Dashboard edit that prices a kilometre below what a kilometre costs. The row simply refuses. And because the cost figure is itself a column, revising the fuel assumption **automatically raises the price floor** — set `assumed_cost_per_km = 4.5` and the row will reject any `per_km_fee` under ₹9 until it is raised too.

This is the concrete answer to "we do not want to incur a loss in future": not a policy in a document, a constraint in the database. §9 adds the runtime half — a margin view that flags any order that still came in under cost.

---

## 4. Worked Examples

### 4.1 Under the seed config (= today's behaviour, before staging)

Seeds for launch parity: `per_km_fee = 0`, `free_delivery_max_km = 99`, `platform_fee = 0`, `surge_active = false` (§8 Stage 0).

| # | Subtotal | Distance | Discount | Delivery | Platform | Surge | Total | vs. today |
|---|---|---|---|---|---|---|---|---|
| 1 | ₹120 | 1.2 km | ₹0 | ₹25 | ₹0 | ₹0 | **₹145** | identical |
| 2 | ₹220 | 3.1 km | ₹24 | ₹0 | ₹0 | ₹0 | **₹196** | identical |
| 3 | ₹700 | 5.9 km | ₹50 | ₹0 | ₹0 | ₹0 | **₹650** | identical |

**Shipping the migration changes nobody's total.** That is deliberate — the migration and the price change are separate events.

### 4.2 After Stage 1 (distance pricing live)

`per_km_fee = 10`, `long_distance_km = 5`, `long_distance_per_km_fee = 14`, `free_delivery_max_km = 2.0`, `platform_fee = 0`.

| # | Subtotal | Distance | Discount | Base | Distance | Delivery | Total | Note |
|---|---|---|---|---|---|---|---|---|
| 4 | ₹120 | 1.2 km | ₹0 | ₹25 | ₹0 | ₹25 | **₹145** | Unchanged — near + small basket. |
| 5 | ₹160 | 1.5 km | ₹0 | ₹0 | ₹0 | ₹0 | **₹160** | Unchanged — the waiver still applies. |
| 6 | ₹220 | 1.9 km | ₹24 | ₹0 | ₹0 | ₹0 | **₹196** | Unchanged — just inside the cap. |
| 7 | ₹220 | 2.1 km | ₹24 | ₹25 | ₹1 | ₹26 | **₹222** | **The fix.** Waiver lost past 2 km. Was ₹196. |
| 8 | ₹220 | 3.0 km | ₹24 | ₹25 | ₹10 | ₹35 | **₹231** | Partner nets +₹14 on the ride. |
| 9 | ₹120 | 5.2 km | ₹0 | ₹25 | ₹33 | ₹58 | **₹178** | ₹30 (3 km × 10) + ₹2.8 (0.2 × 14) = ₹32.8 → ₹33. |
| 10 | ₹700 | 5.9 km | ₹50 | ₹25 | ₹43 | ₹68 | **₹718** | Was ₹650. Big basket no longer buys a free 6 km ride. |
| 11 | any | 2.00 km | — | ₹0* | ₹0 | ₹0* | — | Boundary is **inclusive** — 2.00 km still qualifies for the waiver. |
| 12 | any | > radius | — | — | — | — | **refused** | `DELIVERY_TOO_FAR:` — the restaurant's own `delivery_radius_km` (§5.4). |

\* when subtotal ≥ threshold.

Row 7 is the sharp edge: **₹196 → ₹222 for a 200 m difference in address.** Inclusive boundaries and the continuous curve keep it from being worse (the distance component itself is only ₹1 there — the ₹25 jump is the *waiver* cliff, which is inherent to any threshold). Mitigation is the nudge copy in §5.5, and the option to widen `free_delivery_max_km` if it generates complaints.

### 4.3 After Stage 2 (platform fee live), with surge

`platform_fee = 6`, `surge_fee = 15`, `surge_active = true`, `surge_label = 'Rain fee'`.

```
Item total                       ₹220.00
Discount (11%)                  −₹24.00
Delivery fee (3.0 km)            ₹35.00
Rain fee                         ₹15.00
Platform fee                      ₹6.00
────────────────────────────────────────
To pay (Cash)                   ₹252.00
     ├─ Partner keeps            ₹50.00   (delivery + surge)
     └─ RedLotus claims           ₹6.00   (platform fee)
```

And the near/large-basket case that most customers see:

```
Item total                       ₹220.00
Discount (11%)                  −₹24.00
Delivery fee (1.4 km)      FREE   ₹0.00
Platform fee                      ₹6.00
────────────────────────────────────────
To pay (Cash)                   ₹202.00
```

---

## 5. Architecture

### 5.1 `src/lib/pricing.ts`

`DELIVERY_FEE_RUPEES` / `FREE_DELIVERY_THRESHOLD` are **retired as sources of truth**, demoted to pre-hydration defaults — the exact `DiscountConfig` / `DEFAULT_DISCOUNT_CONFIG` split already in the file:

```ts
export type DeliveryConfig = {
  baseFee: number;                  // 25
  baseDistanceKm: number;           // 2.0
  perKmFee: number;                 // 10  (0 at launch — staged)
  longDistanceKm: number;           // 5.0
  longDistancePerKmFee: number;     // 14
  maxDeliveryFee: number;           // 90
  freeDeliveryMinSubtotal: number;  // 150
  freeDeliveryMaxKm: number;        // 99 at launch → 2.0 staged
  platformFee: number;              // 0 at launch → 6 staged
  surgeFee: number;                 // 0
  surgeActive: boolean;             // false
  surgeStartsAt: Date | null;
  surgeEndsAt: Date | null;
  surgeLabel: string;               // 'Rain fee'
};
// NOTE: assumed_cost_per_km is deliberately absent — it is not granted to the
// client (§5.3a). It only ever drives the server-side CHECKs and reporting.

export const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = { /* MUST match the 022 seed row */ };

/** Round to 2 dp (10 m) BEFORE pricing — see §3.6. */
export function quantiseDistanceKm(km: number): number;

export function isSurgeLive(cfg: DeliveryConfig, now?: Date): boolean;

/** null distance → base only (§3.6 defensive residue). */
export function computeDeliveryFee(
  distanceKm: number | null, subtotal: number, cfg: DeliveryConfig,
): { baseFee: number; distanceFee: number; totalFee: number };

export function computeCartPricing(
  subtotal: number,
  config: DiscountConfig,
  now: Date = new Date(),
  distanceKm: number | null = null,                       // appended with defaults, so every
  delivery: DeliveryConfig = DEFAULT_DELIVERY_CONFIG,     // existing 2-/3-arg caller and test
): CartPricing;                                           // compiles unchanged
```

`CartPricing` gains, keeping every existing field's shape:

```ts
deliveryFee: number;               // base + distance, capped — what orders.delivery_fee stores
deliveryBaseFee: number;           // 0 | baseFee        — drives the "FREE" label
deliveryDistanceFee: number;       // never waived       — folded into the Delivery line's amount
deliveryDistanceKm: number | null; // quantised echo     — drives the "(3.0 km)" label
platformFee: number;
surgeFee: number;
surgeLabel: string;
total: number;                     // subtotal − discount + deliveryFee + platformFee + surgeFee
```

Discount math is untouched; discount and distance compose independently.

`hints.rupeesToFreeDelivery` now computes against `delivery.freeDeliveryMinSubtotal` **and returns 0 when the distance already disqualifies the waiver** — promising "add ₹30 for free delivery" to a customer 3 km away would be a lie.

### 5.2 `DeliveryConfigContext`

A deliberate mirror of `DiscountConfigContext`, not a merge into it (that context works, has consumers and tests; consolidation is v2 — §11):

- Mounted in `main.tsx` between `DiscountConfigContextProvider` and `CartContextProvider`, so the cart can read both.
- On mount: `supabase.from('delivery_config').select(<explicit column list>).single()`. Use an explicit list, not `*` — `assumed_cost_per_km` is not granted and `select('*')` would error.
- **Realtime subscription on `delivery_config` UPDATE.** Not optional polish: when Ankit retunes, every open tab must converge within seconds or in-flight carts submit stale claims and hit `PRICING_MISMATCH`. Same two-mechanism coverage as the discount — Realtime for pre-checkout, the server mismatch check for the submit race.
- **A 60 s tick is required** (unlike v1's assessment) because `surge_starts_at`/`surge_ends_at` are scheduled boundaries that must be crossed without a refresh — exactly why `DiscountConfigContext` has one.
- Exposes `{ config, isSurgeLive, loading }` via `useDeliveryConfig()`.

### 5.3 `Checkout` plumbing — much smaller than v1 assumed

**v1 planned to add `restaurant_lat` / `restaurant_lng` to `CartState`, thread them through `ADD_ITEM` and the replace-cart path, and widen the `localStorage` hydration schema. None of that is needed.** `Checkout.tsx` already fetches the restaurant's coordinates on mount for the 021 geofence and already computes the distance:

```tsx
// Existing, unchanged — Checkout.tsx:151-190
const [restaurantGeo, setRestaurantGeo] = useState<{lat, lng, radiusKm} | null>(null);
// ... .select("lat, lng, delivery_radius_km") ...
const deliveryDistanceKm =
  coords != null && restaurantCoords != null ? haversineKm(coords, restaurantCoords) : null;
const deliveryOutOfArea = deliveryDistanceKm != null && deliveryDistanceKm > deliveryRadiusKm;
```

The entire change is to quantise that value and feed it to pricing:

```tsx
const pricedDistanceKm = useMemo(
  () => (deliveryDistanceKm == null ? null : quantiseDistanceKm(deliveryDistanceKm)),
  [deliveryDistanceKm],
);

const effectivePricing = useMemo(
  () => computeCartPricing(pricing.subtotal, config, new Date(), pricedDistanceKm, deliveryConfig),
  [pricing.subtotal, config, pricedDistanceKm, deliveryConfig],
);
```

`effectivePricing` (not the context `pricing`) feeds the breakdown, the submit-button total, `ConfirmOrderModal`, and the RPC claims. It recomputes on every address interaction (`coords` already changes on saved-address select, GPS-modal confirm, and "Add a new address") and on every retune (Realtime → `deliveryConfig`). No new state, no new effects.

**One new guard.** `restaurantGeo` currently fails open — a failed fetch leaves it `null`, distance unmeasurable, geofence skipped. Harmless when distance only gates the geofence; **not harmless once distance sets a price**, because the client would claim base-only while the server measures the real distance, producing a `PRICING_MISMATCH` that retry cannot clear (the client recomputes the identical claim). Fix: track the fetch outcome and require it in `canPlace`, with a retry affordance:

```tsx
const [geoLoadFailed, setGeoLoadFailed] = useState(false);
// ...in the catch/error path: setGeoLoadFailed(true)

const canPlace =
  cart.items.length > 0 &&
  address.trim().length > 10 &&
  !needsDeliveryPin &&
  !deliveryOutOfArea &&
  !geoLoadFailed &&      // ← new: never submit a claim we could not price
  !placing;
```

Copy on failure: *"Couldn't load delivery details — tap to retry."* Rare (one query against a public table) and strictly better than a deadlocked mismatch loop.

**Pre-checkout surfaces (cart bars on the menu and discovery pages).** These have no delivery address, so they cannot know the fee. Rather than show a total that will change, **show the item total only** — which is what Zomato's cart bar does — with the fee finalised at checkout. `CartContext.pricing` stays distance-blind and is now *only* used for item-total and discount display.

### 5.4 Migration `022_distance_based_delivery.sql`

**(a) `delivery_config` — the knobs.** Follows the `discount_config` pattern (single-row PK trick, `set_updated_at` reuse, no write policy, defensive Realtime add), plus the §3.7 cost CHECKs:

```sql
CREATE TABLE public.delivery_config (
  id                          boolean       PRIMARY KEY DEFAULT true CHECK (id = true),

  -- Delivery fee → partner
  base_fee                    numeric(10,2) NOT NULL DEFAULT 25   CHECK (base_fee >= 0),
  base_distance_km            numeric(4,1)  NOT NULL DEFAULT 2.0  CHECK (base_distance_km > 0),
  per_km_fee                  numeric(10,2) NOT NULL DEFAULT 0    CHECK (per_km_fee >= 0),
  long_distance_km            numeric(4,1)  NOT NULL DEFAULT 5.0,
  long_distance_per_km_fee    numeric(10,2) NOT NULL DEFAULT 0    CHECK (long_distance_per_km_fee >= 0),
  max_delivery_fee            numeric(10,2) NOT NULL DEFAULT 90   CHECK (max_delivery_fee > 0),

  -- Free-delivery waiver (distance-capped)
  free_delivery_min_subtotal  numeric(10,2) NOT NULL DEFAULT 150  CHECK (free_delivery_min_subtotal >= 0),
  free_delivery_max_km        numeric(4,1)  NOT NULL DEFAULT 99   CHECK (free_delivery_max_km >= 0),

  -- Platform fee → RedLotus
  platform_fee                numeric(10,2) NOT NULL DEFAULT 0    CHECK (platform_fee >= 0),

  -- Surge → partner
  surge_fee                   numeric(10,2) NOT NULL DEFAULT 0    CHECK (surge_fee >= 0),
  surge_active                boolean       NOT NULL DEFAULT false,
  surge_starts_at             timestamptz,
  surge_ends_at               timestamptz,
  surge_label                 text          NOT NULL DEFAULT 'Rain fee' CHECK (length(surge_label) BETWEEN 1 AND 40),

  -- Internal cost model — drives the guardrails, never sent to the client
  assumed_cost_per_km         numeric(10,2) NOT NULL DEFAULT 3.5  CHECK (assumed_cost_per_km >= 0),

  updated_at                  timestamptz   NOT NULL DEFAULT now(),

  -- Structural invariants
  CHECK (long_distance_km > base_distance_km),
  CHECK (max_delivery_fee >= base_fee),                    -- keeps the cap from clipping the base
  CHECK (free_delivery_max_km <= base_distance_km
         OR free_delivery_max_km >= 99),                   -- 99 = the "inert at launch" sentinel
  CHECK (surge_starts_at IS NULL OR surge_ends_at IS NULL OR surge_starts_at < surge_ends_at),

  -- Cost-floor invariants (§3.7) — a loss-making tune cannot be saved
  CONSTRAINT delivery_config_per_km_covers_cost
    CHECK (per_km_fee = 0 OR per_km_fee >= 2 * assumed_cost_per_km),
  CONSTRAINT delivery_config_base_covers_cost
    CHECK (base_fee >= 2 * assumed_cost_per_km * base_distance_km),
  CONSTRAINT delivery_config_long_rate_not_cheaper
    CHECK (long_distance_per_km_fee >= per_km_fee)
);

INSERT INTO public.delivery_config (id) VALUES (true);

CREATE TRIGGER set_delivery_config_updated_at
  BEFORE UPDATE ON public.delivery_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

> The two `= 0 OR` escapes on `per_km_fee` and the `>= 99` sentinel on `free_delivery_max_km` exist **only** so Stage 0 can ship inert. Stage 1 sets real values and the guardrails engage permanently. Note this in the migration comment so the escapes are not mistaken for a loophole.

RLS + grants, following the 016/019 column-grant doctrine — **revoke the broad grant first, since Supabase default privileges auto-grant new public tables**, and a table grant out-ranks a column grant:

```sql
ALTER TABLE public.delivery_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.delivery_config FROM anon, authenticated;
GRANT SELECT (
  id, base_fee, base_distance_km, per_km_fee, long_distance_km,
  long_distance_per_km_fee, max_delivery_fee, free_delivery_min_subtotal,
  free_delivery_max_km, platform_fee, surge_fee, surge_active,
  surge_starts_at, surge_ends_at, surge_label, updated_at
) ON public.delivery_config TO anon, authenticated;   -- assumed_cost_per_km withheld

CREATE POLICY delivery_config_read ON public.delivery_config FOR SELECT USING (true);
-- No INSERT/UPDATE policy: Ankit edits via Dashboard/service_role, as with discount_config.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_config;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

Everything granted is printed on a customer-facing surface anyway; `assumed_cost_per_km` is the one commercially-internal value, withheld for the same reason 016 withholds `phone`/`owner_id` and 019 withholds `customer_id`.

**(b) `delivery_config_history` — the audit trail.** Promoted from v1's §8 "v2 someday" into scope, because "why did this order cost that?" is unanswerable six months later without it, and because a revenue swing must be correlatable with the retune that caused it:

```sql
CREATE TABLE public.delivery_config_history (
  version    bigserial   PRIMARY KEY,
  snapshot   jsonb       NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.delivery_config_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_config_history FROM anon, authenticated;
-- admin/service_role only; no policy needed for Dashboard access.

CREATE OR REPLACE FUNCTION public.snapshot_delivery_config()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.delivery_config_history (snapshot) VALUES (to_jsonb(NEW));
  RETURN NEW;
END; $$;

CREATE TRIGGER snapshot_delivery_config_change
  AFTER INSERT OR UPDATE ON public.delivery_config
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_delivery_config();
```

`orders.delivery_config_version bigint` records which snapshot priced each order (§c). One tiny table, one trigger; it makes every historical fee reconstructible.

**(c) `orders` snapshot columns + CHECK swap.** The config can change at any time, so **the decomposition must be stored, not derived** — a `CASE WHEN delivery_fee >= 25` reconstruction is only correct while the config holds its launch values, which is the assumption this plan removes:

```sql
-- Verify the auto-generated name first:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.orders'::regclass
--     AND pg_get_constraintdef(oid) LIKE '%delivery_fee%';
ALTER TABLE public.orders
  DROP CONSTRAINT orders_delivery_fee_check,
  ADD  CONSTRAINT orders_delivery_fee_check CHECK (delivery_fee >= 0);

ALTER TABLE public.orders
  ADD COLUMN delivery_base_fee      numeric(10,2) NOT NULL DEFAULT 0 CHECK (delivery_base_fee >= 0),
  ADD COLUMN delivery_distance_fee  numeric(10,2) NOT NULL DEFAULT 0 CHECK (delivery_distance_fee >= 0),
  ADD COLUMN delivery_distance_km   numeric(5,2)  CHECK (delivery_distance_km IS NULL OR delivery_distance_km >= 0),
  ADD COLUMN platform_fee           numeric(10,2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  ADD COLUMN surge_fee              numeric(10,2) NOT NULL DEFAULT 0 CHECK (surge_fee >= 0),
  ADD COLUMN surge_label            text,
  ADD COLUMN delivery_config_version bigint REFERENCES public.delivery_config_history(version);

-- Historical exactness: every pre-022 order's fee was entirely base.
UPDATE public.orders SET delivery_base_fee = delivery_fee WHERE delivery_fee > 0;
```

The `IN (0, 25)` enumeration is **incompatible with a config-driven fee** — the legal value set changes on every retune, and a lagging CHECK would fail every placement the moment a knob moves. It falls back to the shape `discount_amount` has always had; the RPC recompute was always the real guard.

**(d) `total_amount` trigger.** Must absorb the two new additive components:

```sql
CREATE OR REPLACE FUNCTION public.recalculate_order_total()
RETURNS trigger AS $$
BEGIN
  UPDATE public.orders o
  SET total_amount = (
    SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0)
    FROM public.order_items oi WHERE oi.order_id = NEW.order_id
  ) - o.discount_amount + o.delivery_fee + o.platform_fee + o.surge_fee
  WHERE o.id = NEW.order_id;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
```

**(e) `haversine_km()` — server mirror of `src/lib/geo.ts`.** Same formula, same 6371 km radius, `float8` both sides:

```sql
CREATE OR REPLACE FUNCTION public.haversine_km(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
RETURNS float8 LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371 * asin(sqrt(
    pow(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * pow(sin(radians(lng2 - lng1) / 2), 2)));
$$;
```

No PostGIS, no earthdistance — one `IMMUTABLE` function is the entire geometry dependency.

**(f) `delivery_fee_for()` — server mirror of §3.2.** Returns the **decomposition**, and takes the config **row as an argument** so `place_order` can read `delivery_config` once into a `%ROWTYPE` and price every call against one transaction-consistent snapshot (the same doctrine as its `discount_config` read). Config-as-argument also keeps it `IMMUTABLE`:

```sql
CREATE TYPE public.delivery_fee_breakdown AS (
  base_fee numeric, distance_fee numeric, total_fee numeric
);

CREATE OR REPLACE FUNCTION public.delivery_fee_for(
  p_distance_km numeric,                 -- ALREADY QUANTISED to 2 dp by the caller (§3.6)
  p_subtotal    numeric,
  c             public.delivery_config
) RETURNS public.delivery_fee_breakdown
LANGUAGE sql IMMUTABLE AS $$
  WITH d AS (SELECT COALESCE(p_distance_km, 0) AS km),
  raw AS (
    SELECT
      CASE WHEN p_subtotal >= c.free_delivery_min_subtotal
            AND d.km       <= c.free_delivery_max_km
           THEN 0 ELSE c.base_fee END AS base,
      GREATEST(LEAST(d.km, c.long_distance_km) - c.base_distance_km, 0) * c.per_km_fee
      + GREATEST(d.km - c.long_distance_km, 0) * c.long_distance_per_km_fee AS dist
    FROM d
  ),
  capped AS (SELECT base, LEAST(ROUND(base + dist), c.max_delivery_fee) AS total FROM raw)
  SELECT (base, total - base, total)::public.delivery_fee_breakdown FROM capped;
$$;
```

The cap is applied to the total and the reduction attributed to the distance component; `CHECK (max_delivery_fee >= base_fee)` guarantees `total − base` never goes negative.

**(g) `is_surge_active()`** — mirrors `is_discount_active()`, `STABLE` because it reads `now()`.

**(h) `place_order` v4 — body swap, same 9-arg signature.** Unlike 006 and 015 there is **no `DROP FUNCTION` dance**: the 9-arg signature already carries the pin (015) and the fee claim (006). A plain `CREATE OR REPLACE` swaps the body, which also means no hard break for stale bundles — see §8 for the soft-mismatch window that replaces it.

**(i) `active_restaurants_need_coords` CHECK** (§3.6) and the **`order_settlement` view** (§7).

### 5.5 `place_order` v4 internals

Changes relative to the 015 body, in execution order:

1. **Read the delivery config once**, beside the existing discount read:
   `SELECT * INTO v_dcfg FROM public.delivery_config WHERE id = true;`
   `SELECT MAX(version) INTO v_cfg_version FROM public.delivery_config_history;`
2. **Fetch restaurant geo** beside the existing reads:
   `SELECT lat, lng, delivery_radius_km INTO v_rlat, v_rlng, v_radius FROM public.restaurants WHERE id = p_restaurant_id;`
3. **Compute + quantise distance** (NULL-safe):
   ```sql
   v_distance_km := CASE
     WHEN p_delivery_lat IS NOT NULL AND v_rlat IS NOT NULL
     THEN ROUND(public.haversine_km(v_rlat, v_rlng, p_delivery_lat, p_delivery_lng)::numeric, 2)
   END;
   ```
4. **Server-side radius enforcement** — new, and a deliberate upgrade from 021's client-only doctrine. 021 left the geofence client-side because the pin was *unvalidated metadata*; **this feature makes the pin a pricing input**, so the ceiling needs a server home. The check is one line against data already loaded, and `DELIVERY_TOO_FAR:` needs somewhere to be raised:
   ```sql
   IF v_distance_km IS NOT NULL AND v_distance_km > COALESCE(v_radius, 4) THEN
     RAISE EXCEPTION 'DELIVERY_TOO_FAR: %.2f km exceeds the % km delivery area',
       v_distance_km, COALESCE(v_radius, 4);
   END IF;
   ```
   Raised **before** any pricing work, so a far customer gets the specific error rather than a confusing mismatch. The checkout pre-check (already live from 021) should make this unreachable in practice; it is the backstop for a saved address edited in another tab, a stale bundle, or a radius cut mid-session.
5. **Fee recompute with a ±₹1 tolerance** (§3.6):
   ```sql
   v_fees := public.delivery_fee_for(v_distance_km, v_server_subtotal, v_dcfg);
   v_surge := CASE WHEN public.is_surge_active() THEN v_dcfg.surge_fee ELSE 0 END;

   IF ABS(p_delivery_fee - v_fees.total_fee) > 1.00 THEN
     RAISE EXCEPTION 'PRICING_MISMATCH: delivery_fee client=% server=%',
       p_delivery_fee, v_fees.total_fee;
   END IF;
   ```
   Inside the band the **client's** number is written, honouring "never charge a different amount than what was on screen". Subtotal and discount keep `> 0.01`. A stale-config claim differs by far more than ₹1 and correctly hard-fails → the "Pricing updated — please review your order" toast, Realtime has already refreshed the tab, retry succeeds. Verbatim the discount-flip UX.

   > **Platform and surge fees are NOT claimed by the client.** They are neither distance- nor basket-derived, so there is nothing for the client to get wrong and no reason to widen the signature. The server sets them from config and the client displays what config says — a divergence would show up as a total mismatch on screen, not a failed placement.
6. **Decompose and insert.** Base is distance-independent, so the split stays exact even for a band-accepted claim:
   ```sql
   v_base      := v_fees.base_fee;
   v_dist_fee  := GREATEST(v_server_delivery_fee - v_base, 0);
   ```
   Insert with `delivery_fee`, `delivery_base_fee`, `delivery_distance_fee`, `delivery_distance_km` (NULL passes through), `platform_fee = v_dcfg.platform_fee`, `surge_fee = v_surge`, `surge_label` (only when surge > 0), `delivery_config_version = v_cfg_version`.

`Checkout.tsx` error mapping gains one branch above the `PRICING_MISMATCH:` one: `DELIVERY_TOO_FAR:` → *"This address is outside {restaurant}'s delivery area. Try a closer restaurant, or contact us on WhatsApp."*

### 5.6 UI changes

| Surface | Change |
|---|---|
| `Checkout` breakdown | `Delivery fee (3.0 km)` — amount, or `FREE` when `deliveryBaseFee === 0 && deliveryDistanceFee === 0`. Conditional `{surgeLabel} ₹X` line when `surgeFee > 0`. Conditional `Platform fee ₹X` when `platformFee > 0`. All from `effectivePricing`. |
| `Checkout` submit button | `Place Order · ₹{effectivePricing.total}` — must match what the RPC will accept. |
| `Checkout` address section | Geofence notice (already live). New: retry affordance when `geoLoadFailed` (§5.3). |
| `Checkout` nudge | Waiver-aware. Within the distance cap: *"Add ₹X more for free delivery."* Beyond it: *"Free delivery applies within {freeDeliveryMaxKm} km of the restaurant."* — never promise a waiver the distance has already disqualified. |
| `ConfirmOrderModal` | New optional props `deliveryDistanceKm` / `platformFee` / `surgeFee` / `surgeLabel`; mirrors the same conditional lines. `freeDeliveryThreshold` now fed from `deliveryConfig`. |
| Menu / discovery cart bars | **Show item total only** (§5.3) — drop the misleading pre-address "total". |
| `DiscoveryPage` strip, `RestaurantMenu` pill | Swap the `FREE_DELIVERY_THRESHOLD` import for `useDeliveryConfig()`, and add the distance qualifier: *"Free delivery on ₹150+ within 2 km"*. Three importers total (`Checkout`, `RestaurantMenu`, `DiscoveryPage`); `DELIVERY_FEE_RUPEES` has none outside `pricing.ts`. |
| `Hero.tsx` | Same swap if its copy names the threshold. |
| `FAQ.tsx` | Rewrite the delivery answer to interpolate config: *"Delivery is free on orders ₹{threshold}+ within {freeMaxKm} km of the restaurant. Otherwise there's a ₹{base} delivery fee covering the first {baseKm} km, plus ₹{perKm}/km beyond that — always shown in your cart before you confirm."* Hardcoded numbers here go stale on the first retune. |
| `PartnerProgram.tsx` | **Requires the D1 disclosure rewrite.** Number-free prose: *"The delivery fee your customer pays is yours to keep — it's calculated from the distance to their door. RedLotus charges a small platform fee per order, settled with your monthly invoice."* Deliberately figure-free so a retune cannot strand stale rupees on a commitment page; the FAQ carries live numbers. |
| `OrderStatus` / `OrderHistory` | Render lines from the **stored snapshots**, never live config — historical orders must show what was charged then. Add the new columns to their selects. Pre-022 rows have distance/platform/surge = 0 → no extra lines, correct by construction. |

### 5.7 Owner dashboard

- `PENDING_ORDER_SELECT` / `ACTIVE_ORDER_SELECT` add `delivery_distance_km, delivery_base_fee, delivery_distance_fee, platform_fee, surge_fee`. Cards render **"≈ 3.0 km"** beside the existing `Navigate ▸` link — they already carry the pin; this saves the owner opening Maps to judge the run.
- `pcard__settle` / `acard__settle` needs no structural change (it prints generically and suppresses at 0), but the caption gains the split from stored columns:
  *"Collect ₹252 in cash. ₹50 delivery is yours; ₹6 platform fee settles with RedLotus."*
- `HistorySection` and the Realtime handlers are untouched (payload-driven, column-agnostic).

---

## 6. Trust Model — the pin is now a pricing input

Migration 015 classified `delivery_lat/lng` as *"unvalidated client metadata: they only ever feed the owner's Maps link, and a customer can only misplace their own delivery."* **This feature breaks that classification**, so the threat is re-argued rather than inherited:

| Vector | Analysis | Verdict |
|---|---|---|
| **Spoof-near** (fake the pin close to dodge the distance fee) | The attacker corrupts their own Maps link and still hands the owner a typed address showing the true location. The owner sees "≈ 0.4 km" beside an address they know is in the far colony — a visible contradiction, with the decline path right there. Financial ceiling: one order's distance fee. | **Accepted.** Human gate + bounded loss. |
| **Skip-the-pin** (v1's largest hole) | **Closed structurally.** `canPlace` requires a pin, and `active_restaurants_need_coords` (§3.6) removes the other unmeasurable branch. There is no supported path to place an order with an unknown distance. | **Eliminated.** |
| **Spoof-far / griefing** | Pinning far *raises* one's own fee or blocks one's own order. Self-harming. | No defence needed. |
| **Client fee tampering** (call the RPC directly with a low `p_delivery_fee`) | The server recomputes from live config and its own haversine; the ±₹1 band is the only slack. | **Closed.** |
| **Radius bypass** | Now enforced server-side (§5.5 step 4), upgraded from 021's client-only gate. | **Closed.** |

What the server guarantees: fee recomputed from live config in-transaction, consistent with the claimed pin, pin bounded to the globe, radius enforced, decomposition and config version snapshotted. What it cannot guarantee — that the pin is where the customer physically *is* — is the residual v1 accepts everywhere else (same class as the discovery override seeding `VILLAGE_CENTRE`).

**Re-visit triggers:** a partner reports repeated short-distance fees on runs they know were long; the §9 margin view flags a persistent below-cost cohort; expansion pushes real runs past the fee cap. Escalation order for v2: pin-accuracy gating (`getCurrentPositionOnce` already surfaces accuracy), then address autocomplete / forward geocoding — which also closes `v2_deferred_issues.md` §3's desktop dead-end with one integration.

---

## 7. Settlement & Partner Economics

**The split (D1).** Under COD the mechanics cost nothing: the restaurant already collects the full `total_amount` in cash. Pass-through means **the monthly net-out claims only the platform fee**, and the partner keeps delivery + surge. Encoded once as a view so the rule lives in one place and is exact across every retune:

```sql
CREATE OR REPLACE VIEW public.order_settlement AS
SELECT
  o.id, o.restaurant_id, o.created_at, o.status,
  o.total_amount,
  o.delivery_fee + o.surge_fee                       AS partner_keeps,   -- kilometres are theirs
  o.platform_fee                                     AS redlotus_claims, -- the flat margin line
  o.delivery_distance_km,
  o.delivery_config_version
FROM public.orders o;
```

Monthly invoice input:

```sql
-- Stored snapshots — NEVER re-derive from live delivery_config; it may have
-- changed mid-month, and the snapshots are the truth of what each order charged.
SELECT restaurant_id,
       COUNT(*)                 AS orders,
       SUM(redlotus_claims)     AS platform_fees_due,
       SUM(partner_keeps)       AS partner_delivery_earnings
FROM public.order_settlement
WHERE status = 'completed' AND created_at >= :month_start AND created_at < :month_end
GROUP BY restaurant_id;
```

**What partners need told, 48h before Stage 1** (same playbook as the 006 rollout): far deliveries now pay, and the money is theirs. This is a rare partner-facing change that is unambiguously good news — lead with it.

**Retune operating guidance.** Effects are immediate: Realtime converges open tabs in seconds, the RPC enforces new values on the next placement. A customer mid-checkout during an edit sees at most one "Pricing updated" toast, then succeeds. Same courtesy as deploys: **avoid retuning during 12–2 PM and 7–9:30 PM**, and make each change in **one Dashboard save** (the row updates atomically; two saves = two mismatch windows). Raising `free_delivery_min_subtotal` is instantly visible on every copy surface — pair it with an announcement.

**Unchanged:** COD-only, the discount model, 15-min expiry, cancellation rules, the ETA promise, subscription pricing and cadence.

---

## 8. Rollout — staged activation

The migration and the price change are **separate events**. Ship the machinery inert, validate it in production, then move one knob at a time.

### Stage 0 — ship the machinery (behaviour-preserving)

1. **Migration `022`** — §5.4 (a)–(i) atomically. Pre-flight `SELECT id, name FROM restaurants WHERE is_active AND (lat IS NULL OR lng IS NULL);` before the coords CHECK. Verify on a Supabase preview branch (preview branches carry no secrets/pg_cron, but nothing here needs either; the Realtime publication add is in-migration so previews exercise it).
2. **Seed = today's model exactly:** `per_km_fee = 0`, `long_distance_per_km_fee = 0`, `free_delivery_max_km = 99`, `platform_fee = 0`, `surge_active = false`. Every §4.1 row is byte-identical to current output.
3. **Frontend in the same deploy:** `pricing.ts`, `DeliveryConfigContext` + `main.tsx` provider order, `Checkout` effective pricing + `geoLoadFailed` guard + error branch, `ConfirmOrderModal`, copy swaps, order pages, dashboard selects, FAQ, `PartnerProgram`.
4. **Regenerate `src/types/database.ts`** (`delivery_config`, `delivery_config_history`, new `orders` columns, new function signatures, the composite type, the view) — Docker / `--linked` per the `supabase-type-gen` notes.
5. **Stale-bundle window.** Because the signature did not change, a pre-022 bundle keeps calling successfully. At Stage 0 seeds it agrees with the server on every order, so the window is genuinely empty — a strict improvement on v1's plan, which had stale clients mismatching from the moment the migration landed. The window only opens at Stage 1, by which time `skipWaiting` has long since rolled every client forward.

### Stage 1 — distance pricing on (day ~7)

Partner announcement **48h ahead** (§7). Then one Dashboard save:
`per_km_fee = 10`, `long_distance_per_km_fee = 14`, `free_delivery_max_km = 2.0`.

Pick a quiet hour. Watch an open checkout tab update via Realtime, place a test order at a known distance, and verify the snapshots — `delivery_base_fee + delivery_distance_fee = delivery_fee`, `delivery_distance_km` matches, `delivery_config_version` points at the new history row. **Monitor 7 days** (§9) before going further.

### Stage 2 — platform fee on (day ~30, D2)

`platform_fee = 6`. Watch order volume for a week against the Stage 1 baseline. Fully reversible — set it back to 0.

### Stage 3 — threshold retune (when basket data supports it)

`free_delivery_min_subtotal = 199` per the §3.3 tuning rule. Customer-visible everywhere instantly; pair with an announcement.

### Tests land with the code (Stage 0)

Per the CLAUDE.md testing scope — high-risk pure logic:

- **`pricing.test.ts`**
  - `computeDeliveryFee` across the curve: 0, `base_distance_km` exactly (inclusive), just past it, at `long_distance_km`, past it, at and beyond `max_delivery_fee`, and `null` → base only.
  - The **waiver matrix** — all four combinations of (subtotal ≥/< threshold) × (distance ≤/> `free_delivery_max_km`), asserting the waiver applies in exactly one.
  - The same cases against a **retuned** config with different edges and rates, proving no seed values leaked into the logic.
  - `quantiseDistanceKm` rounding, and that pricing is stable under ±1e-9 km input jitter.
  - `isSurgeLive` window boundaries.
  - §4 worked-example rows, including the decomposition fields.
  - **A regression guard:** the default-config, null-distance call stays byte-identical to today's output — the safety net for every pre-checkout surface.
  - **The Cost-Floor property test:**
    ```ts
    // Encodes §1.3 in CI: no configured distance may be priced below the
    // marginal cost of the round trip. Fails loudly if a seed is retuned
    // below cost in code — the DB CHECK is the runtime half of this pair.
    const ASSUMED_COST_PER_KM = 3.5;
    for (let d = 0.1; d <= 15; d += 0.1) {
      const { totalFee } = computeDeliveryFee(d, 0, SEEDED_CONFIG);
      expect(totalFee).toBeGreaterThanOrEqual(2 * ASSUMED_COST_PER_KM * d);
    }
    ```
    Note this test intentionally uses `subtotal = 0` (no waiver) and will surface the `max_delivery_fee` cap's break-even distance — the §3.6 ops rule, asserted rather than remembered.
- **`CartContext.test.tsx`** — mock `DeliveryConfigContext` alongside the existing `DiscountConfigContext` mock. No cart-shape change (§5.3), so the existing reducer tests stand.
- **`geo.test.ts`** — already covers `haversineKm`; no change.

---

## 9. Monitoring & Guardrails

The database CHECKs make a loss-making *configuration* impossible. These queries catch a loss-making *outcome* — a bad pin, a cap binding, a restaurant with an over-wide radius.

**(a) The margin view — the primary watch.**

```sql
CREATE OR REPLACE VIEW public.order_delivery_margin AS
SELECT
  o.id, o.restaurant_id, o.created_at, o.delivery_distance_km,
  o.delivery_fee + o.surge_fee                                   AS collected,
  ROUND(2 * o.delivery_distance_km * c.assumed_cost_per_km, 2)   AS est_round_trip_cost,
  ROUND(o.delivery_fee + o.surge_fee
        - 2 * o.delivery_distance_km * c.assumed_cost_per_km, 2) AS est_margin
FROM public.orders o
CROSS JOIN public.delivery_config c
WHERE o.delivery_distance_km IS NOT NULL;
```

**(b) Weekly: any order that came in under cost.** Should be exactly the free-delivery cohort inside `free_delivery_max_km` and nothing else.

```sql
SELECT restaurant_id, COUNT(*) AS below_cost_orders,
       ROUND(AVG(est_margin), 2) AS avg_margin,
       ROUND(MIN(est_margin), 2) AS worst
FROM public.order_delivery_margin
WHERE est_margin < 0 AND created_at >= now() - interval '7 days'
GROUP BY restaurant_id ORDER BY worst;
```

**(c) The cap/radius lint** — §3.6's cross-table rule, run after any radius change:

```sql
-- Any restaurant whose radius extends past where the fee cap covers cost.
SELECT r.id, r.name, r.delivery_radius_km, c.max_delivery_fee,
       ROUND(2 * r.delivery_radius_km * c.assumed_cost_per_km, 2) AS cost_at_edge
FROM public.restaurants r CROSS JOIN public.delivery_config c
WHERE r.is_active
  AND 2 * r.delivery_radius_km * c.assumed_cost_per_km > c.max_delivery_fee;
```

**(d) Distance distribution** — tells you whether Stage 1 is even worth its complexity, and where to set `base_distance_km`:

```sql
SELECT width_bucket(delivery_distance_km, 0, 8, 8) AS km_bucket,
       COUNT(*), ROUND(AVG(delivery_fee), 2) AS avg_fee
FROM public.orders
WHERE created_at >= now() - interval '30 days' AND delivery_distance_km IS NOT NULL
GROUP BY 1 ORDER BY 1;
```

**Stage-1 watch list, 7 days:** fee distribution by bucket; `DELIVERY_TOO_FAR` frequency (the checkout pre-check should make RPC hits ~0 — spikes mean a stale bundle or a bug); `PRICING_MISMATCH` rate during the deploy window; order volume in the 2–4 km band (the cohort whose price moved most); any partner distance dispute.

---

## 10. Risks Register

| Risk | Severity | Mitigation |
|---|---|---|
| **Village price sensitivity.** A ₹35 fee on a ₹220 order is 16% — routine on Zomato, possibly not here. | **High** | Staged activation (§8) with volume monitoring at each stage; every knob reversible from the Dashboard in seconds. `base_distance_km` is the lever — widening it keeps the village cheap while the curve still protects the tail (D3). |
| **The waiver cliff at `free_delivery_max_km`.** Row 7 of §4.2: ₹196 → ₹222 across 200 m. | Medium | Inherent to any threshold (the ₹150 discount floor has the same shape). Nudge copy states the rule (§5.6). If it generates complaints, widen the cap — one Dashboard edit. |
| **D1 changes a partner-facing commitment.** `PartnerProgram.tsx` currently says delivery fees are RedLotus revenue. | Medium | The change is in the partner's favour. Rewrite the disclosure in the Stage 0 deploy, announce at Stage 1 (§7). |
| **GST / e-commerce-operator treatment.** Delivery and platform fees attract GST; ECO registration under CGST §24(ix) can be mandatory *regardless of turnover*, and §9(5) can make an ECO liable for GST on restaurant services supplied through it. If any of that binds, a ₹6 platform fee nets ~₹5.08 and the margin model above is overstated. | **High — unresolved** | **Not a question this plan can answer.** Take these three to a CA before Stage 2: (i) Is RedLotus an "e-commerce operator" when it never handles payment (COD, restaurant collects)? (ii) Does §9(5) attach to restaurant services ordered through the platform? (iii) Are the delivery and platform fees to be quoted GST-inclusive? Record the answer in this doc. Stages 0 and 1 are unaffected — the delivery fee passes through to the partner and RedLotus's revenue is unchanged until Stage 2. |
| **Crow-flies vs road distance.** A river, canal, or highway crossing makes 2 km fly into a 5 km ride. | Low–Medium | Slab-free curve absorbs modest divergence. `base_distance_km` widening is the blunt fix. Routing API is the v2 escalation (§11) — trigger is real, repeated partner disputes. |
| **Fee cap binds below cost past ~10 km.** | Low today | §9(c) lint plus an onboarding-checklist line. Becomes real only on expansion. |
| **Rider labour is excluded from the cost model.** The figures cover the vehicle only; a partner paying a dedicated rider adds roughly ₹15–25 per run. | Medium | Deliberate: most Gudha Gorji partners deliver with family labour, so a wage line would over-price the common case. `assumed_cost_per_km` is the lever — raising it auto-raises the CHECK floor (§3.7). Revisit when a partner hires. |

---

## 11. Open Questions for v2

- **Per-restaurant fee overrides.** The natural sibling of 021's per-restaurant radius: nullable `restaurants.base_fee_override` / `per_km_fee_override`, with `delivery_fee_for` resolving `COALESCE(override, global)`. The seam is already in place — the function takes a config row, so the resolver would build that row per restaurant. Deferred at 5 restaurants in one village.
- **`PricingConfigContext` consolidation.** Two near-identical hydrate-plus-Realtime contexts beg for one provider over two rows. Deferred so this change does not churn the working discount context and its consumers.
- **Membership / free-delivery pass** — the Gold/One analogue. Needs scale and a payments rail; the distance-capped waiver is the v1 stand-in.
- **Address autocomplete / forward geocoding** — closes `v2_deferred_issues.md` §3's desktop dead-end and improves pin quality with one integration.
- **Road distance via a routing API** — only if crow-flies produces real, repeated disputes.
- **Weather-API auto-surge** — replaces the manual toggle once volume justifies it.
- **Distance-aware ETA defaults** — the distance is on the owner's card already; defaulting `AcceptOrderModal`'s preset chip from it is a few lines whenever it is wanted.
- **Rider-labour cost line** — a second cost coefficient (₹/minute) once any partner hires, feeding the same CHECK machinery.

---

## 12. Doc Updates Required When This Ships

1. **CLAUDE.md** — rewrite the **Delivery fee** bullet under Product/business constraints: the five-component stack, server-controlled via `delivery_config` (mirror the `discount_config` paragraph's framing), the **distance-capped** free-delivery waiver, the cost-floor CHECKs, D1's partner pass-through, the platform fee, the snapshot columns, and the `DELIVERY_TOO_FAR:` contract. Also update: the migration list (022), the file map (`DeliveryConfigContext`), the `main.tsx` provider order, the `place_order` critical rule (still 9 args; body now prices distance and enforces the radius **server-side**), the **015 bullet's "unvalidated client metadata / no server recompute is possible" claim — superseded, per §6**, the **021 bullet's "enforcement stays client-side" claim — now enforced in the RPC too**, and the routes-table Checkout row.
2. **GEMINI.md** — mirror the same passages (CLAUDE.md Notes §: keep in sync on structural changes).
3. **`discount_and_delivery_fee_plan.md`** — mark §2.1's flat-fee model and §6's open question as superseded by this doc.
4. **`v2_deferred_issues.md`** — replace v1's planned *"typed-only orders bypass the surcharge"* entry (that hole is now closed, §6) with the live items: per-restaurant overrides, road distance, the GST question until a CA answers it.
5. **`play_store_launch_runbook.md`** — if any store listing or screenshot names a delivery price, refresh before Stage 1.
6. **This doc** — flip Status to Shipped with the migration/PR reference, and record the Stage 1/2/3 dates and the CA's GST answer inline.
