# Coupons & Promo Codes — Build Plan v1

> **Status:** Draft for review. Ankit locked D1–D7 on 2026-09-27. D8–D14 are recommendations waiting for a yes/no (§0).
> **Author:** Ankit (drafted with Claude)
> **Revision:** v1 — 2026-09-27
> **Depends on:** 006 (`discount_config`, `is_discount_active()`), 017 (`promotions` banners), 020 + `send-push` (push notifications), 022 (`place_order` v4, `delivery_fee_for()`, settlement views), 023–025 (explicit grants; no client writes to `orders`), 026 (the conflict-of-interest guard this plan reuses).
> **Supersedes:** the "no promo codes" lines in `redlotusfoods_documentation.md` §6.7, `business_plan.md` §5.3.5 and `pre_production_checklist.md` ("No discount/promo UI"). Takes "promo codes" off the v2-deferred list in CLAUDE.md. `discount_config`, the automatic festival discount, stays exactly as it is.
> **Migrations:** numbers are assigned at ship time (phone-OTP login has 027/028 reserved). Phase 1 `0NN_coupons.sql` · Phase 2 `0NN_coupon_programs.sql` · Phase 3 `0NN_referrals.sql`. Each ships with `supabase/ops/0NN_verify.sql` and `0NN_rollback.sql`.

## At a glance

- Customers apply a **coupon** at checkout and the bill goes down. They can type the code, pick it from an **offers list**, or arrive with it already applied from a banner, a push notification or a share link.
- **One coupon per order**, and never together with the automatic festival discount. The customer gets whichever saves more.
- **Three discount types:** % off with a cap, flat ₹ off, and free delivery. A coupon never touches the platform fee, the surge fee, the commission or the restaurant's payout.
- **Four kinds of code:**
  - public, e.g. `DIWALI50`;
  - single-use batch, e.g. 200 codes for flyers;
  - personal, e.g. an apology or a gift for one customer;
  - referral, each customer's own code to share.
- **Time windows** on any coupon: dates, weekdays and hours of the day, all in IST.
- **Automatic codes** triggered by the customer's own history:
  - an apology when an order is declined or expires;
  - a thank-you after the first delivered order;
  - a reward on every 5th order;
  - a win-back after 30 days without an order;
  - the referral reward.
- **RedLotus pays for every coupon.** Restaurants are still paid on the full menu price, and nothing changes for owners or their dashboard.
- **The server checks every coupon.** `place_order` checks it again in the same transaction that creates the order, with the coupon's row locked. So two customers can't both take the last use, and a public code can't go over its budget.
- **A use is an order.** There's no separate table of uses to keep in sync: a coupon's uses are the orders that carry it. When an order is declined, expires or is cancelled, the use comes back automatically.
- **You manage it from the Supabase Dashboard**, the same way you manage `discount_config` today. That means rows in two tables, a few SQL helpers (generate a batch, issue a personal code) and some saved reports. There's no admin page.
- **Nothing changes until you create a coupon.** Shipping the migration changes nothing for anyone until a coupon row exists. `UPDATE coupons SET active = false` switches every coupon off at once.
- **Three phases:**
  1. The engine, plus every kind of code you create by hand.
  2. Automatic codes.
  3. Referrals and push campaigns.

---

## 0. What this plan needs from Ankit

| # | Decision | Status | Why it matters |
|---|---|---|---|
| **D1** | Who pays for a coupon | **Locked: RedLotus.** | It works like the festival discount: the restaurant is paid on the full menu price, and the coupon comes out of RedLotus's commission and fees. Settlement, the owner dashboard and the owner's notifications don't change (§5.10, §10). |
| **D2** | A coupon together with the festival discount | **Locked: one or the other.** Checkout applies whichever saves more, and the server never applies both. | Keeps the Discount-Funding Invariant (commission higher than the automatic discount, `distance_based_delivery_plan.md` §3.8) intact. A coupon on top of the 11% discount would lose money on the food on almost every order (§4). |
| **D3** | Discount types | **Locked: % off with a cap, flat ₹ off, free delivery.** Free dish / BOGO waits for v2. | Each type is one formula over numbers checkout already has (§3.3). |
| **D4** | How coupons are managed | **Locked: Supabase Dashboard, SQL helpers and saved reports.** | Matches `v2_deferred_issues.md` §2, which says no admin panel (§5.11). |
| **D5** | Unique codes | **Locked: personal, single-use batch, and referral.** | §3.2, §7. |
| **D6** | Event-based codes | **Locked: scheduled campaigns, customer milestones, and apology codes.** | §3.4, §6. |
| **D7** | How customers find codes | **Locked: typed at checkout, an offers list at checkout, "My coupons", and banners + push.** | §5.7, §5.8, §8. |
| **D8** | Build order | **Recommend three phases:** (1) the engine and codes you create by hand, (2) automatic codes, (3) referrals and push campaigns. | Phase 1 alone delivers public, event, personal and batch codes. Referral is the piece people will most try to abuse, so it should land on an engine that's already proven. |
| **D9** | A coupon used on an order that is declined, expires or is cancelled | **Recommend: the use comes back automatically**, if the coupon is still valid. | The customer got no food and paid nothing (COD), so losing the coupon too would be a second disappointment. The design gives this for free (§3.6). |
| **D10** | Who counts as a "new customer" | **Recommend:** no order that wasn't declined, expired or cancelled has ever been placed from this account **or this phone number**. | Checking the phone as well as the account stops "delete the account, sign up again, get the welcome coupon again" (§9.4). |
| **D11** | Applying coupons automatically | **Recommend: never apply a coupon the customer didn't choose.** A code that arrives through a banner, a push or a share link counts as chosen. Checkout suggests the best coupon but doesn't apply it. | If listed public coupons applied themselves, every targeted campaign would become a discount paid for on every order. |
| **D12** | A ceiling on any one coupon | **Recommend: ₹500 per order**, as a database CHECK. | This guards against typos: `5000` instead of `50` can't be saved. Raise it with a migration if a real campaign needs more. |
| **D13** | Starting values for the automatic codes and the welcome offer | **Recommend the table in §6.1.** Every value is a Dashboard row and can change at any time. | These are the only numbers this plan makes up. |
| **D14** | Terms of Service coupon clause | **Needs sign-off.** Draft in §5.9. | Customer-facing legal copy, like the `PartnerProgram.tsx` rewrite. |

---

## 1. Why this feature

### 1.1 What exists today

There is one discount, `discount_config` (006). It's a single row that gives *everyone* 11% off, capped at ₹50, on orders of ₹200 or more, and it's switched on for festivals from the Dashboard. It can't be aimed at anyone in particular:
- It can't target a new customer, a customer who has stopped ordering, one restaurant, one evening, or one unhappy customer.
- It can't be limited to 100 uses or to ₹5,000 of spend.
- Nothing records which campaign produced which order.

### 1.2 What coupons add

Targeting, in four ways:

| Axis | Examples |
|---|---|
| **Who** | everyone · first-time customers · returning customers · one named customer · whoever holds a printed flyer · a friend of an existing customer |
| **When** | Diwali week · IPL match nights · weekday afternoons, 3–6 PM · the 7 days after a declined order |
| **Where** | every restaurant · one restaurant's launch week · the three restaurants near the college |
| **How many** | once per customer · the first 300 uses · until ₹10,000 is spent · one code, one use |

Coupons also make results measurable. Every coupon order carries its code, so "what did Diwali cost, and how many new customers did it bring?" becomes one query (§5.12).

### 1.3 What stays the same

These rules come over from the pricing plans unchanged:

1. **Only the database sets prices.** The client works out the discount so it can *show* it. `place_order` works it out again and rejects a claim that doesn't match. No coupon value is hardcoded in the frontend.
2. **A dangerous setting must be impossible to save, not just discouraged.** The database refuses three kinds of coupon: one that makes the food free, a shareable one with no limit on total spend, and one that takes ₹5,000 off an order (§3.9).
3. **Every order is shown from its own snapshot.** The coupon code and its value are stored on the order, so editing or pausing a coupon never changes a past receipt.
4. **Restaurants are paid on the full menu price.** Commission is still worked out on the item total before any discount.

---

## 2. What Zomato does, and what we copy

### 2.1 How coupons work on Zomato

- An **"Apply coupon" page** at checkout: a code box, then a list of coupons for this cart. Coupons the customer can't use yet stay in the list, locked, with the reason ("Add ₹60 more to avail this offer").
- **One coupon per order.** Restaurant offers are shown separately, and applying a coupon replaces one.
- **Personal coupons**, such as first-order, win-back and apology coupons, that only appear on one account.
- **Referrals** ("Invite friends, get ₹X").
- **Payment and bank offers**, and a **wallet** (Zomato Money) for credits and refunds.

### 2.2 What we copy

The checkout page, locked coupons with a reason, one coupon per order, personal coupons, apology coupons and referrals.

### 2.3 What we don't copy, and why

| Zomato | Us | Why |
|---|---|---|
| Wallet credits / cashback | Credits arrive as **personal coupon codes** | We're COD only: there's no balance to credit and no refunds. A code does the same job without keeping a money ledger. |
| Bank / UPI offers | — | No online payment. |
| Offers the restaurant sets up and pays for | — (v2) | D1: RedLotus pays. Restaurant-funded offers need the owner's consent, owner screens and a payout change (§14). |
| Applying the best coupon automatically | Suggest it, never apply it (D11) | RedLotus pays for every coupon, so a coupon that applies itself is a discount for everyone. |
| A coupon on top of a restaurant offer | One or the other (D2) | See §4. |

---

## 3. The model

### 3.1 Three words

- A **coupon** is a set of rules: what it gives, when, to whom, at which restaurants, and how many times. "Diwali 2026" is one coupon. Coupons live in `coupons`.
- A **code** is what the customer types.
  - A public coupon has one code (`DIWALI50`).
  - A batch coupon has 200, one per flyer.
  - A personal coupon template has one code for each customer it's been issued to.

  Codes live in `coupon_codes`, and every code belongs to exactly one coupon.
- A **use** is an order. An order that used a code carries `orders.coupon_id` and `orders.coupon_code_id`. There's no separate table of uses (§3.6).

### 3.2 Four kinds of code

| Kind | Who can use a code | Uses per code | Typical codes | Created by |
|---|---|---|---|---|
| **public** | anyone who meets the rules | set by the coupon's limits | `DIWALI50`, `WELCOME50`, `IPLNIGHT` | Ankit: one row per code |
| **batch** | whoever enters it first | 1 | `7KQ9XM2P`, ×200 | `private.coupon_generate_batch()` |
| **personal** | only the customer it was issued to | 1 | `SORRY4KQ7` | Ankit (`private.coupon_issue_personal()`) or an automatic programme (§6) |
| **referral** | new customers, except the code's owner | set by the coupon's limits | `ANKIT7Q` | the customer, from the "Refer friends" card (§7) |

A coupon's `kind` decides the kind of every code under it, and a trigger on `coupon_codes` enforces that (§5.1).

To track influencers or college ambassadors separately, give each one their own public coupon and code. The reports then show each person's results (§5.12).

### 3.3 Three discount types

All amounts are whole rupees, rounded half away from zero. That's the rounding `discount_config` already uses, and SQL `ROUND` and JavaScript `Math.round` agree on positive values.

| Type | `discount_value` | `max_discount` | Takes money off | Amount |
|---|---|---|---|---|
| `percent` | 1–100 (%) | **required** | the item total | `min(round(subtotal × value / 100), max_discount)` |
| `flat` | rupees | must be empty | the item total | `value` |
| `free_delivery` | must be empty | optional cap | the delivery fee | `min(delivery_fee, max_discount ?? delivery_fee)` |

Every coupon also has a `min_subtotal`. Below it, the coupon doesn't apply, and checkout shows "Add ₹X more". It's measured on the item total before any discount, as the festival discount's ₹200 threshold and the ₹199 free-delivery waiver already are.

**The food can never become free.** Two CHECKs require:
- `max_discount < min_subtotal` for percent coupons;
- `discount_value < min_subtotal` for flat coupons.

So a flat or percent coupon always leaves some food on the bill, and `orders.total_amount > 0` (001) can never fail because of a coupon.

**Free delivery only removes the delivery fee**, both its base and distance parts. It never removes the surge fee or the platform fee. If delivery is already free on the order (the ₹199 / 1.5 km waiver in `delivery_config`), a free-delivery coupon saves ₹0. Checkout says so instead of spending the code.

### 3.4 When: event windows

Every coupon can be limited in time. Like `is_discount_active()`, all of these are checked in IST:

| Column | Meaning | Example |
|---|---|---|
| `active` | turns the coupon off | `false` stops it from the next order onwards |
| `starts_at` / `ends_at` | the campaign's dates | Diwali week: `2026-11-06 00:00+05:30` → `2026-11-13 00:00+05:30` |
| `active_days` | days of the week, 0 = Sunday … 6 = Saturday; empty = every day | IPL nights: `{0,6}` for weekend matches |
| `daily_start` / `daily_end` | hours of the day; both empty = all day | weekday snacks: `15:00` → `18:00` |
| `coupon_codes.expires_at` | one code's own expiry | an apology code, valid 7 days from when it was issued |

A daily window can run past midnight, e.g. `22:00` → `02:00`. The day-of-week check uses the calendar date at the time of the order. So a Friday-night window that runs past midnight needs both `5` and `6` in `active_days`.

A code stops working at whichever comes first: the coupon's `ends_at` or the code's own `expires_at`.

### 3.5 Who and where

- **`audience`**: `everyone`, `new_customers` (D10), or `returning_customers` (at least one delivered order).
- **`restaurant_ids`**: empty means every restaurant. Otherwise it's the list of restaurants the coupon works at.
- **Customer accounts only.** The guard from migration 026 is reused as it is. A coupon is refused when any of these is true:
  - the caller isn't a `customer`;
  - the caller owns the restaurant being ordered from;
  - the caller's phone (last 10 digits) matches the restaurant's line or its owner's phone.

  Without the guard, an owner could order from their own restaurant with a coupon RedLotus pays for, and keep the difference at settlement (§9.5). **Ankit's admin account can't use coupons either, so test with a customer account.**

### 3.6 How many, and why a use is an order

| Limit | Column | What it counts |
|---|---|---|
| Per customer | `coupons.per_customer_limit` (default 1) | this customer's live orders with this coupon, matched by account **or** phone. Applies to public, batch and referral coupons. A personal code is single-use anyway. |
| In total | `coupons.total_limit` | all live orders with this coupon |
| Budget | `coupons.budget_rupees` | `SUM(discount_amount)` over live orders with this coupon |
| Per code | `coupon_codes.max_uses` (batch and personal codes: 1) | live orders with this code |

A **live** order is any order that isn't `declined`, `expired` or `cancelled`. That has four consequences:

- A **pending** order holds its use, so two orders can't both take the last one.
- When an order is declined, expires or is cancelled, it stops counting and the use comes back (D9). There's no separate step to release the use, so there's nothing to forget and nothing that can fail: the change of status is the release.
- A **completed** order keeps its use for good.
- Pending orders count against the budget as well, so a campaign can't overspend while orders are waiting for restaurants to accept them.

Counting orders, rather than keeping a separate table of uses, means there's one answer to "was this code used?": the order. A separate table would need a trigger to release a use on every status change, and a bug in that trigger would either leave uses that were never really spent or let a code be spent twice.

### 3.7 Coupon or festival discount, not both

The festival discount and a coupon never apply to the same order (D2). Checkout works out both and uses whichever saves more:

```
autoSaving   = the festival discount on this cart (0 if it's switched off, or the cart is under ₹200)
couponSaving = the coupon's discount on the items + any delivery fee it removes
use the coupon  if  couponSaving > autoSaving
                    (a tie keeps the festival discount and doesn't spend the coupon)
```

A coupon that loses isn't spent: a personal code stays in "My coupons" for a bigger order. The customer is told why: *"Your festival discount saves ₹33, more than FREEDEL's ₹20, so we've kept it."*

The server doesn't make this choice. If `place_order` receives a code, it applies the coupon and sets the festival discount to 0 for that order. It never adds the two together.

When the festival discount is on, a coupon only costs the difference between the two. On an order that would have got ₹33 off anyway, a ₹50 coupon costs RedLotus ₹17 more, not ₹50. Each coupon order stores the festival discount it replaced (`orders.auto_discount_forgone`), so the reports show both the full cost and this extra cost (§5.12).

### 3.8 What a coupon never touches

- **The platform fee.** Migration 022 says it's never waived by anything.
- **The surge fee.**
- **Commission.** It's still `commission_percent` × the item total before any discount.
- **The restaurant's payout.** It's still the item total minus commission (D1).
- **Menu prices on the order.** `order_items.unit_price` still stores the list price.
- **The free-delivery waiver.** It's still judged on the item total before any discount, so a coupon can't push an order below ₹199 and lose it free delivery.

### 3.9 The Boundedness Invariant

The biggest money risk is a mistyped coupon, or one with no limit: a public code on WhatsApp can reach the whole town in an hour. So the database refuses to save one:

- **Every shareable coupon has a limit on total spend.** `public` and `referral` coupons must have a `total_limit` or a `budget_rupees` (CHECK). Batch and personal coupons are already limited by how many codes exist.
- **No order gets more than ₹500 off from one coupon** (D12, a CHECK on `max_discount` / `discount_value`).
- **Food is never free** (§3.3).
- **Every percentage coupon has a cap** (CHECK).

---

## 4. Worked examples

These use the seed `delivery_config`, which production ran on at the 022 cutover:
- ₹20 base covering 1.5 km, then ₹10/km up to 5 km;
- a ₹5 platform fee;
- free delivery at ₹199 or more within 1.5 km.

They also assume a 12% commission (recorded for every active partner on 2026-09-17) and the festival discount at its seed values, switched on: 11% up to ₹50 on ₹200 or more. Rider cost is the `order_delivery_margin` estimate: distance × 2 × ₹3.5.

**RedLotus keeps** = commission + delivery fee + platform fee + surge − discount − rider cost.

| # | Cart | Coupon | Festival discount | Used | Customer pays | RedLotus keeps |
|---|---|---|---|---|---|---|
| **A** | ₹300, 2.5 km | none | ₹33 | festival | 300 − 33 + 30 + 5 = **₹302** | 36 + 30 + 5 − 33 − 17.50 = **₹20.50** |
| **B** | ₹300, 2.5 km | `DIWALI50`: ₹50 off above ₹249 | ₹33 | coupon (50 > 33) | 300 − 50 + 30 + 5 = **₹285** | 36 + 30 + 5 − 50 − 17.50 = **₹3.50** |
| **C** | ₹300, 2.5 km | `FREEDEL`: free delivery above ₹149 | ₹33 | festival (30 < 33); the coupon isn't spent | **₹302** | **₹20.50** |
| **D** | ₹180, 1.2 km | `FREEDEL` | ₹0 (under ₹200) | coupon (20 > 0) | 180 − 20 + 20 + 5 = **₹185** | 21.60 + 20 + 5 − 20 − 8.40 = **₹18.20** |
| **E** | ₹200, 2 km, first order | `WELCOME50`: ₹50 off above ₹199 | ₹22 | coupon (50 > 22) | 200 − 50 + 25 + 5 = **₹180** | 24 + 25 + 5 − 50 − 14 = **−₹10** |
| **F** | ₹400, 2 km | `FEAST20`: 20% up to ₹60 above ₹299 | ₹44 | coupon (60 > 44) | 400 − 60 + 25 + 5 = **₹370** | 48 + 25 + 5 − 60 − 14 = **₹4** |

What these show:

- **Stacking would lose money on every order.** If B stacked the coupon on the festival discount, RedLotus would keep 36 + 30 + 5 − 83 − 17.50 = **−₹29.50**. That's why D2 says one or the other.
- **A ₹50 coupon costs roughly what RedLotus earns on one order.** It pays for itself when it produces an order that wouldn't have happened otherwise: a first order (E), a lapsed customer coming back, or a second order after a bad first one. That's why the automatic codes (§6) target exactly those moments, and why public codes have budgets.
- **Count only the extra cost.** In B the coupon cost ₹17 more than the festival discount would have, not ₹50.
- **Example D's stored order:** `delivery_fee` 20, `discount_amount` 20, `coupon_delivery_waiver` 20. The owner still sees "Order value ₹180" (§5.2, §5.10).

---

## 5. Architecture (Phase 1)

### 5.1 Tables

```sql
CREATE SCHEMA private;   -- not exposed through the API (§9.1)

CREATE TABLE public.coupons (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text          NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9_]{3,40}$'),  -- Ankit's own name for it: 'diwali_2026'
  kind               text          NOT NULL CHECK (kind IN ('public','batch','personal','referral')),

  -- What the customer sees
  title              text          NOT NULL CHECK (length(title) BETWEEN 3 AND 60),  -- '₹50 off this Diwali'
  description        text          CHECK (length(description) <= 160),               -- the conditions line
  show_in_offers     boolean       NOT NULL DEFAULT false,   -- listed at checkout and on /coupons (public only)

  -- What it gives (§3.3)
  discount_type      text          NOT NULL CHECK (discount_type IN ('percent','flat','free_delivery')),
  discount_value     numeric(10,2),
  max_discount       numeric(10,2),
  min_subtotal       numeric(10,2) NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),

  -- When (§3.4), checked in IST
  active             boolean       NOT NULL DEFAULT true,
  starts_at          timestamptz,
  ends_at            timestamptz,
  active_days        int[]         NOT NULL DEFAULT '{}' CHECK (active_days <@ ARRAY[0,1,2,3,4,5,6]),
  daily_start        time,
  daily_end          time,

  -- Who and where (§3.5)
  audience           text          NOT NULL DEFAULT 'everyone'
                                   CHECK (audience IN ('everyone','new_customers','returning_customers')),
  restaurant_ids     uuid[],                                   -- NULL = every restaurant

  -- How many (§3.6)
  per_customer_limit int           NOT NULL DEFAULT 1 CHECK (per_customer_limit >= 1),
  total_limit        int           CHECK (total_limit >= 1),
  budget_rupees      numeric(10,2) CHECK (budget_rupees > 0),
  valid_days         int           CHECK (valid_days BETWEEN 1 AND 365),  -- personal codes expire this many days after issue

  internal_note      text,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),

  -- The shape of each discount type (§3.3)
  CONSTRAINT coupons_percent_shape CHECK (discount_type <> 'percent' OR (
    discount_value BETWEEN 1 AND 100 AND max_discount IS NOT NULL AND max_discount < min_subtotal)),
  CONSTRAINT coupons_flat_shape CHECK (discount_type <> 'flat' OR (
    discount_value > 0 AND max_discount IS NULL AND discount_value < min_subtotal)),
  CONSTRAINT coupons_free_delivery_shape CHECK (discount_type <> 'free_delivery' OR (
    discount_value IS NULL AND (max_discount IS NULL OR max_discount > 0))),
  CONSTRAINT coupons_whole_rupees CHECK (
    (max_discount IS NULL OR max_discount = round(max_discount))
    AND (discount_type <> 'flat' OR discount_value = round(discount_value))),
  -- D12: no coupon takes more than ₹500 off one order (a guard against typos)
  CONSTRAINT coupons_ceiling CHECK (
    coalesce(max_discount, CASE WHEN discount_type = 'flat' THEN discount_value END, 0) <= 500),
  -- §3.9: every shareable coupon has a limit on total spend
  CONSTRAINT coupons_bounded CHECK (
    kind NOT IN ('public','referral') OR total_limit IS NOT NULL OR budget_rupees IS NOT NULL),
  CONSTRAINT coupons_offers_public_only CHECK (NOT show_in_offers OR kind = 'public'),
  CONSTRAINT coupons_referral_new_only  CHECK (kind <> 'referral' OR audience = 'new_customers'),
  CONSTRAINT coupons_personal_expiry    CHECK (kind <> 'personal' OR valid_days IS NOT NULL),
  CONSTRAINT coupons_window CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at),
  CONSTRAINT coupons_daily_window CHECK (
    (daily_start IS NULL AND daily_end IS NULL)
    OR (daily_start IS NOT NULL AND daily_end IS NOT NULL AND daily_start <> daily_end))
);

CREATE TABLE public.coupon_codes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id       uuid        NOT NULL REFERENCES public.coupons(id) ON DELETE RESTRICT,
  code            text        NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4,16}$'),
  assigned_to     uuid        REFERENCES public.users(id),   -- personal: the only customer who can use it
  referrer_id     uuid        REFERENCES public.users(id),   -- referral: the customer who gets the reward
  max_uses        int         CHECK (max_uses >= 1),          -- NULL = the coupon's limits decide
  expires_at      timestamptz,                                -- NULL = the coupon's ends_at decides
  issued_reason   text        NOT NULL DEFAULT 'manual' CHECK (issued_reason IN
                    ('manual','batch','apology','first_order_thanks','every_nth_order',
                     'winback','referral','referral_reward')),
  source_order_id uuid        REFERENCES public.orders(id),  -- the order that triggered an automatic code
  note            text,                                       -- why Ankit issued it by hand
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (assigned_to IS NULL OR referrer_id IS NULL)
);

CREATE INDEX idx_coupon_codes_assigned
  ON public.coupon_codes (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE UNIQUE INDEX uq_coupon_codes_referrer              -- one live referral code per customer
  ON public.coupon_codes (referrer_id) WHERE referrer_id IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX uq_coupon_codes_source                -- at most one automatic code per order per reason
  ON public.coupon_codes (source_order_id, issued_reason) WHERE source_order_id IS NOT NULL;

CREATE TABLE public.coupon_lookups (                      -- the guessing limiter + "previewed" record (§9.3)
  user_id      uuid        NOT NULL,
  code_id      uuid        REFERENCES public.coupon_codes(id),   -- NULL when nothing the caller may use was found
  found        boolean     NOT NULL,
  looked_up_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coupon_lookups ON public.coupon_lookups (user_id, looked_up_at DESC);
```

**Codes are stored in a standard form**: uppercase A–Z and 0–9 only. What the customer types is converted the same way, ignoring spaces, hyphens and case, so `diwali-50` finds `DIWALI50`. Generated codes use a 31-character alphabet, `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, which leaves out 0/O and 1/I/L so the codes are easy to read off a flyer.

**The kind rules (§3.2)** are enforced by a `BEFORE INSERT OR UPDATE` trigger on `coupon_codes`:

| Coupon kind | `assigned_to` | `referrer_id` | `max_uses` | `expires_at` |
|---|---|---|---|---|
| public | NULL | NULL | any | any |
| batch | NULL | NULL | **1** | any |
| personal | **set** | NULL | **1** | **set** |
| referral | NULL | **set** | any | any |

A `BEFORE UPDATE` trigger on `coupons` refuses a change of `kind`. Everything else on a coupon can be edited while it's live; §5.11 explains what an edit does to a customer who is in the middle of checkout.

`coupons` reuses `set_updated_at()` (003). None of these tables is added to Realtime, because every order reads the coupon row again anyway.

**Grants, for all three tables:** RLS on, **no policies**, `REVOKE ALL FROM anon, authenticated`, and an explicit `GRANT ALL TO service_role` (the 023 rule: branch databases grant nothing by default). No client can read or write them directly (§9.1).

### 5.2 The order snapshot, and why the coupon's value goes in `discount_amount`

```sql
ALTER TABLE public.orders
  ADD COLUMN coupon_id              uuid          REFERENCES public.coupons(id),
  ADD COLUMN coupon_code_id         uuid          REFERENCES public.coupon_codes(id),
  ADD COLUMN coupon_code            text,              -- the code as shown on receipts: 'DIWALI50'
  ADD COLUMN coupon_delivery_waiver numeric(10,2) NOT NULL DEFAULT 0 CHECK (coupon_delivery_waiver >= 0),
  ADD COLUMN auto_discount_forgone  numeric(10,2) NOT NULL DEFAULT 0 CHECK (auto_discount_forgone >= 0),
  ADD CONSTRAINT orders_coupon_all_or_nothing CHECK (
    (coupon_id IS NULL) = (coupon_code_id IS NULL) AND (coupon_id IS NULL) = (coupon_code IS NULL)),
  ADD CONSTRAINT orders_coupon_waiver_in_discount CHECK (
    coupon_delivery_waiver <= discount_amount AND coupon_delivery_waiver <= delivery_fee),
  ADD CONSTRAINT orders_coupon_extras_need_coupon CHECK (
    coupon_id IS NOT NULL OR (coupon_delivery_waiver = 0 AND auto_discount_forgone = 0));

CREATE INDEX idx_orders_coupon      ON public.orders (coupon_id)      WHERE coupon_id IS NOT NULL;
CREATE INDEX idx_orders_coupon_code ON public.orders (coupon_code_id) WHERE coupon_code_id IS NOT NULL;
CREATE INDEX idx_orders_customer_phone10
  ON public.orders (right(regexp_replace(customer_phone, '\D', '', 'g'), 10));
```

**The rule: the whole value of an order's coupon goes into the existing `orders.discount_amount`.** That includes both the discount on the items and any delivery fee the coupon removes. `coupon_delivery_waiver` records how much of that was delivery, for receipts and the delivery margin report. It isn't used in any formula.

Why not a separate column that the total subtracts? Because four places already work backwards from the stored money fields with exactly this formula:

```
item total = total_amount + discount_amount − delivery_fee − platform_fee − surge_fee
```

The four places are:
- `menuValue()` in `src/pages/dashboard/utils.ts`: the owner's "Order value" on every order card and in history.
- `orderValueLabel()` in `supabase/functions/send-push/index.ts`: the owner's new-order notification.
- The "Item total" row on `OrderStatus.tsx` and `OrderHistory.tsx`.
- `recalculate_order_total()` (022), which is the same formula solved for `total_amount`.

If the removed delivery fee were stored anywhere else, all four would quietly show the wrong number on free-delivery orders. In example D the owner would see "Order value ₹160" for a ₹180 order. Putting it in `discount_amount` keeps all four exact **with no code change**. It also keeps `delivery_fee` equal to the priced fee, so every fee can still be recalculated from `delivery_config_history[version]`, as 022 requires.

Because a coupon and the festival discount are never combined (§3.7), `discount_amount` on a coupon order holds only the coupon. On every other order it holds the festival discount, exactly as it does today.

The existing table-level SELECT grant on `orders` covers the new columns: customers see their own orders, owners see their restaurant's. No client can write them. After 025, clients can't INSERT into `orders` at all, and owners can only UPDATE `status`, `eta_minutes` and `decline_reason`. `place_order` (SECURITY DEFINER) is the only thing that writes them.

### 5.3 The eligibility check: one function, three callers

`private.coupon_check(code, caller, restaurant, now)` returns a status, along with the coupon and code rows. `preview_coupon`, `list_offers` and `place_order` all call it, so they can't disagree. The checks run in this order and stop at the first failure:

| # | Status | When |
|---|---|---|
| 1 | `not_found` | there's no such code, or the code has been revoked |
| 2 | `not_eligible` | the caller isn't a `customer`, owns the restaurant, or shares a phone with the restaurant or its owner (026) |
| 3 | `not_yours` | it's a personal code issued to someone else |
| 4 | `own_referral` | it's the caller's own referral code (matched by account or phone) |
| 5 | `unavailable` | `coupons.active = false` |
| 6 | `not_started` | it's before `starts_at` |
| 7 | `expired` | it's past `ends_at` or the code's `expires_at` |
| 8 | `wrong_time` | it's outside `active_days` or `daily_start`–`daily_end` |
| 9 | `wrong_restaurant` | the restaurant isn't in `restaurant_ids` (skipped when no restaurant is given) |
| 10 | `new_customers_only` / `returning_only` | the audience rule fails (D10) |
| 11 | `used` | the code's `max_uses`, or this customer's `per_customer_limit`, is already taken by live orders |
| 12 | `sold_out` | `total_limit` has been reached, or `budget_rupees` has been spent, by live orders |
| — | `ok` | none of the above |

Two conditions depend on the cart rather than the coupon. `place_order` checks them after this function, and the client checks them for display:
- `min_subtotal`: the item total is too low.
- `no_saving`: it's a free-delivery coupon, but delivery on this order is already free.

`place_order` also checks that this order's discount fits within what's left of the budget.

In checks 10 and 11, "this customer" means orders where `customer_id` is the caller **or** `customer_phone` (last 10 digits) matches the caller's phone. `delete-account` scrubs an order's address, pin and instructions but keeps the `customer_phone` snapshot. So a customer who deletes their account and signs up again doesn't get a fresh coupon history.

**Dependency:** if `delete-account` ever starts scrubbing `orders.customer_phone`, it must keep a hashed copy for this check (§13).

### 5.4 `place_order` v5

v5 adds two optional arguments, for 13 in total. It follows the same rule as every earlier version: DROP the 11-argument overload first, so an old bundle can't reach an old body. An old client's 11-key call still resolves to v5 through the `DEFAULT NULL`s and places a normal order.

```
p_coupon_code      text    DEFAULT NULL   -- the code as typed; NULL = no coupon
p_delivery_waiver  numeric DEFAULT NULL   -- the client's figure for the delivery fee the coupon removes (±₹1, like the fee)
```

`p_discount` keeps its meaning: the discount on the items that the client showed. That's now either the festival discount or the coupon's.

Without a coupon, v5 does exactly what v4 does, apart from writing the new columns' defaults. With one, the v4 steps change like this:

| v4 step | What v5 adds |
|---|---|
| (a) read the caller's profile | If a code was sent, read the profile row `FOR UPDATE`, along with the caller's role. This makes one customer's coupon orders run one at a time, so two "first orders" can't get through at once. |
| (d) festival discount | Unchanged. Its value is saved as `auto_discount_forgone` if a coupon wins. |
| (g) radius check | **(g2)** Find the code. The caller must have previewed it in the last 24 hours (a `coupon_lookups` row); if not, raise `COUPON_INVALID: not_found` (§9.3). Lock the coupon row `FOR UPDATE`, *then* run `coupon_check`. Running the check after taking the lock means its counts include every order committed before this one. Unless the result is `ok`, raise `COUPON_INVALID: <status>`. Check `min_subtotal`, then work out the discount on the items. The festival discount for this order becomes 0. |
| (h) subtotal and discount checks (±₹0.01) | Unchanged. `p_discount` is now compared with the coupon's discount on the items. |
| (i) delivery fee (±₹1) | **(i2)** Work out how much delivery fee the coupon removes, from the *server's* fee, and compare it with `p_delivery_waiver` (±₹1). Raise `COUPON_INVALID: no_saving` if the coupon saves nothing in total. Raise `COUPON_INVALID: sold_out` if this order would go over the remaining budget. |
| (k) insert | Write `discount_amount` = item discount + removed delivery fee, plus `coupon_id`, `coupon_code_id`, `coupon_code`, `coupon_delivery_waiver` and `auto_discount_forgone`. |
| (l) commission | Unchanged: `commission_percent` × the item total before any discount. |

**Locks are always taken in the same order**: `delivery_config` (FOR SHARE, already in v4), then the customer's `users` row, then the `coupons` row. That way two coupon orders can't deadlock. The coupon lock is held for the few milliseconds of one `place_order`, so even a Diwali rush won't queue up on it. v5 also pins `search_path = ''`, the hardening 026 added, and names every table with its schema.

**Error contract.** This is a new stable prefix, matched in the same way as `PRICING_MISMATCH:`:

```
COUPON_INVALID: <status>     status = any §5.3 status, or min_subtotal, no_saving, too_many_attempts
```

The server never quietly drops a coupon. The customer confirmed a total that included it, so if the coupon stopped working between the preview and the tap, that's an error, and the customer has to confirm the new total (§5.7).

### 5.5 What the client can call

**`preview_coupon(p_code text, p_restaurant_id uuid DEFAULT NULL) → jsonb`** — for signed-in users only. It converts the code to the standard form, runs `coupon_check`, records the lookup in `coupon_lookups`, and returns the status plus the rules the client needs to price the coupon:

```json
{
  "status": "ok",
  "code": "DIWALI50", "kind": "public",
  "title": "₹50 off this Diwali", "description": "On orders above ₹249",
  "discount_type": "flat", "discount_value": 50, "max_discount": null, "min_subtotal": 249,
  "starts_at": "…", "ends_at": "…", "active_days": [], "daily_start": null, "daily_end": null,
  "restaurant_ids": null, "restaurant_names": null,
  "reserved_by_pending_order": false
}
```

- **A miss** (`not_found` or `not_yours`) returns only the status. After 10 misses in an hour, the function answers `too_many_attempts` without looking anything up.
- **`reserved_by_pending_order`** is set when the status is `used` because a *pending* order is holding the use. Checkout can then say: "It's on your order that's waiting for the restaurant. It comes back if that order is declined or you cancel it."
- **Housekeeping:** each call also deletes the caller's lookup rows older than two days.

**`list_offers(p_restaurant_id uuid DEFAULT NULL) → jsonb`** — for everyone, signed in or not. It returns one array, with rows shaped like the preview above:

- **Public offers.** These are `show_in_offers` coupons that are active and haven't ended. Coupons that start within the next 7 days are included and shown as "Starts Fri". Each row carries the public code.
  - For a signed-in customer, offers they can never use are **left out**: statuses `not_eligible`, `new_customers_only`, `returning_only`, `used` and `sold_out`. There's no point teasing them.
  - Offers that are only locked for now stay in the list, shown as locked: `wrong_time` and `not_started`, and `wrong_restaurant` on `/coupons`.
- **The customer's own codes**, if signed in: personal codes issued to them that haven't expired, been revoked or been used. Each carries `issued_reason` and `source_order_id`, for a subtitle such as "Sorry about your declined order".
- A visitor who isn't signed in gets the public offers only.

It never returns another customer's personal code, a batch code or a referral code. The only way to reach those is to type them.

Both functions are `SECURITY DEFINER` with `SET search_path = ''`, name every table with its schema, and grant `EXECUTE` to exactly the roles listed above.

### 5.6 `src/lib/coupons.ts` and `pricing.ts`

A new pure module is the client's copy of the SQL maths. It follows the same rule as `pricing.ts` and `delivery_fee_for()`: change one and you must change the other, and the tests pin both.

```ts
export type CouponRules = {
  code: string;
  kind: "public" | "batch" | "personal" | "referral";
  title: string;
  description: string | null;
  discountType: "percent" | "flat" | "free_delivery";
  discountValue: number | null;
  maxDiscount: number | null;
  minSubtotal: number;
  startsAt: Date | null;
  endsAt: Date | null;          // whichever comes first: the coupon's ends_at or the code's expires_at
  activeDays: number[];         // IST, 0 = Sunday
  dailyStart: string | null;    // 'HH:MM' IST
  dailyEnd: string | null;
  restaurantIds: string[] | null;
};

isCouponLive(rules, now): boolean                  // mirrors private.coupon_is_live
couponAmounts(rules, subtotal, deliveryFee):       // mirrors private.coupon_amounts
  { itemDiscount: number; deliveryWaiver: number | null }   // waiver is null until the fee is known
couponLockReason(...)                              // why a chosen coupon isn't in use, or null
normaliseCode(input): string                       // mirrors the SQL version
```

- **Data layer:** RPC calls, and turning `COUPON_INVALID:` errors into copy, live in `src/lib/couponsApi.ts`, following the `reviews.ts` pattern.
- **Stored codes:** the chosen code and the pending code are kept by `src/lib/couponStorage.ts`, following the `locationCache.ts` pattern: an expiry time, a check on the stored shape, and try/catch around storage.

`computeCartPricing(subtotal, config, now, distanceKm, delivery, coupon = null)` gains the last argument, and `CartPricing` gains these fields:

| Field | Meaning |
|---|---|
| `discountSource` | `'none' \| 'auto' \| 'coupon'`: where `discount` came from |
| `discount` | the discount on the items actually applied, festival *or* coupon. It's still the figure `p_discount` sends. |
| `deliveryWaiver` | the delivery fee the coupon removes. It's `null` while delivery is unknown, and never a made-up 0 (Principle 1). |
| `autoDiscount` | what the festival discount would give on this cart, for the "we've kept your festival discount" copy |
| `couponLock` | `min_subtotal` · `wrong_time` · `no_saving` · `auto_better` · `needs_address` · `null` |
| `hints.rupeesToCoupon` | how many rupees the cart needs to reach the chosen coupon's `min_subtotal` |

The total becomes `subtotal − discount + deliveryFee − deliveryWaiver + platformFee + surgeFee`. With no coupon, every existing field is exactly what it is today, so nothing that already calls this function (the cart bar, the menu, discovery) changes.

A free-delivery coupon can't be compared with the festival discount until the delivery fee is known. Until then, `discountSource` stays on the festival discount and `couponLock` is `needs_address` ("Pin your delivery address to see what FREEDEL saves"). The order can't be placed at that point anyway, because `deliveryKnown` is false.

### 5.7 Checkout

A **coupon row** sits between the items and the bill, as on Zomato. The bill below it is example B:

```
 ┌───────────────────────────────────────────────────────────┐
 │ 🏷  Apply coupon                          2 available  ›  │   nothing chosen
 ├───────────────────────────────────────────────────────────┤
 │ 🏷  DIWALI50 applied · you save ₹50              Remove   │   coupon in use
 ├───────────────────────────────────────────────────────────┤
 │ 🏷  BIGFEAST · add ₹299 more to use it           Remove   │   chosen, but locked
 └───────────────────────────────────────────────────────────┘

 Item total                                  ₹300
 Coupon · DIWALI50                           −₹50      ← replaces "Discount (11%)"
 Delivery fee (2.5 km)                        ₹30
 Platform fee                                  ₹5
 Total                                       ₹285
```

A free-delivery coupon adds its own line under the delivery fee instead: `Free delivery · FREEDEL  −₹20`.

Tapping the row opens the **coupon sheet**. It behaves like `ConfirmOrderModal`: focus is trapped inside and restored on close, ESC and a backdrop tap close it, and the page behind doesn't scroll. With a ₹300 cart:

```
 Coupons                                                        ✕
 ┌─────────────────────────────────────────┐  ┌───────┐
 │ Enter coupon code                       │  │ Apply │
 └─────────────────────────────────────────┘  └───────┘

 YOUR COUPONS
   SORRY4KQ7   ₹40 off · orders above ₹149       you save ₹40   [Apply]
               Sorry about your declined order · expires in 5 days

 OFFERS FOR YOU
   DIWALI50    ₹50 off · orders above ₹249   BEST you save ₹50  [Apply]
   BIGFEAST    ₹100 off · orders above ₹599      🔒 Add ₹299 more
   IPLNIGHT    ₹30 off · Sat–Sun, 7–11 PM        🔒 Works from 7 PM

 AUTOMATIC
   Festival offer · 11% off up to ₹50 on ₹200+ · saves ₹33 now
   Used whenever no coupon saves more.
```

How it behaves:

- **Order of the list.** Usable coupons come first, sorted by saving, and the biggest saving overall is tagged **BEST**. Locked coupons follow, sorted by how many rupees are needed to unlock them.
- **Every apply goes through `preview_coupon`**, whether the code was typed or tapped in the list, so the status is always fresh. That also creates the lookup record `place_order` needs. Checkout previews the chosen coupon again when the confirm modal opens.
- **Applying a coupon that loses to the festival discount** doesn't spend it, and the sheet says so (`auto_better`, §3.7).
- **Nothing is applied automatically (D11)** except a *pending* code: one the customer brought with them through a banner, a push or a share link (§5.8). Checkout reads it when it loads, previews it, applies it if it's usable, and then clears it.
- **The chosen coupon survives a page refresh.** It's stored in `localStorage["redlotus_checkout_coupon"]` together with the restaurant id, and cleared when the order succeeds, when the cart is emptied and when the restaurant changes.
- **Hints.** While a coupon is in use, the festival hint ("Add ₹X to unlock 11% off") is hidden. With a free-delivery coupon, the free-delivery hint is hidden too.
- **Placing the order.** `handlePlaceOrder` still prices everything again at the moment of the tap, now including the coupon. It sends `p_coupon_code` and `p_delivery_waiver` only when `discountSource === 'coupon'`.

**When `place_order` returns an error:**

- **`COUPON_INVALID: <status>`**: remove the coupon from checkout, price everything again, and show this in the confirm modal: *"DIWALI50 just ran out, so your total is now ₹302. Tap Place Order to order without it."* The new total is on screen before the customer taps again. A personal code stays in "My coupons" unless its status was `used` or `expired`.
- **`PRICING_MISMATCH:`**: run today's handler (reload `delivery_config`, price again), **and** preview the chosen coupon again, in case Ankit edited it while the customer was at checkout.

**Copy.** The sheet, the coupon row and the modal all use the same wording. Keep it in `coupons.ts`, next to `couponLockReason`.

| Status | Copy |
|---|---|
| `not_found` | We couldn't find that code. Check the spelling and try again. |
| `not_eligible` | Coupons can't be used on restaurant or admin accounts. |
| `not_yours` | This coupon belongs to a different account. |
| `own_referral` | That's your own referral code — share it with friends instead. |
| `unavailable` | This coupon isn't available right now. |
| `not_started` | This coupon starts on {date}. |
| `expired` | This coupon expired on {date}. |
| `wrong_time` | This coupon works {days}, {hours} only. |
| `wrong_restaurant` | Not valid at {restaurant}. Works at {list}. |
| `new_customers_only` | This coupon is for your first order only. |
| `returning_only` | This coupon is for customers who have ordered before. |
| `used` | You've already used this coupon. *(If a pending order holds it:)* It's on your order that's waiting for the restaurant — it comes back if that order is declined or you cancel it. |
| `sold_out` | This coupon has been fully claimed. |
| `too_many_attempts` | Too many tries. Please wait a few minutes and try again. |
| `min_subtotal` | Add ₹{x} more to use this coupon. |
| `no_saving` | Delivery is already free on this order, so this coupon wouldn't save anything. |
| `auto_better` | Your festival discount saves ₹{a} — more than this coupon's ₹{c} — so we've kept it. |
| `needs_address` | Pin your delivery address to see what this coupon saves. |

### 5.8 "My coupons", deep links and banners

**`/coupons`** is a new route, loaded on demand and open to everyone. It has four sections:

- **Enter a code** (signed in): shows what the code gives and where it works. "Use at checkout" makes it the pending code.
- **Your coupons** (signed in): personal codes, soonest expiry first, each with the reason it was given.
- **Offers for everyone**: listed public offers, visible to signed-out visitors too, each with "Works at: …".
- **Refer friends**: arrives in Phase 3 (§7).

Customers reach it from the `AppTopBar` avatar menu, from `Profile`, from "See all" in the checkout sheet, and through the links below.

**The pending code.** Opening `/coupons?apply=CODE` does three things:
1. Stores the code in `localStorage["redlotus_pending_coupon"]`, where it lasts 7 days and its shape is checked when it's read.
2. Shows the coupon, with a "Start ordering" button.
3. Leaves it for checkout to pick up (§5.7).

The code survives the sign-in redirect the same way the cart does. The browser only ever *stores* it; `preview_coupon` validates it at checkout. So a forged link can't do anything a typed code couldn't.

That one URL serves every channel:

- **Banners:** a `promotions` row (017) with `link_url = '/coupons?apply=DIWALI50'`. `PromoCarousel` already turns internal links into `<Link>`s, so no code change is needed.
- **Push:** `data.url = '/coupons?apply=DIWALI50'`. `NativeBridge` already navigates to `data.url` when a notification is tapped.
- **Share links** (referrals, forwarded WhatsApp messages): `https://redlotusfoods.in/coupons?apply=ANKIT7Q`. Android opens it in the installed app when App Links are verified, and in the browser otherwise.

### 5.9 Receipts and legal text

- **`ConfirmOrderModal`**: the coupon line replaces the discount line (`Coupon · DIWALI50  −₹50`), or a free-delivery coupon adds `Free delivery · FREEDEL  −₹20` under the delivery fee.
- **`OrderStatus` and `OrderHistory`**: select `coupon_code` and `coupon_delivery_waiver`, and label the existing discount row from the order's snapshot:

  | Snapshot | What the receipt shows |
  |---|---|
  | `coupon_code` is NULL | `Discount  −₹33` (as today) |
  | `coupon_code` set, `coupon_delivery_waiver` = 0 | `Coupon · DIWALI50  −₹50` |
  | `coupon_delivery_waiver` = `discount_amount` | `Free delivery · FREEDEL  −₹20` |

  The "Item total" formula doesn't change (§5.2).

- **Terms of Service §10** (D14). Draft:

  > **Coupons.** We may offer coupon codes. Unless a coupon says otherwise: you can use one coupon per order; a coupon can't be combined with an automatic discount — your order gets whichever saves more; coupons have no cash value and can't be exchanged, sold or transferred; a coupon issued to your account can only be used on your account; if an order that used a coupon is declined, expires, or is cancelled while it is still waiting for the restaurant, the coupon is returned to you if it is still valid. We may change or withdraw a coupon at any time before you place an order, and may refuse coupon use we reasonably believe to be fraudulent or abusive, such as the use of multiple accounts.

- **Privacy Policy**: add that we store coupon use and referral relationships to apply offers and prevent abuse, and never share them with restaurants. The existing line "to apply promotions and compute your order total correctly" already covers most of this.

### 5.10 Nothing changes for owners

Because RedLotus pays (D1), nothing changes on the owner's side: their payout, their commission, the "Order value" they see, and every owner screen and notification stay exactly as they are. Owners never see a coupon. That's not because it's hidden from them; it's because nothing on their side reads it, and §5.2 keeps `menuValue()` exact. One new case in `utils.test.ts` pins this: on a free-delivery coupon order, `menuValue` equals the item total.

The rider's cash handling doesn't change either. They collect `total_amount`, which already includes the coupon.

### 5.11 Managing coupons from the Dashboard

Coupons are rows. The helpers live in the `private` schema, which the API can't reach (§9.1), and you run them from the SQL Editor. Save these as snippets.

**A public event coupon.** Use the Table Editor, or:

```sql
WITH c AS (
  INSERT INTO coupons (slug, kind, title, description, show_in_offers,
                       discount_type, discount_value, min_subtotal,
                       starts_at, ends_at, per_customer_limit, total_limit, budget_rupees)
  VALUES ('diwali_2026', 'public', '₹50 off this Diwali', 'On orders above ₹249', true,
          'flat', 50, 249,
          '2026-11-06 00:00+05:30', '2026-11-13 00:00+05:30', 2, 300, 10000)
  RETURNING id)
INSERT INTO coupon_codes (coupon_id, code) SELECT id, 'DIWALI50' FROM c;
```

**A batch for flyers.** Create the coupon first (kind `batch`, e.g. ₹40 off orders of ₹199 or more, ending 31 Dec), then:

```sql
SELECT * FROM private.coupon_generate_batch('flyers_college_nov', 200);
-- Returns 200 codes. Use "Download CSV" in the SQL Editor and send the file to the printer.
```

**A personal code**, for example an apology issued by hand or a gift for a regular:

```sql
SELECT private.coupon_issue_personal('goodwill_40', '9876543210', 'Late delivery on 12 Nov');
-- Returns the new code, e.g. 'H7QK2MXA'. It expires after the coupon's valid_days.
-- It refuses if the phone matches no customer, or matches more than one account;
-- in that case, pass the user id instead of the phone.
```

**Pause, resume and revoke:**

```sql
UPDATE coupons      SET active = false     WHERE slug = 'diwali_2026';   -- pause (set true to resume)
UPDATE coupon_codes SET revoked_at = now() WHERE code = 'H7QK2MXA';      -- switch off one code
UPDATE coupons      SET active = false;                                   -- switch off every coupon
```

**Never delete a coupon or code that has been used.** The foreign keys from `orders` will refuse it. Pause it instead.

**What an edit does to a customer who is mid-checkout.** Nothing is cached on the server, so the next `place_order` sees the new rules:
- **An edit that changes the price** (the value or the cap): the client's figure no longer matches, so `place_order` returns `PRICING_MISMATCH`. Checkout previews the coupon again and shows the new total.
- **An edit that makes the coupon unusable** (paused, ended, or the budget cut below what's been spent): `place_order` returns `COUPON_INVALID`, and checkout removes the coupon.

In both cases the customer is never charged a total they didn't see.

### 5.12 Reports

These are views in `private`, so no API role can reach them:

- **`private.coupon_performance`**: one row per coupon, with:
  - kind, whether it's active, and its time window;
  - uses, split into **completed**, **in progress** (live but not completed) and **released** (declined, expired or cancelled);
  - unique customers, and **new customers won** (customers whose first delivered order used this coupon);
  - money **given** (`SUM(discount_amount)` on completed orders) and **reserved** (on orders in progress);
  - budget left;
  - the **extra cost** over the festival discount (`SUM(discount_amount − auto_discount_forgone)`);
  - average order value, and when it was last used.
- **`private.coupon_uses`**: every coupon order, with when it was placed, the customer's name, the restaurant, the status, the code, the discount and the total.
- **`private.coupon_daily_spend`**: for each IST day, how much went on the festival discount and how much on coupons.

The settlement views change as described in §10.

---

## 6. Automatic codes (Phase 2)

### 6.1 `coupon_programs`

There's one row per programme, tuned from the Dashboard (the `discount_config` pattern):

```sql
CREATE TABLE public.coupon_programs (
  program           text    PRIMARY KEY CHECK (program IN
                      ('apology','first_order_thanks','every_nth_order','winback','referral')),
  active            boolean NOT NULL DEFAULT false,
  coupon_id         uuid    REFERENCES public.coupons(id),  -- the kind='personal' coupon whose rules each issued code carries
  referee_coupon_id uuid    REFERENCES public.coupons(id),  -- referral only: the kind='referral' coupon that friends use (§7)
  nth               int     CHECK (nth >= 2),               -- every_nth_order
  inactive_days     int     CHECK (inactive_days >= 14),    -- winback
  cooldown_days     int     NOT NULL DEFAULT 7 CHECK (cooldown_days >= 0),  -- minimum days between two of this programme's codes for one customer
  monthly_cap       int     CHECK (monthly_cap >= 1),       -- referral: rewards per referrer per calendar month
  push_title        text,
  push_body         text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

Every programme is seeded **switched off**, with its template coupon already in place, so turning one on is a single `UPDATE`. Recommended starting values (D13):

| Programme | Issued when | Gives | Min order | Valid for | Cooldown / cap |
|---|---|---|---|---|---|
| **Welcome** *(Phase 1: a public coupon, not a programme)* | first order | ₹50 off | ₹199 | until its ₹5,000 budget runs out | once per customer |
| `apology` | an order is **declined** or **expires** | ₹40 off | ₹149 | 7 days | 1 per 7 days |
| `first_order_thanks` | the **first** order is delivered | ₹30 off | ₹199 | 10 days | once ever |
| `every_nth_order` | every **5th** order is delivered | ₹50 off | ₹249 | 14 days | — |
| `winback` | **30 days** after the last delivered order | ₹50 off | ₹199 | 7 days | 1 per 60 days |
| `referral` (§7) | a friend's first order is delivered | the friend: ₹50 off their first order; the referrer: ₹50 off | ₹199 | the referrer's code: 30 days | 5 rewards a month |

"First order" appears twice on purpose:
- **Welcome** wins new customers: a discount *on* the first order, for anyone new.
- **First-order thanks** keeps them: a reason to place a *second* order, the one most new customers never place.

### 6.2 Issuing

One trigger, `AFTER UPDATE OF status ON orders`, calls `private.on_order_status_coupons()`:

```
pending → declined | expired    → issue('apology', customer, order)

… → completed                   → count this customer's completed orders:
                                    exactly 1                → issue('first_order_thanks', …)
                                    a multiple of nth        → issue('every_nth_order', …)
                                  if the order used a referral code and it's the
                                  customer's first completed order → reward the referrer (§7)
```

`private.issue_program_code(program, user, source_order)` only issues a code when all of these hold:
- the programme is switched on, and its template coupon is active;
- the customer has the `customer` role and doesn't share a phone with the restaurant (§3.5);
- the programme's cooldown or cap allows it.

The code is a personal code with `assigned_to` set, `expires_at = now() + valid_days`, `issued_reason` set to the programme and `source_order_id` set to the order. `uq_coupon_codes_source` makes it impossible to issue a second code for the same order and reason.

A customer cancelling their own order (`→ cancelled`) never gets an apology code, because it was their own action.

### 6.3 A coupon bug must never block an order

This trigger runs inside the owner's accept, decline and deliver updates, and inside the cron job's expiry update. If issuing a code fails for any reason (a clash on a generated code, a bad programme row, anything else), **the status change must still go through**. So:
- The trigger body is wrapped in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING …; END`.
- The function is `SECURITY DEFINER` with `search_path = ''`, because owners have no grant on the coupon tables.
- A test pins it: with the apology programme pointing at a broken coupon row, declining an order still succeeds.

### 6.4 Win-back

A daily job at 11:00 IST runs this chain:
1. `pg_cron` calls `net.http_post`.
2. That calls a new Edge Function, `coupon-jobs`, behind the same `X-Cron-Secret` check as `expire-orders`.
3. `coupon-jobs` calls `public.issue_winback_coupons()`, which only `service_role` can execute.
4. It sends one push per issued code through `send-push`.

The cron job is created in the SQL Editor, like the other cron jobs.

It picks customers who meet all of these:
- their last delivered order is at least `inactive_days` old;
- they have no live order;
- they hold no unexpired, unused personal code;
- they haven't had a win-back code within the cooldown.

It picks at most 200 per run, so the first run over the whole customer base is limited.

### 6.5 Telling the customer

- **Push.** `send-push` already sends a push on every status change, through the `orders` webhook. After the usual status text, it looks up `coupon_codes` by `source_order_id` and adds a line. The trigger wrote the code in the same transaction, which committed before the webhook fired, so the code is always there to find.
  - Declined: *"The restaurant couldn't take this order. Nothing to pay — and ₹40 off your next order is waiting in Coupons."*
  - Delivered, with a milestone code: *"Delivered — enjoy your meal! 🍽️ Your next order has ₹50 off, in Coupons."*
- **On the order page.** For a declined or expired order, `OrderStatus` shows a card: *"Sorry about that. Here's ₹40 off your next order: SORRY4KQ7, valid for 7 days."* It finds the code through `list_offers` (`source_order_id`).
- **Customers who only use the website** get no push, because push is only in the Android app. They'll see the code in "My coupons" and in the checkout sheet next time. Coupons don't use SMS (§14).

---

## 7. Referral programme (Phase 3)

### 7.1 How it works

1. **A customer gets their code.** Any customer with at least one delivered order can open **Refer friends** (on `/coupons` and in `Profile`). `public.get_my_referral_code()` returns their existing code or creates one: up to five letters of their first name plus three random characters (`ANKIT7Q`). If the name has no Latin letters, the code is `RL` plus six random characters.
2. **They share it** with a WhatsApp button. The message reads: *"Get ₹50 off your first RedLotus order with my code ANKIT7Q: https://redlotusfoods.in/coupons?apply=ANKIT7Q"*.
3. **The friend uses it.** A new customer (D10) uses the code on their first order and gets ₹50 off orders of ₹199 or more, under the `referral` coupon's rules.
4. **The referrer is rewarded.** When that order is **delivered**, the trigger issues the referrer a personal ₹50 code, valid for 30 days. `send-push` tells them: *"Your friend just got their first RedLotus order. ₹50 off your next order is waiting in Coupons."* The message never names the friend.

If the friend's first order is declined or expires, the use of the referral code comes back (§3.6). The reward comes when a later order with the code is delivered.

### 7.2 Rules

- The friend must be a new customer (D10), and can't be the referrer, matched by account or phone (`own_referral`).
- The reward needs a **delivered** order, which means a real meal paid for in cash. An order that's only been placed earns nothing.
- **The referrer's rewards are capped.** A referrer gets at most `monthly_cap` rewards (5) per calendar month. Friends referred beyond that still get their discount.
- **The cap can't be overshot.** If two friends' orders are delivered at the same moment, `pg_advisory_xact_lock` on the referrer makes them run one at a time.
- The referral coupon has a budget, because the Boundedness Invariant applies to `referral` coupons.

### 7.3 Abuse

The cheapest attack is one person with two SIM cards referring themselves. Each fake "friend" costs a real meal, delivered and paid for in cash, and earns ₹100 of discounts (₹50 + ₹50). At Gudha Gorji menu prices, that's a poor trade.

`private.referral_audit` flags the patterns worth a look:
- referrers close to their monthly cap;
- friends whose delivery pin is within 100 m of one of the referrer's saved addresses. That's either a family member or a second SIM, and Ankit decides which.

A flagged code can be revoked.

---

## 8. Announcing coupons

- **Banners (Phase 1).** A `promotions` row linking to `/coupons?apply=CODE` (§5.8). The festival discount line on discovery cards stays as it is.
- **Push campaigns (Phase 3).** A new Edge Function, `promo-broadcast`, behind `X-Cron-Secret`. Ankit calls it with curl, or from the SQL Editor through `net.http_post`.
  - It takes `{ campaign_id, title, body, url, audience }`, where `audience` is `all`, `never_ordered` or `lapsed_30d`.
  - It finds the users through `public.promo_push_audience()` (`service_role` only) and sends each one a `channel: "promos"` push through the existing FCM path.
  - `campaign_id` is recorded in `promo_broadcasts`, and sending the same id twice does nothing, so running the curl twice can't message everyone twice.
  - Android users can mute the "promos" channel in system settings and still get order updates.
- **Offer lines (Phase 3).** The best listed offer at each restaurant, shown as a line on its discovery card and as a pill on its menu page. It comes from one `list_offers()` call when the home page loads.

Copy rule: none of it may say "app", "download" or "install" (the CLAUDE.md product constraints).

---

## 9. Security & abuse

### 9.1 Only three functions can read coupon data

- **The tables:** `coupons`, `coupon_codes`, `coupon_lookups`, `coupon_programs` and `promo_broadcasts` have RLS on, no policies, and no grants to `anon` or `authenticated`. That's the `restaurant_commissions` pattern. Batch and personal codes work like cash: if `coupon_codes` were readable, it would give them all away.
- **The client's way in:** clients reach coupon data only through `preview_coupon`, `list_offers` and, in Phase 3, `get_my_referral_code`. Each returns exactly what the caller is allowed to see (§5.5).
- **The `private` schema:** internal functions and admin helpers live there.
  - It isn't one of the schemas the API exposes. Those are `public` and `graphql_public` by default, and `config.toml` doesn't change that. **Check the production setting once in Dashboard → API settings.**
  - `anon` and `authenticated` get no `USAGE` on it.
  - `EXECUTE` is also revoked from `PUBLIC`, as extra protection.

  This matters because Postgres grants `EXECUTE` on every new function to `PUBLIC` by default. A SECURITY DEFINER `coupon_issue_personal` in `public` would let any signed-in customer create coupons for themselves.
- **Service-only functions:** some functions have to be called by an Edge Function over the API (`issue_winback_coupons`, `promo_push_audience`). They stay in `public`, with `EXECUTE` revoked from `PUBLIC`, `anon` and `authenticated` and granted to `service_role`. The verify script checks every one of them.

### 9.2 Race conditions

| Race | Prevented by |
|---|---|
| Two customers take the last use, or the last of the budget | the `coupons` row lock in `place_order`, taken before the counts are read |
| One customer places two "first orders" with two different new-customer coupons | the customer's `users` row lock |
| Two deliveries at the same moment push a referrer over their monthly cap | an advisory lock per referrer |
| The same automatic code is issued twice for one order | `uq_coupon_codes_source` |

### 9.3 Guessing codes

- **`preview_coupon` is the only way to look up a code.** It records every miss and refuses after 10 misses per account per hour.
- **`place_order` only accepts a code this account has previewed in the last 24 hours**, so it can't be used as an unlimited way to test codes. `place_order` has to work like this because a raised exception rolls back its whole transaction, so it can't record a miss itself.
- **Generated codes are hard to guess.** They're 8 characters from a 31-character alphabet: 31⁸ ≈ 8.5 × 10¹¹ possibilities.
- **The numbers:** take an attacker with 100 phone-verified accounts, guessing non-stop for a month (720,000 guesses), against 1,000 live batch codes. On average they would find **0.0008** of one code.
- **Personal codes** are useless to anyone else even if found.

### 9.4 One person, many accounts

"New customer" and "per customer" are judged by account **and** phone (D10, §5.3).

Someone with a second SIM can still get through. What limits them is budgets, per-customer limits and, for referrals, the need for a delivered meal. Phone-OTP login (`phone_otp_login_plan.md`) will make the phone number the account, which tightens this further without any change here.

### 9.5 Owners and their phones

The 026 guard (§3.5) runs at preview, when the order is placed, and when a code is issued.

The attack it stops: an owner orders from their own restaurant with a coupon RedLotus pays for. The restaurant is still paid the full menu price at settlement, so a ₹100 flat coupon on a ₹200 order nets the owner about ₹50 per fake order. The guard can't see an owner using a friend's phone, but `private.coupon_uses` shows it: a restaurant whose coupon orders all come from the same two customers.

An owner could also collect apology codes for a friend by declining that friend's orders on purpose. What limits that:
- the 7-day cooldown;
- the ₹40 value;
- a high decline rate is already something Ankit watches for.

### 9.6 Account deletion

`delete-account` gains one step: revoke the customer's unused personal codes and their referral code (`revoked_at = now()`). The codes aren't deleted, because orders point to them.

### 9.7 Two policy rules

- **Never give a coupon in return for a review or rating.** It would corrupt the reviews system (019/026), and it breaks Google Play's policy on incentivised ratings.
- **Never tie a reward to installing the app.** Referral rewards are paid on a delivered order, not on an install.

---

## 10. Settlement and money reporting

Because the coupon is stored in `discount_amount` (§5.2) and RedLotus pays for it (D1), **022's settlement formula doesn't change**:

```
redlotus_gross = total_amount − restaurant_payout
               = commission + delivery_fee + surge_fee + platform_fee − discount_amount
```

Like the festival discount, the whole coupon lands on RedLotus's side of the ledger. Two views change. Each is updated with `CREATE OR REPLACE VIEW`, with new columns added at the end:

- **`order_settlement`**: adds `coupon_code`, `coupon_delivery_waiver` and `auto_discount_forgone`.
- **`order_delivery_margin`**: `collected` becomes `delivery_fee + surge_fee − coupon_delivery_waiver`. A delivery fee the coupon removed is money the ride didn't earn.

The Discount-Funding Invariant (commission higher than the festival discount, 022 §3.8) still applies to the festival discount. It deliberately does **not** apply to coupons: a welcome coupon is meant to cost more than one order earns (example E). Coupons are marketing spend, controlled by budgets, and `coupon_performance` shows whether each one paid for itself.

**GST:** the unresolved e-commerce-operator question (`v2_deferred_issues.md` §7.9) now also covers how discounts that RedLotus pays for are treated. It belongs with that question: something to ask a CA.

---

## 11. Rollout

Each phase follows the same routine as 024–026:

1. **PR.** It contains:
   - the migration;
   - `ops/0NN_verify.sql` (one `UNION ALL` query);
   - `ops/0NN_rollback.sql`;
   - sample coupons in `seed.sql`, which only preview branches use.
2. **Preview branch.** Run the end-to-end SQL script (§12) against the branch. Every case must pass.
3. **Production `db push`**, outside 12–2 PM and 7–9:30 PM IST. Check the time with PowerShell `Get-Date`, not Git Bash. Then run `0NN_verify.sql`.
4. **Merge.** Vercel deploys the website, and the `package.json` version bump sends the update to the Android app over the air.
5. **The first coupon.** Create it with `active = false`, test it with a customer account (admin accounts are refused), then switch it on.

**Nothing changes by default.** Until a coupon row exists and is active, v5 behaves exactly like v4 for everyone. Installed apps still running the old bundle keep working through the `DEFAULT NULL`s. They can't apply a coupon until the update arrives. They also label a coupon order's discount as "Discount", but the amounts are still right (§5.2).

**Rolling back:**
- **Soft (seconds, no deploy):** `UPDATE coupons SET active = false;`
- **Hard:** `ops/0NN_rollback.sql`. It puts back `place_order` v4 and drops the coupon functions, but keeps the new `orders` columns. Past coupon orders still show correctly, because their value is in `discount_amount`.

**Chores:**
- Regenerate `src/types/database.ts`. If Docker isn't running, use the `--linked` route described in the supabase-type-gen notes.
- Update `ops/023_verify.sql`, which names the 11-argument `place_order` signature.

---

## 12. Tests

**Pure logic (Vitest)**, within the Phase 4 test scope:

- **`src/lib/coupons.test.ts`:**
  - `couponAmounts` for each discount type at every boundary:
    - exactly at `min_subtotal`, and one rupee under;
    - the cap binding, and not binding;
    - `.5` rounding;
    - free delivery with a fee of 0, with a cap below the fee, and with an unknown fee (`null`, never 0).
  - `isCouponLive`:
    - campaign dates;
    - IST weekdays at the 00:00 IST boundary;
    - daily windows, including one that runs past midnight;
    - whichever of `ends_at` and `expires_at` comes first.
  - Choosing between coupon and festival discount:
    - the coupon wins;
    - the festival discount wins;
    - a tie keeps the festival discount and doesn't spend the coupon;
    - free delivery waiting for an address.
  - `normaliseCode`, against the same cases as the SQL version.
- **`src/lib/pricing.test.ts`:**
  - with `coupon = null`, every existing expectation is unchanged;
  - with a coupon, the six §4 examples come out exactly.
- **`src/pages/dashboard/utils.test.ts`:** on a free-delivery coupon order, `menuValue` equals the item total (§5.10).

**Database, end to end on the preview branch.** This is a SQL script, as for 025 and 026:

1. The normal path for each discount type: the stored columns and `total_amount` match §4.
2. The per-customer limit holds, and a second account on the same phone is refused.
3. **Two sessions try to take the last use at the same time: exactly one succeeds.**
4. A decline, an expiry and a cancellation each give the use back; a completed order keeps it.
5. Budget: an order that would go over is refused, and pending orders count against it.
6. The new-customer rule, including an account that is deleted and created again on the same phone.
7. An owner, an admin, and a customer on the restaurant's or owner's phone are all refused.
8. Claiming both the festival discount and a coupon is refused (`PRICING_MISMATCH`).
9. The guessing limiter trips at 10 misses and resets after an hour.
10. `place_order` with a valid code this account never previewed returns `not_found`, and reveals nothing else.
11. An old 11-argument call still places a normal order.
12. Someone else's personal code returns `not_yours`; a used batch code returns `used`.
13. No client role can `SELECT` any coupon table or call any `private` function, and `anon` can call `list_offers` and nothing else.
14. *(Phase 2)* A decline issues exactly one apology code, and the cooldown holds. **A broken programme row doesn't block the decline.**
15. *(Phase 3)* The referral reward is only issued on delivery, is capped per month, and is never issued for referring yourself.

---

## 13. Risks

| Risk | Likelihood | Impact | What limits it |
|---|---|---|---|
| A public code spreads far beyond its intended audience | High | The budget runs out faster | A required budget or total limit (§3.9); the per-customer limit; pausing takes seconds |
| A typo in a value (₹5000 instead of ₹50) | Medium | One bad day's margin | The ₹500 ceiling CHECK; the food-is-never-free CHECK; create the coupon switched off, test it, then switch it on |
| Two customers take the last use | Low | Overspend by one use | The row lock (§9.2); test 3 |
| An owner uses coupons on their own restaurant | Medium | Money leaks directly | The 026 guard, reused; the `coupon_uses` report |
| Fake referrals from extra SIM cards | Medium | ₹100 per fake friend | A delivered order is required; the monthly cap; `referral_audit` |
| The owner dashboard shows the wrong order value | Low (by design) | Partners stop trusting the numbers | The value goes in `discount_amount` (§5.2); the `menuValue` test |
| A bug in the automatic codes blocks declines or expiries | Low | Orders get stuck | The trigger swallows its own errors (§6.3); test 14 |
| A customer is confused when a coupon "does nothing" | Medium | Support messages | The coupon-vs-festival copy (§3.7); locked reasons in the sheet |
| `delete-account` later starts scrubbing `orders.customer_phone` | Low | Signing up again resets "new customer" status | Flagged in §5.3; keep a hashed copy if it happens |
| GST treatment of discounts RedLotus pays for | Unknown | Tax exposure | A CA question, alongside `v2_deferred_issues.md` §7.9 |
| Customers start treating coupons as the normal price | Medium | Margins shrink | Prefer personal and event coupons to coupons for everyone; look at `coupon_performance` weekly |

---

## 14. Later (v2)

- **Free dish / buy one get one** (D3). This needs rules for specific dishes and a way to put a ₹0 line on the order.
- **Offers the restaurant pays for.** The partner would pay, set them up from their dashboard, and see them on order tickets and on their statement. This needs a `funded_by` column on `coupons`, a payout change in `order_settlement`, and the partner's consent.
- **An admin page**, if coupon management moves off the Dashboard (the triggers in `v2_deferred_issues.md` §2).
- **"Your coupon expires tomorrow" reminders**: a second daily job.
- **An apology for late delivery**, when an order arrives well after its promised time (014). This needs a reliable delivery time; today the owner's "Delivered" tap can come some time after the actual drop-off.
- **SMS for customers who only use the website.** This needs a DLT *promotional* template, and promotional SMS can't reach DND numbers or be sent after 9 PM.
- **Applying the best coupon automatically**, but only if data shows customers are missing coupons they would have used.
- **Budget alerts**: a push to Ankit when a coupon has spent 80% of its budget.

---

## 15. Implementation phases

### Phase 1: the engine, and every code you create by hand

- [ ] Migration `0NN_coupons.sql`:
  - [ ] the `private` schema;
  - [ ] `coupons`, `coupon_codes` and `coupon_lookups`, with their triggers, CHECKs and grants;
  - [ ] the new `orders` columns and indexes;
  - [ ] the internal functions: `private.normalise_coupon_code`, `new_coupon_code`, `coupon_is_live`, `coupon_amounts`, `coupon_check`;
  - [ ] `preview_coupon` and `list_offers`;
  - [ ] `place_order` v5, dropping the 11-argument version;
  - [ ] the admin helpers `coupon_generate_batch` and `coupon_issue_personal`;
  - [ ] the report views, and the updated settlement and margin views.
- [ ] Scripts:
  - [ ] `ops/0NN_verify.sql` and `ops/0NN_rollback.sql`;
  - [ ] the preview end-to-end script (tests 1–13);
  - [ ] sample coupons in `seed.sql`;
  - [ ] update `ops/023_verify.sql`.
- [ ] Client logic:
  - [ ] `src/lib/coupons.ts` with tests, `couponsApi.ts` and `couponStorage.ts`;
  - [ ] the coupon argument in `pricing.ts`, with tests;
  - [ ] the `menuValue` test.
- [ ] Checkout:
  - [ ] the coupon row, the coupon sheet, error handling and the pending code;
  - [ ] the coupon line in `ConfirmOrderModal`.
- [ ] Receipts: `OrderStatus` and `OrderHistory` labels.
- [ ] Coupons page:
  - [ ] `/coupons` (enter a code, your coupons, offers) with `?apply=`;
  - [ ] links from `AppTopBar` and `Profile`.
- [ ] `delete-account`: revoke personal codes.
- [ ] Legal text: Terms of Service §10 (after D14 sign-off) and the Privacy Policy line.
- [ ] Regenerate `database.ts`.

### Phase 2: automatic codes

- [ ] Migration `0NN_coupon_programs.sql`:
  - [ ] `coupon_programs`, seeded switched off, with template coupons;
  - [ ] `private.issue_program_code` and the status trigger;
  - [ ] `issue_winback_coupons()`.
- [ ] `send-push`: add the coupon line to declined, expired and delivered pushes.
- [ ] Edge Function `coupon-jobs`, plus the daily `pg_cron` job (created in the SQL Editor).
- [ ] `OrderStatus`: the apology card. "Your coupons": the reason subtitles.
- [ ] End-to-end test 14.

### Phase 3: referrals and campaigns

- [ ] Migration `0NN_referrals.sql`:
  - [ ] the referral coupon and reward template;
  - [ ] `get_my_referral_code()`;
  - [ ] the reward branch in the trigger, with its advisory lock;
  - [ ] `private.referral_audit`;
  - [ ] `promo_broadcasts` and `promo_push_audience()`.
- [ ] The "Refer friends" card with WhatsApp sharing, on `/coupons` and in `Profile`.
- [ ] `send-push`: the referrer's reward push.
- [ ] Edge Function `promo-broadcast`.
- [ ] Offer lines on discovery cards and pills on the menu page.
- [ ] End-to-end test 15.

---

## 16. Doc updates when this ships

- **CLAUDE.md** and its `GEMINI.md` mirror:
  - [ ] add the `/coupons` route;
  - [ ] update the `place_order` rule (13 arguments, `COUPON_INVALID:`);
  - [ ] add a coupons critical rule: the value lives in `discount_amount`, there are no client grants, internals live in the `private` schema, and the Boundedness Invariant applies;
  - [ ] update the RLS summary;
  - [ ] update the file map (`coupons.ts`, `couponsApi.ts`, `couponStorage.ts`, `/coupons`, `coupon-jobs`, `promo-broadcast`);
  - [ ] remove "promo codes" from the v2-deferred list;
  - [ ] update the discount bullet under the business constraints.
- **`v2_deferred_issues.md`**: add a section for the simplifications in coupons v1 (§14).
- **`pre_production_checklist.md`**: strike "No discount/promo UI".
- **`business_plan.md` §5.3.5** and **`redlotusfoods_documentation.md` §6.7**: mark them as superseded by this plan.
