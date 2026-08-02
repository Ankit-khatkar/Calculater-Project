# Delivery Pricing — Database-Authoritative, Distance-Based — Build Plan v3

> **Status:** Proposed (not yet implemented)
> **Author:** Ankit
> **Revision:** v3 — 2026-08-02. Supersedes v2 (2026-08-02) and v1. **The flat ₹25 / free-above-₹150 model is placeholder data and is deleted outright** — this plan does not preserve it, does not stage around it, and does not keep a code-side copy of it. Delivery pricing is computed from a cost model and lives entirely in the database.
> **Depends on:** migration 006 (`discount_config` pattern + pricing breakdown), 015 (delivery pin + address book), 021 (`restaurants.delivery_radius_km`).
> **Replaces:** the delivery-fee half of `discount_and_delivery_fee_plan.md` (§2.1 flat fee, §6 open question). The discount half of that doc stands unchanged.
> **Migration:** **`022_distance_based_delivery.sql`** (020 = `device_tokens`, 021 = `delivery_radius`).

**The two principles everything below follows:**

1. **The database is the only authority on price.** No delivery figure is hardcoded anywhere in the frontend — not as a constant, not as a fallback, not as a pre-hydration default. A client that cannot read `delivery_config` shows no fee and cannot place an order.
2. **A loss-making price must be unrepresentable, not merely discouraged.** The cost model lives in the config row alongside the price knobs, and database CHECKs bind the two together. A fee below the marginal cost of the ride cannot be saved (§3.7).

---

## 0. What this plan needs from Ankit

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| **D1** | **Who keeps the delivery fee?** Today it is RedLotus revenue while the *partner* does the riding. | **Flip it — the delivery fee and surge go to the partner.** RedLotus's per-order line becomes the new `platform_fee`. | §7. Forced, not stylistic (§1.3). Any model where the partner rides and RedLotus keeps the kilometre money leaves the partner underwater on far orders, and partner churn is the loss that kills a ₹1,500/mo subscription business. Requires a `PartnerProgram.tsx` disclosure rewrite — in the partner's favour. |
| **D2** | **Approve the seed numbers** (§3.2 table). They are derived from the cost model, not from the old ₹25. | Ship the table as-is. `base_distance_km` and `free_delivery_min_subtotal` are the softening levers if the village pushes back. | §3. Every number is a Dashboard edit away from changing, so this is a starting point, not a commitment. |
| **D3** | **Cutover timing.** Prices change the moment this deploys — there is no inert stage, because there is no legacy behaviour worth preserving. | Off-peak weekday, partner announcement 48h ahead, customer notice in-app. | §8. The one-reload stale-bundle window is the only rough edge; it is bounded and off-peak. |

---

## 1. Why This Change

### 1.1 The flat ₹25 was never costed

`src/lib/pricing.ts` currently hardcodes:

```ts
export const DELIVERY_FEE_RUPEES = 25;
export const FREE_DELIVERY_THRESHOLD = 150;
```

…mirrored by a literal `IF v_server_subtotal >= 150 THEN 0 ELSE 25` inside the `place_order` RPC and a `CHECK (delivery_fee IN (0, 25))` on the table. Those numbers were placeholder values chosen to get v1 shipped. They were never derived from what a delivery costs, they exist in three places that can drift apart, and two of the three require a deploy to change.

**All of it is deleted by this plan.** Not demoted to a default, not kept as a fallback — removed, along with the CHECK that enumerates it.

### 1.2 What the platform can now support

1. **The pin is mandatory.** `Checkout.tsx` has `!needsDeliveryPin` inside `canPlace`, so **every order carries measurable coordinates**. Distance is a reliable pricing input, not a best-effort one.
2. **021 made service area per-restaurant.** `restaurants.delivery_radius_km` already answers *"will they deliver there?"*. What is unanswered is *"what does that ride cost, and who pays?"*
3. **Restaurants deliver their own orders.** Every marginal kilometre lands on the partner's fuel bill. Under a flat fee, a 5 km run on a ₹300 basket is priced at **₹0**.

### 1.3 The cost model

A 2-wheeler doing local stop-start delivery, Rajasthan, 2026:

| Cost line | Figure | Notes |
|---|---|---|
| Petrol | ₹105/L ÷ ~44 km/L | Real delivery mileage, not the sticker figure |
| ⇒ fuel | **₹2.40/km** | |
| Consumables (oil, chain, tyres, brakes, servicing) | **₹0.70/km** | |
| Depreciation (₹85k bike → ₹25k resale over ~60,000 km) | **₹1.00/km** | Felt on replacement, not weekly |
| Cash cost (what the partner feels weekly) | ≈ ₹3.10/km | fuel + consumables |
| Fully-loaded vehicle cost | ≈ ₹4.10/km | incl. depreciation |
| **Planning figure — `delivery_config.assumed_cost_per_km`** | **₹3.50/km** | Dashboard-tunable; drives the guardrail CHECKs |

**A delivery is a round trip.** A customer 3 km away is 6 km ridden, so the marginal vehicle cost is **2 × `assumed_cost_per_km` = ₹7.00 per km of delivery distance**, before any rider labour.

Against that, the flat model:

| Order | Collected for the ride | Round-trip cost | Partner P&L |
|---|---|---|---|
| ₹120 cart, 1 km | ₹25 | ₹7 | +₹18 |
| ₹220 cart, 3 km | **₹0** (waived at ₹150+) | ₹21 | **−₹21** |
| ₹700 cart, 6 km | **₹0** | ₹42 | **−₹42** |

The flat fee is not merely imprecise — it inverts. It charges most where the ride is cheapest and nothing where the ride is dearest, because basket size and distance are uncorrelated. That is the defect this plan removes.

> **Cost-Floor Invariant** — the marginal fee per kilometre must exceed the marginal cost per kilometre of the round trip. Enforced as a database CHECK (§3.7), so a loss-making configuration is *unrepresentable*.

### 1.4 Which "loss" we are protecting against

Two different losses, needing two different instruments:

- **Partner loss** (the real threat). Delivery cost exceeds what the order contributes. Left alone it shows up as partners quietly refusing far orders, then disputing, then churning off the subscription. **Instrument: the distance fee, paid to the partner (D1).**
- **RedLotus loss.** Platform revenue is subscription-only once the fee is waived — which it is on most orders today. **Instrument: the platform fee.**

Copying Zomato's stack without this split would have RedLotus collecting kilometre money it does not spend while the partner still eats the fuel. §7 keeps the two ledgers separate.

### 1.5 What deliberately does not change

The discount model and `discount_config`; COD-only; the single-restaurant cart; the `place_order`-only write path; 15-minute expiry; cancellation and ETA rules; subscription pricing.

---

## 2. What Zomato and Swiggy Actually Do

> **Figures are indicative.** Both platforms change fees frequently, vary them by city, restaurant and time of day, and A/B test continuously. Treat the *structure* as the durable lesson and spot-check *numbers* in the apps before adopting any.

### 2.1 Their fee stack

| Component | Typical shape | Purpose |
|---|---|---|
| **Delivery fee** | Distance-based: a base covering the first ~2 km, then a per-km rate that **steps up** past a long-distance threshold. | Cover the rider. |
| **Platform fee** | Flat per order, **never waived** — not by basket size, not by membership. Started ~₹2, ratcheted up repeatedly, higher on peak days. | Pure margin, basket- and distance-independent. |
| **Surge / rain fee** | Additive, on during rain, peak hours, festivals. | Rider supply collapses exactly when demand spikes. |
| **Small-order fee** | Flat fee below a minimum cart value. | Make thin baskets worth dispatching. |
| **Membership (Gold / One)** | Free delivery **only above a min cart value AND only within a distance cap**, at eligible restaurants. Platform fee still applies. | Retention without unbounded subsidy. |

### 2.2 The four structural lessons

1. **Per-km beyond a base, not fixed slabs.** Slabs create cliffs (a 4.01 km order jumping ₹10 is a support ticket) and go stale on expansion. A per-km curve extends to any distance and retunes with one number.
2. **A steeper second rate.** Long runs are *disproportionately* expensive — rider time, not just fuel, and the dead leg home is unproductive.
3. **Free delivery is never unconditional.** Bounded on **three** axes simultaneously: minimum cart value, **maximum distance**, and eligible-restaurant set. The current RedLotus model bounds it on one, which is why a ₹300 order 6 km away is free.
4. **A flat, unwaivable per-order fee is what fixed their unit economics.** Not the delivery fee — that mostly passes through to riders. The platform fee is the line that survives every discount, every membership, and every basket size.

### 2.3 What we deliberately do NOT copy

| Not copying | Why |
|---|---|
| **Small-order fee** | Redundant here. The distance-capped waiver *is* our small-order mechanism — below `free_delivery_min_subtotal` the customer already pays full delivery. Numbers: a ₹60 order at 3 km yields the partner ~₹36 food contribution + ₹35 delivery − ₹21 cost = **+₹50**. No dispatch problem to solve. |
| **Membership tier** | Needs scale and a payments rail; RedLotus is COD-only with ~5 restaurants. The waiver plays the retention role. |
| **Real-time algorithmic surge** | Needs a rider-supply signal RedLotus does not have (partners dispatch their own people). Replaced by a manual Dashboard toggle + optional scheduled window (§3.5) — at this scale, flipping a switch when it starts raining beats a weather API. |
| **Road distance via routing API** | Cost, latency, a key to rotate, and a hard dependency in the placement path. Crow-flies is adequate at village scale; §10 has the revisit trigger. |
| **Per-restaurant fee overrides** | Real (a partner with a scooter vs one walking) but over-engineering at 5 restaurants in one village. The resolver seam is built for it (§5.4f); the columns are v2. |
| **Restaurant packaging charges** | Partners set their own menu prices; a separate packaging line would only confuse. |

---

## 3. The Pricing Model

Everything below lives in one `delivery_config` row and is Dashboard-editable with no deploy. What the *code* fixes is the **shape**; the numbers are data.

### 3.1 The components

```
Item total       (subtotal)                       — menu list prices
− Discount                                        — unchanged, discount_config
+ Delivery fee   = base + distance component      → PARTNER   (D1)
+ Surge fee      = surge_fee when live            → PARTNER
+ Platform fee   = platform_fee, ALWAYS           → REDLOTUS
──────────────────────────────────────────────────
= To pay (cash)  total_amount
```

| Component | Config fields | Waivable? | Owner |
|---|---|---|---|
| Base delivery | `base_fee`, `base_distance_km` | **Yes** — only when subtotal ≥ `free_delivery_min_subtotal` **AND** distance ≤ `free_delivery_max_km` (§3.3) | Partner |
| Distance | `per_km_fee`, `long_distance_km`, `long_distance_per_km_fee`, `max_delivery_fee` | **Never** | Partner |
| Surge | `surge_fee`, `surge_active`, `surge_starts_at/ends_at`, `surge_label` | Never (it is simply ₹0 when not live) | Partner |
| Platform | `platform_fee` | **Never** | RedLotus |

### 3.2 The distance curve

`distance_km` = haversine from `restaurants.lat/lng` to the confirmed pin (`orders.delivery_lat/lng`), **quantised to 2 dp (10 m) before pricing** (§3.6).

```
distance_fee(d) =
      max(0, min(d, long_distance_km) − base_distance_km) × per_km_fee
    + max(0, d − long_distance_km)                        × long_distance_per_km_fee

delivery_fee(d, subtotal) = min( round( base_component + distance_fee(d) ), max_delivery_fee )
```

**Seed values — derived from §1.3, not from the old ₹25:**

| Field | Seed | Derivation |
|---|---|---|
| `base_fee` | **₹20** | Covers the fixed per-order cost (handover, cash handling, finding the door) plus the round trip inside `base_distance_km` — ₹10.50 of cost at the edge, leaving ₹9.50. |
| `base_distance_km` | **1.5 km** | The dense core of Gudha Gorji. Widening it is the price-sensitivity lever (D2) but forces `base_fee` up via the §3.7 CHECK. |
| `per_km_fee` | **₹10/km** | Round-trip cost is ₹7.00/km; ₹10 leaves ₹3/km of partner margin and clears the CHECK. |
| `long_distance_km` | **5.0 km** | Where rider time starts dominating fuel. |
| `long_distance_per_km_fee` | **₹14/km** | Twice the round-trip cost — far runs should be attractive, not merely break-even. |
| `max_delivery_fee` | **₹90** | Customer protection and a guard against a bad pin. Starts binding at 8 km. |
| `free_delivery_min_subtotal` | **₹199** | §3.3 formula floor is ₹141 — this leaves headroom to run promos downward. |
| `free_delivery_max_km` | **1.5 km** | = `base_distance_km`, the CHECK's maximum. The waiver can never reach into distance-priced territory. |
| `platform_fee` | **₹5** | §3.4. |
| `surge_fee` | **₹15**, `surge_active = false` | §3.5. Off until it rains. |
| `assumed_cost_per_km` | **₹3.50** | §1.3. Internal — not granted to the client. |

Resulting curve:

| Distance | Delivery fee | Round-trip cost @ ₹3.50/km | Fully-loaded @ ₹4.10/km | Partner margin |
|---|---|---|---|---|
| 1.0 km | ₹20 | ₹7 | ₹8 | **+₹13** |
| 1.5 km | ₹20 | ₹11 | ₹12 | **+₹9** |
| 2.0 km | ₹25 | ₹14 | ₹16 | **+₹11** |
| 3.0 km | ₹35 | ₹21 | ₹25 | **+₹14** |
| 4.0 km | ₹45 | ₹28 | ₹33 | **+₹17** |
| 5.0 km | ₹55 | ₹35 | ₹41 | **+₹20** |
| 6.0 km | ₹69 | ₹42 | ₹49 | **+₹27** |
| 7.0 km | ₹83 | ₹49 | ₹57 | **+₹34** |
| 8.0 km | ₹90 (capped) | ₹56 | ₹66 | **+₹34** |

Margin is positive at every distance and **grows** with distance. The cap starts binding at 8 km and reaches break-even against fully-loaded cost around 11 km — see §3.6 for the ops rule that keeps it honest.

> Note the 2 km fee lands on ₹25 by arithmetic, not by anchoring. It is a useful sanity check that the cost-derived curve produces a familiar-feeling number in the common case, which should make the cutover feel smaller than it is.

### 3.3 Free delivery — bounded on cart value AND distance

The waiver removes **only the base component**, and only when both conditions hold:

```
subtotal ≥ free_delivery_min_subtotal   (seed ₹199)
AND  distance ≤ free_delivery_max_km    (seed 1.5 km)
```

Beyond `free_delivery_max_km`, **the full fee including base is charged regardless of basket size.** A CHECK enforces `free_delivery_max_km <= base_distance_km`, so the waiver can never extend into the distance-priced region — the subsidy is structurally bounded to the base fee on short runs.

**The subsidy that remains is deliberate.** Inside 1.5 km on a ₹199+ basket, delivery is genuinely free and the partner absorbs ≤ ₹12 of fully-loaded cost against ~₹115 of food contribution (at a typical 55–60% gross margin) — about 11%. That is the promotional lever, bounded on both axes.

**Tuning rule for the threshold** — the retune Ankit will actually make:

```
free_delivery_min_subtotal  ≥  round_trip_cost(free_delivery_max_km) / (target_subsidy_share × food_margin_share)
```

At the seed — ₹12.30 loaded cost, 15% target subsidy share, 58% food margin — the floor is **₹141**. The ₹199 seed sits comfortably above it.

**Turning the waiver off** for a period: set `free_delivery_max_km = 0` (no distance qualifies). **Widening it** for a campaign: raise `base_distance_km` — which forces `base_fee` up to satisfy the cost CHECK. Both paths stay inside the guardrails by construction.

### 3.4 Platform fee

Flat, per order, **never waived by anything** — not basket size, not distance, not the discount campaign. Seeded at **₹5**.

This is RedLotus's revenue line, replacing the base fee that D1 hands to the partner. Modelled: if ~70% of orders clear the old ₹150 threshold, the flat model averages ₹25 × 30% ≈ **₹7.50/order** — but only from small baskets, so it *shrinks* as the business succeeds. A ₹5 flat fee on 100% of orders is comparable in level and **stable against basket mix**. That is the argument for it.

Honest counterweight: it is visible on every order, including the ones that are otherwise free. It is a single Dashboard field — set it to 0 for a launch period if the village reaction warrants.

### 3.5 Surge

One additive fee, off by default:

```
surge_live = surge_active
             AND (surge_starts_at IS NULL OR now() >= surge_starts_at)
             AND (surge_ends_at   IS NULL OR now() <  surge_ends_at)
```

Same predicate shape as `is_discount_active()`, minus the day-of-week mask. `surge_label` (seed `'Rain fee'`) is the customer-facing line label, so it can be retitled `'Peak hour'` or `'Festival surcharge'` without a deploy.

Operationally: it rains, Ankit sets `surge_active = true`, Realtime pushes it to every open tab within seconds, checkout shows `Rain fee ₹15`. It stops, he flips it back — or he sets a window in advance for a known peak and lets it expire itself. Goes to the partner, because the extra cost is theirs.

### 3.6 Boundaries, rounding, caps, and unmeasurable distance

**Quantise, then price.** Both runtimes round the raw haversine to **2 dp (10 m)** *before* it enters the fee function. Float divergence between JS `Math` trig and Postgres `float8` trig at these magnitudes is ~1e-10 km, which can only flip a 2-dp rounding when the raw value lands within 1e-10 of a `.005` boundary. Combined with the ₹1 band below, client/server agreement is structural rather than probabilistic.

**Rounding.** The delivery fee is rounded to whole rupees once, at the end. Platform and surge fees are configured as whole rupees. COD means no coins below ₹1.

**Fee tolerance.** `place_order` accepts a client delivery-fee claim within **±₹1.00**. After quantisation the only residual disagreement source is a `.5` rounding straddle, worth exactly ₹1. A stale-config claim differs by far more and still hard-fails to `PRICING_MISMATCH:`. Accepted leak: ≤ ₹1/order, only when a retune moves a fee by exactly ₹1. Subtotal and discount keep their ±₹0.01 checks.

**Cap vs. radius — the ops rule.** If any restaurant's `delivery_radius_km` is raised past ~11 km, `max_delivery_fee` starts binding below fully-loaded cost. This *cannot* be a CHECK (it spans two tables), so it is a **monitoring lint** (§9c) plus a line in the onboarding checklist.

**Unmeasurable distance is designed out, not priced around.** The pin is mandatory, so the only remaining gap is a restaurant with no coordinates — which is already broken (it cannot appear in discovery, which filters by radius). Make it unrepresentable:

```sql
ALTER TABLE public.restaurants
  ADD CONSTRAINT active_restaurants_need_coords
    CHECK (NOT is_active OR (lat IS NOT NULL AND lng IS NOT NULL));
```

Pre-flight with `SELECT id, name FROM restaurants WHERE is_active AND (lat IS NULL OR lng IS NULL);` before running the migration.

Defensive residue only: if `distance_km` is somehow NULL, both runtimes charge **base only** and the order still places — never block a customer over our own data gap. This closes what earlier drafts of this plan treated as a first-class fallback with an accompanying "skip the pin to dodge the fee" gaming vector; there is now no supported path to an unmeasured order.

### 3.7 The Cost-Floor Invariant

`delivery_config` stores the cost assumption itself, and three CHECKs bind the price knobs to it:

```sql
-- Marginal fee per km ≥ marginal cost per km of the ROUND trip
CONSTRAINT delivery_config_per_km_covers_cost
  CHECK (per_km_fee >= 2 * assumed_cost_per_km),                     -- 10 ≥ 7.00  ✓

-- The base fee must cover the round trip it includes
CONSTRAINT delivery_config_base_covers_cost
  CHECK (base_fee >= 2 * assumed_cost_per_km * base_distance_km),    -- 20 ≥ 10.50 ✓

-- Farther is never cheaper per km
CONSTRAINT delivery_config_long_rate_not_cheaper
  CHECK (long_distance_per_km_fee >= per_km_fee),                    -- 14 ≥ 10    ✓
```

**These have no escape clauses.** Earlier drafts carried `per_km_fee = 0 OR …` and a `free_delivery_max_km >= 99` sentinel so a launch could ship inert while preserving the flat ₹25. With that legacy deleted there is nothing to ship inert for, and the guardrails are absolute from the first row.

The practical effect: a Dashboard edit pricing a kilometre below what a kilometre costs simply will not save. And because the cost figure is itself a column, revising the fuel assumption **raises the price floor automatically** — set `assumed_cost_per_km = 4.5` and the row rejects any `per_km_fee` under ₹9 until it is raised too.

That is the configuration half. §9 is the runtime half — a margin view that flags any order that still came in under cost.

---

## 4. Worked Examples

Seed config throughout; discount config at its own defaults (11%, ₹200 floor, ₹50 cap, active).

| # | Cart | Distance | Discount | Base | Distance fee | Delivery | Platform | **Total** | Note |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ₹120 | 1.2 km | ₹0 | ₹20 | ₹0 | ₹20 | ₹5 | **₹145** | Small basket, near. |
| 2 | ₹220 | 1.2 km | ₹24 | ₹0 | ₹0 | ₹0 | ₹5 | **₹201** | Waiver applies — both conditions met. |
| 3 | ₹250 | 1.5 km | ₹28 | ₹0 | ₹0 | ₹0 | ₹5 | **₹227** | Boundary is **inclusive** — 1.50 km still qualifies. |
| 4 | ₹250 | 1.6 km | ₹28 | ₹20 | ₹1 | ₹21 | ₹5 | **₹248** | The waiver cliff — see below. |
| 5 | ₹220 | 3.0 km | ₹24 | ₹20 | ₹15 | ₹35 | ₹5 | **₹236** | Partner nets +₹14 on a ₹21 ride. |
| 6 | ₹120 | 5.2 km | ₹0 | ₹20 | ₹38 | ₹58 | ₹5 | **₹183** | 3.5 km × ₹10 + 0.2 km × ₹14 = ₹37.80 → ₹38. |
| 7 | ₹700 | 5.9 km | ₹50 | ₹20 | ₹48 | ₹68 | ₹5 | **₹723** | Discount cap and distance compose independently. |
| 8 | ₹300 | 8.5 km | ₹33 | ₹20 | ₹70 | ₹90 | ₹5 | **₹362** | Raw ₹104 → capped at `max_delivery_fee`. |
| 9 | ₹220 | 3.0 km | ₹24 | ₹20 | ₹15 | ₹35 | ₹5 | **₹251** | + ₹15 `Rain fee` while surge is live. |
| 10 | any | > radius | — | — | — | — | — | **refused** | `DELIVERY_TOO_FAR:` — the restaurant's own `delivery_radius_km` (§5.5). |

**Row 3 → row 4 is the sharp edge:** ₹227 → ₹248 across 100 m of address. That ₹21 step is the *waiver* cliff, inherent to any threshold (the ₹200 discount floor has the same shape); the distance component itself is only ₹1 there. Mitigations: inclusive boundaries, nudge copy that states the rule (§5.6), and widening `free_delivery_max_km`/`base_distance_km` together if it generates complaints.

**Checkout rendering** for row 5 with surge live:

```
Item total                       ₹220.00
Discount (11%)                  −₹24.00
Delivery fee (3.0 km)            ₹35.00
Rain fee                         ₹15.00
Platform fee                      ₹5.00
────────────────────────────────────────
To pay (Cash)                   ₹251.00
     ├─ Partner keeps            ₹50.00   (delivery + surge)
     └─ RedLotus claims           ₹5.00   (platform fee)
```

And row 2, the common near/large-basket case:

```
Item total                       ₹220.00
Discount (11%)                  −₹24.00
Delivery fee (1.2 km)      FREE   ₹0.00
Platform fee                      ₹5.00
────────────────────────────────────────
To pay (Cash)                   ₹201.00
```

---

## 5. Architecture

### 5.1 `src/lib/pricing.ts` — no delivery constants at all

**Deleted outright:**

```ts
export const DELIVERY_FEE_RUPEES = 25;      // ← gone
export const FREE_DELIVERY_THRESHOLD = 150; // ← gone
```

**No `DEFAULT_DELIVERY_CONFIG` replaces them.** A hardcoded default is a second source of truth that silently drifts from the row — and a drifted delivery default is worse than no default, because it produces a *claim* the server rejects, or (if it under-claims inside the ±₹1 band) money the partner never sees. Principle 1 means the client either knows the real config or knows nothing:

```ts
export type DeliveryConfig = {
  baseFee: number;
  baseDistanceKm: number;
  perKmFee: number;
  longDistanceKm: number;
  longDistancePerKmFee: number;
  maxDeliveryFee: number;
  freeDeliveryMinSubtotal: number;
  freeDeliveryMaxKm: number;
  platformFee: number;
  surgeFee: number;
  surgeActive: boolean;
  surgeStartsAt: Date | null;
  surgeEndsAt: Date | null;
  surgeLabel: string;
};
// assumed_cost_per_km is deliberately absent — not granted to the client (§5.4a).

/** Round to 2 dp (10 m) BEFORE pricing — §3.6. */
export function quantiseDistanceKm(km: number): number;

export function isSurgeLive(cfg: DeliveryConfig, now?: Date): boolean;

/** null distance → base only (§3.6 defensive residue). */
export function computeDeliveryFee(
  distanceKm: number | null, subtotal: number, cfg: DeliveryConfig,
): { baseFee: number; distanceFee: number; totalFee: number };

export function computeCartPricing(
  subtotal: number,
  config: DiscountConfig,
  now?: Date,
  distanceKm?: number | null,
  delivery?: DeliveryConfig | null,   // null = not loaded → fee fields are null
): CartPricing;
```

`CartPricing` splits cleanly along "does this depend on delivery config?":

```ts
// Always known — subtotal and discount need no delivery config.
subtotal: number;
discount: number;
discountCapped: boolean;
discountActive: boolean;

// Null until delivery_config loads. NEVER defaulted to 0 — a fabricated zero
// renders as "Free" and would be claimed as ₹0 (Principle 1).
deliveryKnown: boolean;
deliveryFee: number | null;
deliveryBaseFee: number | null;
deliveryDistanceFee: number | null;
deliveryDistanceKm: number | null;
platformFee: number | null;
surgeFee: number | null;
surgeLabel: string | null;
total: number | null;              // subtotal − discount + delivery + platform + surge
```

`hints.rupeesToFreeDelivery` is `number | null` on the same rule, and returns **0 when the distance already disqualifies the waiver** — promising "add ₹30 for free delivery" to a customer 3 km away would be a lie.

> **Asymmetry with the discount, noted deliberately.** `DEFAULT_DISCOUNT_CONFIG` stays, because a stale discount default fails safe in a way a delivery default does not: it shows *no* discount, and the server's mismatch check catches the claim. Unifying the two on the null model is a v2 cleanup (§10), out of scope here.

### 5.2 `DeliveryConfigContext`

A deliberate mirror of `DiscountConfigContext`, not a merge into it (that context works, has consumers and tests; consolidation is v2):

- Mounted in `main.tsx` between `DiscountConfigContextProvider` and `CartContextProvider`.
- On mount: `supabase.from('delivery_config').select(<explicit column list>).single()`. **Explicit list, not `*`** — `assumed_cost_per_km` is not granted and `select('*')` would error.
- **Initial state is `config: null`**, not a seeded object. Consumers branch on it.
- **Realtime subscription on `delivery_config` UPDATE.** Not optional polish: when Ankit retunes, every open tab must converge within seconds or in-flight carts submit stale claims and hit `PRICING_MISMATCH`. Same two-mechanism coverage as the discount — Realtime for pre-checkout, the server mismatch check for the submit race.
- **A 60 s tick is required** so `surge_starts_at`/`surge_ends_at` boundaries are crossed without a refresh — the same reason `DiscountConfigContext` has one.
- Exposes `{ config: DeliveryConfig | null, isSurgeLive: boolean, loading: boolean, error: boolean, reload: () => void }`.

### 5.3 `Checkout` plumbing

**The distance is already computed.** `Checkout.tsx` fetches the restaurant's coordinates on mount for the 021 geofence and derives the distance from the pin:

```tsx
// Existing, unchanged — Checkout.tsx:151-190
const [restaurantGeo, setRestaurantGeo] = useState<{lat, lng, radiusKm} | null>(null);
// ... .select("lat, lng, delivery_radius_km") ...
const deliveryDistanceKm =
  coords != null && restaurantCoords != null ? haversineKm(coords, restaurantCoords) : null;
const deliveryOutOfArea = deliveryDistanceKm != null && deliveryDistanceKm > deliveryRadiusKm;
```

No `CartContext` changes are needed — no restaurant coordinates threaded through `ADD_ITEM`, no widened `localStorage` schema. The whole change is to quantise and price:

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

`effectivePricing` (not the context `pricing`) feeds the breakdown, the submit-button total, `ConfirmOrderModal`, and the RPC claims. It recomputes on every address interaction (`coords` already changes on saved-address select, GPS-modal confirm, and "Add a new address") and on every retune (Realtime → `deliveryConfig`).

**Two guards, both enforcing Principle 1 — never submit a price we could not compute:**

```tsx
const canPlace =
  cart.items.length > 0 &&
  address.trim().length > 10 &&
  !needsDeliveryPin &&
  !deliveryOutOfArea &&
  effectivePricing.deliveryKnown &&   // ← delivery_config loaded
  !geoLoadFailed &&                   // ← restaurant coords loaded
  !placing;
```

- **`deliveryKnown`** — config missing or failed. Breakdown renders a skeleton row; the button reads `Loading pricing…`; on `error`, an inline retry calls `reload()`.
- **`geoLoadFailed`** — `restaurantGeo` currently fails open (a failed fetch leaves it `null`, geofence skipped). Harmless when distance only gated the geofence; **not harmless once distance sets a price**, because the client would claim base-only while the server measures the real distance, producing a `PRICING_MISMATCH` that retry cannot clear (the client recomputes the identical claim). Track the outcome and require it, with copy: *"Couldn't load delivery details — tap to retry."*

**Pre-checkout surfaces (cart bars on menu and discovery).** No address exists, so no fee is knowable. **Show the item total only** — which is what Zomato's cart bar does — with delivery finalised at checkout. `CartContext.pricing` is now used only for item-total and discount display, and never renders a delivery figure.

### 5.4 Migration `022_distance_based_delivery.sql`

**(a) `delivery_config`.** Follows the `discount_config` pattern (single-row PK trick, `set_updated_at` reuse, no write policy, defensive Realtime add), plus the §3.7 cost CHECKs:

```sql
CREATE TABLE public.delivery_config (
  id                          boolean       PRIMARY KEY DEFAULT true CHECK (id = true),

  -- Delivery fee → partner
  base_fee                    numeric(10,2) NOT NULL DEFAULT 20   CHECK (base_fee >= 0),
  base_distance_km            numeric(4,1)  NOT NULL DEFAULT 1.5  CHECK (base_distance_km > 0),
  per_km_fee                  numeric(10,2) NOT NULL DEFAULT 10   CHECK (per_km_fee >= 0),
  long_distance_km            numeric(4,1)  NOT NULL DEFAULT 5.0,
  long_distance_per_km_fee    numeric(10,2) NOT NULL DEFAULT 14   CHECK (long_distance_per_km_fee >= 0),
  max_delivery_fee            numeric(10,2) NOT NULL DEFAULT 90   CHECK (max_delivery_fee > 0),

  -- Free-delivery waiver (cart value AND distance)
  free_delivery_min_subtotal  numeric(10,2) NOT NULL DEFAULT 199  CHECK (free_delivery_min_subtotal >= 0),
  free_delivery_max_km        numeric(4,1)  NOT NULL DEFAULT 1.5  CHECK (free_delivery_max_km >= 0),

  -- Platform fee → RedLotus
  platform_fee                numeric(10,2) NOT NULL DEFAULT 5    CHECK (platform_fee >= 0),

  -- Surge → partner
  surge_fee                   numeric(10,2) NOT NULL DEFAULT 15   CHECK (surge_fee >= 0),
  surge_active                boolean       NOT NULL DEFAULT false,
  surge_starts_at             timestamptz,
  surge_ends_at               timestamptz,
  surge_label                 text          NOT NULL DEFAULT 'Rain fee'
                                            CHECK (length(surge_label) BETWEEN 1 AND 40),

  -- Internal cost model — drives the guardrails, never sent to the client
  assumed_cost_per_km         numeric(10,2) NOT NULL DEFAULT 3.5  CHECK (assumed_cost_per_km >= 0),

  updated_at                  timestamptz   NOT NULL DEFAULT now(),

  -- Structural invariants
  CHECK (long_distance_km > base_distance_km),
  CHECK (max_delivery_fee >= base_fee),              -- the cap can never clip the base
  CHECK (free_delivery_max_km <= base_distance_km),  -- waiver cannot reach distance-priced km
  CHECK (surge_starts_at IS NULL OR surge_ends_at IS NULL OR surge_starts_at < surge_ends_at),

  -- Cost-floor invariants (§3.7) — a loss-making tune cannot be saved. No escape clauses.
  CONSTRAINT delivery_config_per_km_covers_cost
    CHECK (per_km_fee >= 2 * assumed_cost_per_km),
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

RLS + grants, following the 016/019 column-grant doctrine — **revoke the broad grant first**, since Supabase default privileges auto-grant new public tables and a table grant out-ranks a column grant:

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

**(b) `delivery_config_history` — the audit trail.** In scope, not deferred: "why did this order cost that?" is unanswerable six months later without it, and a revenue swing must be correlatable with the retune that caused it.

```sql
CREATE TABLE public.delivery_config_history (
  version    bigserial   PRIMARY KEY,
  snapshot   jsonb       NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.delivery_config_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_config_history FROM anon, authenticated;
-- admin/service_role only; Dashboard access needs no policy.

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

`orders.delivery_config_version` records which snapshot priced each order (§c), making every historical fee reconstructible.

**(c) `orders` snapshot columns + CHECK removal.** The config can change at any time, so **the decomposition must be stored, not derived**:

```sql
-- The enumerated CHECK is incompatible with a config-driven fee: the legal
-- value set changes on every retune, and a lagging CHECK would fail every
-- placement the moment a knob moves. Non-negativity is the right shape, the
-- same one discount_amount has always had; the RPC recompute is the real guard.
-- Verify the auto-generated name first:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.orders'::regclass
--     AND pg_get_constraintdef(oid) LIKE '%delivery_fee%';
ALTER TABLE public.orders
  DROP CONSTRAINT orders_delivery_fee_check,
  ADD  CONSTRAINT orders_delivery_fee_check CHECK (delivery_fee >= 0);

ALTER TABLE public.orders
  ADD COLUMN delivery_base_fee       numeric(10,2) NOT NULL DEFAULT 0 CHECK (delivery_base_fee >= 0),
  ADD COLUMN delivery_distance_fee   numeric(10,2) NOT NULL DEFAULT 0 CHECK (delivery_distance_fee >= 0),
  ADD COLUMN delivery_distance_km    numeric(5,2)  CHECK (delivery_distance_km IS NULL OR delivery_distance_km >= 0),
  ADD COLUMN platform_fee            numeric(10,2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  ADD COLUMN surge_fee               numeric(10,2) NOT NULL DEFAULT 0 CHECK (surge_fee >= 0),
  ADD COLUMN surge_label             text,
  ADD COLUMN delivery_config_version bigint REFERENCES public.delivery_config_history(version);

-- Historical exactness: every pre-022 order's fee was entirely base.
UPDATE public.orders SET delivery_base_fee = delivery_fee WHERE delivery_fee > 0;
```

**(d) `total_amount` trigger** — absorb the two new additive components:

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

**(e) `haversine_km()`** — server mirror of `src/lib/geo.ts`. Same formula, same 6371 km radius, `float8` both sides. No PostGIS, no earthdistance:

```sql
CREATE OR REPLACE FUNCTION public.haversine_km(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
RETURNS float8 LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371 * asin(sqrt(
    pow(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * pow(sin(radians(lng2 - lng1) / 2), 2)));
$$;
```

**(f) `delivery_fee_for()`** — server mirror of §3.2. Returns the **decomposition**, and takes the config **row as an argument** so `place_order` reads `delivery_config` once into a `%ROWTYPE` and prices against one transaction-consistent snapshot (the same doctrine as its `discount_config` read). Config-as-argument keeps it `IMMUTABLE` and is the seam a future per-restaurant override would use — the caller would build the row, the function would not change:

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

The cap applies to the total with the reduction attributed to the distance component; `CHECK (max_delivery_fee >= base_fee)` guarantees `total − base` never goes negative.

**(g) `is_surge_active()`** — mirrors `is_discount_active()`, `STABLE` because it reads `now()`.

**(h) `place_order` v4** — body swap, same 9-arg signature (§5.5).

**(i) `active_restaurants_need_coords` CHECK** (§3.6) and the **`order_settlement` view** (§7).

### 5.5 `place_order` v4 internals

Same 9-arg signature — the pin (015) and the fee claim (006) are already in it, so this is a plain `CREATE OR REPLACE` with no `DROP FUNCTION` dance. Changes relative to the 015 body, in execution order:

1. **Read the delivery config once**, beside the existing discount read:
   ```sql
   SELECT * INTO v_dcfg FROM public.delivery_config WHERE id = true;
   SELECT MAX(version) INTO v_cfg_version FROM public.delivery_config_history;
   ```
2. **Fetch restaurant geo** beside the existing reads, and fail loudly rather than defaulting — Principle 1 applies to the server too:
   ```sql
   SELECT lat, lng, delivery_radius_km INTO v_rlat, v_rlng, v_radius
   FROM public.restaurants WHERE id = p_restaurant_id;

   IF v_radius IS NULL THEN
     RAISE EXCEPTION 'Restaurant not found';   -- no magic fallback radius
   END IF;
   ```
3. **Compute + quantise distance** (NULL-safe):
   ```sql
   v_distance_km := CASE
     WHEN p_delivery_lat IS NOT NULL AND v_rlat IS NOT NULL
     THEN ROUND(public.haversine_km(v_rlat, v_rlng, p_delivery_lat, p_delivery_lng)::numeric, 2)
   END;
   ```
4. **Server-side radius enforcement** — new, and a deliberate upgrade from 021's client-only doctrine. 021 left the geofence client-side because the pin was *unvalidated metadata*; **this feature makes the pin a pricing input**, so the ceiling needs a server home, and `DELIVERY_TOO_FAR:` needs somewhere to be raised:
   ```sql
   IF v_distance_km IS NOT NULL AND v_distance_km > v_radius THEN
     RAISE EXCEPTION 'DELIVERY_TOO_FAR: %.2f km exceeds the % km delivery area',
       v_distance_km, v_radius;
   END IF;
   ```
   Raised **before** any pricing work, so a far customer gets the specific error rather than a confusing mismatch. The checkout pre-check (live since 021) should make this unreachable; it backstops a saved address edited in another tab, a stale bundle, or a radius cut mid-session.
5. **Fee recompute with a ±₹1 tolerance** (§3.6):
   ```sql
   v_fees  := public.delivery_fee_for(v_distance_km, v_server_subtotal, v_dcfg);
   v_surge := CASE WHEN public.is_surge_active() THEN v_dcfg.surge_fee ELSE 0 END;

   IF ABS(p_delivery_fee - v_fees.total_fee) > 1.00 THEN
     RAISE EXCEPTION 'PRICING_MISMATCH: delivery_fee client=% server=%',
       p_delivery_fee, v_fees.total_fee;
   END IF;
   ```
   Inside the band the **client's** number is written, honouring "never charge a different amount than what was on screen". Subtotal and discount keep `> 0.01`.

   > **Platform and surge fees are NOT claimed by the client.** Neither is distance- or basket-derived, so there is nothing for the client to get wrong and no reason to widen the signature. The server sets them from config; the client displays what config says.
6. **Decompose and insert.** Base is distance-independent, so the split stays exact even for a band-accepted claim:
   ```sql
   v_base     := v_fees.base_fee;
   v_dist_fee := GREATEST(v_server_delivery_fee - v_base, 0);
   ```
   Insert `delivery_fee`, `delivery_base_fee`, `delivery_distance_fee`, `delivery_distance_km` (NULL passes through), `platform_fee = v_dcfg.platform_fee`, `surge_fee = v_surge`, `surge_label` (only when surge > 0), `delivery_config_version = v_cfg_version`.

**`Checkout.tsx` error mapping** gains one branch above `PRICING_MISMATCH:`:

- `DELIVERY_TOO_FAR:` → *"This address is outside {restaurant}'s delivery area. Try a closer restaurant, or contact us on WhatsApp."*
- `PRICING_MISMATCH:` copy gains a **refresh affordance** — *"Pricing has been updated. Refresh to see the current total."* with a reload button. The existing copy assumes a retry clears it; during the cutover window (§8) a stale bundle needs the reload, and this is the cheapest way to say so.

### 5.6 UI changes

| Surface | Change |
|---|---|
| `Checkout` breakdown | `Delivery fee (3.0 km)` — amount, or `FREE` when base and distance are both 0. Conditional `{surgeLabel} ₹X` and `Platform fee ₹X` lines when > 0. Skeleton rows while `!deliveryKnown`. All from `effectivePricing`. |
| `Checkout` submit button | `Place Order · ₹{total}` — must match what the RPC will accept. `Loading pricing…` and disabled while `!deliveryKnown`. |
| `Checkout` address section | Geofence notice (already live). New: retry affordances for `geoLoadFailed` and delivery-config failure (§5.3). |
| `Checkout` nudge | Waiver-aware. Within the distance cap: *"Add ₹X more for free delivery."* Beyond it: *"Free delivery applies within {freeDeliveryMaxKm} km of the restaurant."* — never promise a waiver the distance has already disqualified. Hidden entirely while `!deliveryKnown`. |
| `ConfirmOrderModal` | New props `deliveryDistanceKm` / `platformFee` / `surgeFee` / `surgeLabel`; mirrors the same conditional lines. The `freeDeliveryThreshold` prop now comes from `deliveryConfig`, not the deleted constant. |
| Menu / discovery cart bars | **Item total only** (§5.3) — no pre-address delivery figure. |
| `DiscoveryPage` strip, `RestaurantMenu` pill | **Delete the `FREE_DELIVERY_THRESHOLD` import** (these two plus `Checkout` are its only importers; `DELIVERY_FEE_RUPEES` has none outside `pricing.ts`). Read `useDeliveryConfig()` and add the distance qualifier: *"Free delivery on ₹199+ within 1.5 km"*. **Render nothing while config is null** — no fee claim without the row behind it. |
| `Hero.tsx` | Same treatment if its copy names a delivery figure. |
| `FAQ.tsx` | Interpolate from config: *"Delivery is free on orders ₹{threshold}+ within {freeMaxKm} km of the restaurant. Otherwise there's a ₹{base} delivery fee covering the first {baseKm} km, plus ₹{perKm}/km beyond that — always shown in your cart before you confirm. A ₹{platformFee} platform fee applies to every order."* Hide the answer while config is null. |
| `PartnerProgram.tsx` | **Requires the D1 disclosure rewrite.** Number-free prose: *"The delivery fee your customer pays is yours to keep — it's calculated from the distance to their door. RedLotus charges a small platform fee per order, settled with your monthly invoice."* Figure-free so a retune cannot strand stale rupees on a commitment page; the FAQ carries live numbers. |
| `OrderStatus` / `OrderHistory` | Render from the **stored snapshots, never live config** — historical orders must show what was charged then. Add the new columns to their selects. Pre-022 rows have distance/platform/surge = 0 → no extra lines, correct by construction. |

### 5.7 Owner dashboard

- `PENDING_ORDER_SELECT` / `ACTIVE_ORDER_SELECT` add `delivery_distance_km, delivery_base_fee, delivery_distance_fee, platform_fee, surge_fee`. Cards render **"≈ 3.0 km"** beside the existing `Navigate ▸` link — they already carry the pin; this saves the owner opening Maps to judge the run.
- `pcard__settle` / `acard__settle` needs no structural change (it prints generically and suppresses at 0), but the caption gains the split from stored columns:
  *"Collect ₹251 in cash. ₹50 delivery is yours; ₹5 platform fee settles with RedLotus."*
- `HistorySection` and the Realtime handlers are untouched (payload-driven, column-agnostic).

---

## 6. Trust Model — the pin is now a pricing input

Migration 015 classified `delivery_lat/lng` as *"unvalidated client metadata: they only ever feed the owner's Maps link, and a customer can only misplace their own delivery."* **This feature breaks that classification**, so the threat is re-argued rather than inherited:

| Vector | Analysis | Verdict |
|---|---|---|
| **Spoof-near** (fake the pin close to dodge the distance fee) | The attacker corrupts their own Maps link and still hands the owner a typed address showing the true location. The owner sees "≈ 0.4 km" beside an address they know is in the far colony — a visible contradiction, with the decline path right there. Ceiling: one order's distance fee. | **Accepted.** Human gate + bounded loss. |
| **Skip-the-pin** | **Closed structurally.** `canPlace` requires a pin, and `active_restaurants_need_coords` (§3.6) removes the other unmeasurable branch. No supported path to an unmeasured order. | **Eliminated.** |
| **Spoof-far / griefing** | Pinning far *raises* one's own fee or blocks one's own order. Self-harming. | No defence needed. |
| **Client fee tampering** (direct RPC call with a low `p_delivery_fee`) | The server recomputes from live config and its own haversine; the ±₹1 band is the only slack. | **Closed.** |
| **Radius bypass** | Now enforced server-side (§5.5 step 4), upgraded from 021's client-only gate. | **Closed.** |
| **Client fabricating a fee when config is unreadable** | Impossible by construction — there is no client-side default to fall back to, and `canPlace` requires `deliveryKnown` (§5.1, §5.3). | **Closed by Principle 1.** |

What the server guarantees: fee recomputed from live config in-transaction, consistent with the claimed pin, pin bounded to the globe, radius enforced, decomposition and config version snapshotted. What it cannot guarantee — that the pin is where the customer physically *is* — is the residual v1 accepts everywhere else (same class as the discovery override seeding `VILLAGE_CENTRE`).

**Re-visit triggers:** a partner reports repeated short-distance fees on runs they know were long; the §9 margin view flags a persistent below-cost cohort; expansion pushes real runs past the fee cap. Escalation for v2: pin-accuracy gating (`getCurrentPositionOnce` already surfaces accuracy), then address autocomplete — which also closes `v2_deferred_issues.md` §3's desktop dead-end.

---

## 7. Settlement & Partner Economics

**The split (D1).** Under COD the mechanics cost nothing: the restaurant already collects the full `total_amount` in cash, so pass-through means **the monthly net-out claims only the platform fee**. Encoded once as a view so the rule lives in one place and stays exact across every retune:

```sql
CREATE OR REPLACE VIEW public.order_settlement AS
SELECT
  o.id, o.restaurant_id, o.created_at, o.status,
  o.total_amount,
  o.delivery_fee + o.surge_fee   AS partner_keeps,    -- kilometres are theirs
  o.platform_fee                 AS redlotus_claims,  -- the flat margin line
  o.delivery_distance_km,
  o.delivery_config_version
FROM public.orders o;
```

Monthly invoice input:

```sql
-- Stored snapshots — NEVER re-derive from live delivery_config; it may have
-- changed mid-month, and the snapshots are the truth of what each order charged.
SELECT restaurant_id,
       COUNT(*)             AS orders,
       SUM(redlotus_claims) AS platform_fees_due,
       SUM(partner_keeps)   AS partner_delivery_earnings
FROM public.order_settlement
WHERE status = 'completed' AND created_at >= :month_start AND created_at < :month_end
GROUP BY restaurant_id;
```

**What partners need told, 48h ahead:** far deliveries now pay, and the money is theirs. A rare partner-facing change that is unambiguously good news — lead with it.

**Retune operating guidance.** Effects are immediate: Realtime converges open tabs in seconds, the RPC enforces new values on the next placement. A customer mid-checkout during an edit sees at most one "Pricing updated" toast, then succeeds. Same courtesy as deploys: **avoid retuning during 12–2 PM and 7–9:30 PM**, and make each change in **one Dashboard save** (the row updates atomically; two saves = two mismatch windows). Raising `free_delivery_min_subtotal` is instantly visible on every copy surface — pair it with an announcement.

**Unchanged:** COD-only, the discount model, 15-min expiry, cancellation rules, the ETA promise, subscription pricing and cadence.

---

## 8. Rollout

There is no inert stage and no staged activation. The old flat model is placeholder data being deleted, so the new prices are live the moment this deploys. That makes the cutover a single, deliberate, communicated event.

### Pre-flight

1. **Coordinate audit** — `SELECT id, name FROM restaurants WHERE is_active AND (lat IS NULL OR lng IS NULL);` must return zero rows before the §3.6 CHECK will apply.
2. **Radius audit** — confirm each restaurant's `delivery_radius_km` is what you actually want to serve, since it is now the hard ceiling and is enforced server-side. Run the §9c cap lint.
3. **Preview branch** — run migration 022 on a Supabase preview branch and place a test order end-to-end. (Preview branches carry no secrets/pg_cron, but nothing here needs either; the Realtime publication add is in-migration so previews exercise it.)
4. **Announce to partners, 48h ahead** (§7). Prepare the customer-facing note.

### Cutover

5. **Deploy migration + frontend together, off-peak** — a weekday outside 12–2 PM and 7–9:30 PM.
6. **Regenerate `src/types/database.ts`** (`delivery_config`, `delivery_config_history`, new `orders` columns, the composite type, new function signatures, the two views) — Docker / `--linked` per the `supabase-type-gen` notes.
7. **Native:** bump `package.json` version and push the Capgo OTA bundle (`--ignore-metadata-check`, per CI). `directUpdate: true` applies it at next app foreground. No new plugin or permission is involved, so this is a valid OTA rather than a store build.

### The stale-bundle window — the one rough edge

A pre-022 bundle computes the old flat ₹25/₹0 and claims it. The server now computes a different number, so those claims fail with `PRICING_MISMATCH` — and **retry cannot clear it**, because the stale code recomputes the identical claim. Only a reload fetches the new bundle.

This is unavoidable and was the price of deleting the legacy rather than staging around it. It is bounded:

- **Web:** `skipWaiting: true` + `clientsClaim: true` mean a new build activates on the **first** reload, so the window is one page load per user.
- **Native:** Capgo `directUpdate` applies at next foreground.
- **Off-peak cutover** keeps the affected population small.
- **The `PRICING_MISMATCH` copy now says "Refresh"** and offers a reload button (§5.5), so an affected customer's next action is the one that fixes it.

### Verification, within the hour

8. Place one real order at a known distance. Confirm `delivery_base_fee + delivery_distance_fee = delivery_fee`, `delivery_distance_km` matches the map, `platform_fee = 5`, and `delivery_config_version` points at the seed history row.
9. Flip `surge_active` on and off in the Dashboard; confirm an open checkout tab updates via Realtime within seconds and the `Rain fee` line appears and disappears.
10. Confirm the owner dashboard card shows the distance and the settle caption's split.

### Monitor 7 days

Fee distribution by distance bucket; `est_margin < 0` cohort (§9b — should be exactly the free-delivery cohort inside 1.5 km and nothing else); `DELIVERY_TOO_FAR` frequency (checkout pre-checks should make RPC hits ~0 — spikes mean a stale bundle or a bug); `PRICING_MISMATCH` rate, which should fall to ~0 within a day of cutover; order volume in the 1.5–4 km band, the cohort whose price moved most; any partner distance dispute.

### Tests land with the code

Per the CLAUDE.md testing scope — high-risk pure logic:

- **`pricing.test.ts`**
  - `computeDeliveryFee` across the curve: 0, `base_distance_km` exactly (inclusive), just past it, at `long_distance_km`, past it, at and beyond `max_delivery_fee`, and `null` → base only.
  - The **waiver matrix** — all four combinations of (subtotal ≥/< threshold) × (distance ≤/> `free_delivery_max_km`), asserting the waiver applies in exactly one.
  - The same cases against a **second, differently-tuned config**, proving no seed values leaked into the logic.
  - `quantiseDistanceKm` rounding, and pricing stability under ±1e-9 km input jitter.
  - `isSurgeLive` window boundaries.
  - Every §4 row, including the decomposition fields.
  - **Null-config behaviour:** `computeCartPricing(..., null)` returns `deliveryKnown: false` with **null** fee fields and a null `total` — explicitly asserting they are not `0`, since a fabricated zero is the loss path Principle 1 exists to prevent.
  - **The Cost-Floor property test:**
    ```ts
    // Encodes §1.3 in CI: no configured distance may be priced below the
    // marginal cost of the round trip. The DB CHECK is the runtime half.
    const ASSUMED_COST_PER_KM = 3.5;
    for (let d = 0.1; d <= 15; d += 0.1) {
      const { totalFee } = computeDeliveryFee(d, 0, SEEDED_CONFIG);   // subtotal 0 ⇒ no waiver
      expect(totalFee).toBeGreaterThanOrEqual(2 * ASSUMED_COST_PER_KM * d);
    }
    ```
    This surfaces the `max_delivery_fee` break-even distance as a test failure rather than a memory — if the cap is ever raised past where it covers cost, or the radius lint is ignored, this fails first.
- **`CartContext.test.tsx`** — mock `DeliveryConfigContext` alongside the existing `DiscountConfigContext` mock, including the `config: null` case. No cart-shape change (§5.3), so the existing reducer tests stand.
- **`geo.test.ts`** — already covers `haversineKm`; no change.

---

## 9. Monitoring & Guardrails

The CHECKs make a loss-making *configuration* impossible. These catch a loss-making *outcome* — a bad pin, a binding cap, an over-wide radius.

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

**(b) Weekly: orders that came in under cost.** Should be exactly the free-delivery cohort inside `free_delivery_max_km` and nothing else.

```sql
SELECT restaurant_id, COUNT(*) AS below_cost_orders,
       ROUND(AVG(est_margin), 2) AS avg_margin,
       ROUND(MIN(est_margin), 2) AS worst
FROM public.order_delivery_margin
WHERE est_margin < 0 AND created_at >= now() - interval '7 days'
GROUP BY restaurant_id ORDER BY worst;
```

**(c) The cap/radius lint** — §3.6's cross-table rule. Run after any radius change and before onboarding a restaurant:

```sql
-- Any restaurant whose radius extends past where the fee cap covers cost.
SELECT r.id, r.name, r.delivery_radius_km, c.max_delivery_fee,
       ROUND(2 * r.delivery_radius_km * c.assumed_cost_per_km, 2) AS cost_at_edge
FROM public.restaurants r CROSS JOIN public.delivery_config c
WHERE r.is_active
  AND 2 * r.delivery_radius_km * c.assumed_cost_per_km > c.max_delivery_fee;
```

**(d) Distance distribution** — tells you where `base_distance_km` should actually sit:

```sql
SELECT width_bucket(delivery_distance_km, 0, 8, 8) AS km_bucket,
       COUNT(*), ROUND(AVG(delivery_fee), 2) AS avg_fee
FROM public.orders
WHERE created_at >= now() - interval '30 days' AND delivery_distance_km IS NOT NULL
GROUP BY 1 ORDER BY 1;
```

Revisit `base_distance_km` and `free_delivery_max_km` against (d) after the first full month — the seeds are a cost-derived starting point, and real distance data is better than an estimate.

---

## 10. Risks Register

| Risk | Severity | Mitigation |
|---|---|---|
| **Village price sensitivity.** Row 5 of §4 is ₹236 where the flat model charged ₹196. | **High** | Every number is a Dashboard field — `base_distance_km`, `free_delivery_min_subtotal` and `platform_fee` are the softening levers and take seconds to move. Monitor order volume daily for the first week; §9d says where the real distances are. |
| **The waiver cliff** (§4 rows 3→4: ₹21 across 100 m). | Medium | Inherent to any threshold. Nudge copy states the rule; widening `free_delivery_max_km` + `base_distance_km` together is the fix, and the CHECK keeps that pair honest. |
| **D1 changes a partner-facing commitment.** `PartnerProgram.tsx` currently says delivery fees are RedLotus revenue. | Medium | The change favours the partner. Rewrite in the same deploy, announce 48h ahead (§7). |
| **GST / e-commerce-operator treatment.** Delivery and platform fees attract GST; ECO registration under CGST §24(ix) can be mandatory *regardless of turnover*, and §9(5) can make an ECO liable for GST on restaurant services supplied through it. If either binds, a ₹5 platform fee nets ~₹4.24 and the margin model is overstated. | **High — unresolved** | **Not a question this plan can answer.** Take three to a CA before cutover: (i) Is RedLotus an "e-commerce operator" when it never handles payment (COD, restaurant collects)? (ii) Does §9(5) attach to restaurant services ordered through the platform? (iii) Should delivery and platform fees be quoted GST-inclusive? Record the answer here. If the timeline is tight, `platform_fee = 0` at cutover removes the exposure until the answer lands — the delivery fee passes through to the partner either way. |
| **Stale-bundle mismatch at cutover** (§8). | Medium, one-off | Off-peak deploy, one-reload recovery, refresh affordance in the error copy, `skipWaiting` on web and `directUpdate` on native. |
| **Crow-flies vs road distance.** A river, canal, or highway crossing makes 2 km fly into a 5 km ride. | Low–Medium | The slab-free curve absorbs modest divergence; `base_distance_km` widening is the blunt fix. Routing API is the escalation, triggered by real repeated partner disputes. |
| **Fee cap binds below cost past ~11 km.** | Low today | §9c lint plus an onboarding-checklist line. Real only on expansion. |
| **Rider labour is excluded from the cost model.** The figures cover the vehicle; a paid rider adds ~₹15–25 per run. | Medium | Deliberate — most Gudha Gorji partners deliver with family labour, so a wage line would over-price the common case. `assumed_cost_per_km` is the lever, and raising it auto-raises the CHECK floor (§3.7). Revisit when a partner hires. |

---

## 11. Open Questions for v2

- **Per-restaurant fee overrides.** The natural sibling of 021's per-restaurant radius: nullable `restaurants.base_fee_override` / `per_km_fee_override`, resolved `COALESCE(override, global)`. The seam exists — `delivery_fee_for` takes a config row, so the resolver would build that row per restaurant and the function would not change.
- **`PricingConfigContext` consolidation**, and with it **moving `DEFAULT_DISCOUNT_CONFIG` onto the null model** so both configs follow Principle 1 identically (§5.1's noted asymmetry).
- **Membership / free-delivery pass** — the Gold/One analogue. Needs scale and a payments rail.
- **Address autocomplete / forward geocoding** — improves pin quality and closes `v2_deferred_issues.md` §3's desktop dead-end with one integration.
- **Road distance via a routing API** — only if crow-flies produces real, repeated disputes.
- **Weather-API auto-surge** — replaces the manual toggle once volume justifies it.
- **Distance-aware ETA defaults** — the distance is already on the owner's card; defaulting `AcceptOrderModal`'s preset chip from it is a few lines whenever it is wanted.
- **Rider-labour cost line** — a second cost coefficient (₹/minute) once any partner hires, feeding the same CHECK machinery.

---

## 12. Doc Updates Required When This Ships

1. **CLAUDE.md** — **replace** the *"Delivery fee: ₹25 flat, waived at ₹150"* bullet under Product/business constraints entirely. New content: the four-component stack, fully DB-authoritative via `delivery_config` (no client-side constants — state Principle 1 explicitly), the distance-capped waiver, the cost-floor CHECKs, D1's partner pass-through, the platform fee, the snapshot columns, and the `DELIVERY_TOO_FAR:` contract. Also update:
   - the migration list (022) and the file map (`DeliveryConfigContext`),
   - the `main.tsx` provider order,
   - the `place_order` critical rule — still 9 args; the body now prices distance and **enforces the radius server-side**,
   - the **006 bullet's `delivery_fee CHECK (0, 25)`** mention — the constraint is now `>= 0`,
   - the **015 bullet's "unvalidated client metadata / no server recompute is possible"** claim — superseded per §6,
   - the **021 bullet's "enforcement stays client-side"** claim — now enforced in the RPC too,
   - the routes-table Checkout row.
2. **GEMINI.md** — mirror the same passages (CLAUDE.md Notes §: keep in sync on structural changes).
3. **`discount_and_delivery_fee_plan.md`** — mark §2.1's flat-fee model and §6's open question superseded by this doc. The discount half of that doc stands.
4. **`v2_deferred_issues.md`** — add per-restaurant fee overrides, road distance, and the GST question (until a CA answers it). There is no "typed-only orders bypass the fee" entry to add — that hole is closed by construction (§6).
5. **`play_store_launch_runbook.md`** — refresh any store listing or screenshot that names a delivery price.
6. **This doc** — flip Status to Shipped with the migration/PR reference, and record the cutover date and the CA's GST answer inline.
