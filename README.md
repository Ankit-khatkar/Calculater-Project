# Filters and Sorting — Feature Design & Implementation Plan

> **Status:** v2 draft (2026-10-23). **Backend changes are now in scope.** On 2026-10-23 Ankit wrote: "you can update the backend for apply this feature with accuracy like Zomato-style filters and sorting panel". Waiting on Ankit's answers to §0 (FS1–FS16) and the read-only audit in Appendix A. No code and no database object has changed for this feature yet.
> **Author:** Ankit (drafted with Claude)
> **Revision:** v2 — 2026-10-23. v1 (same day) was frontend-only; §2 lists what v2 changes.
> **Baseline:** `main` @ `0d4754b` (plus uncommitted copy changes in the working tree): 463 tests pass in 39 files; lint and `tsc -b` clean.
> **Scope:**
> - a Zomato-style "Filters and sorting" panel and filter bar for Home's "restaurants near you" list (`/`) and the Search results (`/search`, both tabs);
> - **the backend facts it needs:** server-stamped order progress times, per-restaurant menu facts, an admin-verified Pure Veg flag enforced against the menu, delivery-time estimate inputs, popularity scores and a nightly refresh;
> - the delivery-time estimate and the Pure Veg mark on restaurant cards and the restaurant page;
> - the owner menu editor's Pure Veg guard.
>
> **Out of scope:**
> - Buy 1 Get 1, a new coupon type priced inside `place_order` (its own plan, FS11);
> - a blended "Recommended" ranking;
> - filters on the restaurant menu page;
> - step times in the order tracker (M1 makes them possible, but this plan doesn't build them);
> - owner-facing statistics;
> - payments, checkout and pricing logic.
>
> **Migrations:** three, all additive (§7). They take the next free numbers when written: **030–032** if they land before the phone-OTP migrations, whose numbering note then moves to 033/034. **Edge Functions:** none. **pg_cron:** one new SQL-only job. **Native build:** none; ships by Capgo OTA after review.
> **Coordinates with:** [customer_app_ui_redesign_plan.md](customer_app_ui_redesign_plan.md) (§3.1 data gaps, §4.1 "Honest UI", §6 primitives, §8.1 Home, §8.2 Search) · [customer_search_plan.md](customer_search_plan.md) (the nearby-scoped dish fetch) · [location_resilience_plan.md](location_resilience_plan.md) (the browse engine is not touched) · [coupons_and_promo_codes_plan.md](coupons_and_promo_codes_plan.md) (`list_offers`, `bestOfferFor`, BOGO in §14) · [reviews_and_ratings_plan.md](reviews_and_ratings_plan.md) (the 019 aggregate doctrine) · [customer_cancellation_and_eta_plan.md](customer_cancellation_and_eta_plan.md) (the order-time ETA, which stays separate) · [distance_based_delivery_plan.md](distance_based_delivery_plan.md) (Principle 1, the grant doctrine) · [phone_otp_login_plan.md](phone_otp_login_plan.md) (migration numbering).
> **Brief:** the "Zomato-style Sorting and Filtering UI" prompt (2026-10-23), plus the same-day change of mind that allows backend work. **The screenshot the brief refers to was not attached to the conversation**, so the layout in §12 follows the brief's written description. Check §12.2 against the screenshot before Phase 5.

## At a glance

- **One panel, two screens.** A "Filters" button above Home's restaurant list and above each Search tab opens a bottom sheet, or a centred card on wider screens. It has "Filters and sorting" with "Clear all" in the header, categories on the left, the selected category's options on the right, and **Close** / **Show results** at the bottom.
- **The browser filters; the server supplies the facts.** Each screen already holds every restaurant whose delivery area covers the customer, so filtering there is exact and instant, and a checkbox never triggers a request. What v1 lacked was trustworthy data. v2 computes that data on the server once, where no client can fake it, and ships it inside the queries the screens already make.
- **What ships:**
  - **Sort:** Relevance, Delivery time, Rating, Popularity, Price low→high, Price high→low.
  - **Delivery time:** Under 30 min, Under 45 min.
  - **Rating:** 3.5+, 4.0+, 4.5+.
  - **Offers:** Flat ₹ off, % off, Free delivery.
  - **Dish price:** Under ₹200, ₹200–₹350, Above ₹350.
  - **Veg / non-veg:** Pure Veg and Serves non-veg for restaurants; Veg and Non-veg for dishes.
  - **Collections:** Previously ordered, New to you.
- **New server-side facts:**
  - **M1:** order progress times, stamped by the database when the owner taps Preparing, Out for delivery and Delivered.
  - **M2:** per-restaurant menu facts (dish counts, typical price), kept current by triggers; an admin-verified **Pure Veg** flag that the database enforces against the menu.
  - **M3:** delivery-time inputs (Ankit's prep time per restaurant, the observed prep time, ride-speed knobs) and nightly **popularity** scores.
- **Visible on screen:** cards and the restaurant page show the estimate ("30–35 min") and a **Pure Veg** mark, so a customer can check every filter against the result in front of them.
- **Still not built:** Buy 1 Get 1, which needs a new pricing engine (FS11).
- **Staged selections.** Changes are pending until **Show results**. **Close**, ESC, the backdrop and Android back discard them. **Clear all** resets the pending selections and never touches the search query, the category or the location.
- **Applied filters live in the URL** (`/?sort=delivery_time&time=30`) and are written with `replace`. Back from a menu and refresh both keep them.
- **With nothing selected, the lists are exactly today's**: same items, same order, same array identity. This is tested.
- **Rollout:** database first, frontend after. M1 ships first and on its own, because every day it's live adds delivery history. Nothing is merged, pushed or sent by OTA without Ankit's review (§20).

---

## 0. Decisions for Ankit

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| **FS1** | Where the panel appears | **Home's "restaurants near you" list and Search results (both tabs).** Not the restaurant menu page, which already has in-menu search and "Veg only". The Featured and Top rated rails ignore filters. | The brief says to keep search, category and location constraints and to match "the current page context". Those constraints exist on exactly these two screens. |
| **FS2** | What "price" means for a restaurant | **The median price of its available dishes**, kept on the server by a trigger (`restaurant_stats.price_median`). The panel explains it in one line. *Alternatives:* the cheapest dish; a "cost for two" Ankit types in per restaurant. | There's no cost-for-two field. The median is exact, needs no upkeep, isn't skewed by a ₹10 roti, and puts each restaurant in exactly one price band. A typed-in figure goes stale as menus change. |
| **FS3** | Rating basis | **The average shown on the card or row, with no minimum number of ratings.** Ties go to the larger count. Unrated items are excluded by a rating filter and sorted last. *Alternative:* require ≥ 5 ratings, like Top rated. | With no minimum, one 5.0 review can top the sort. With a minimum, a card showing "4.6" would vanish from "Rated 4.5+", which looks broken. |
| **FS4** | "Previously ordered" | **Restaurants with at least one `completed` order on this account.** "New to you" is the rest. Signed-in customers only, on restaurant lists only. *Alternative:* any order that wasn't declined, expired or cancelled. | "Ordered from before" should mean the customer actually received food. |
| **FS5** | Where applied filters live | **In the URL query, written with `replace`.** *Alternative:* a session-only React context. | Search already keeps its state in the URL (redesign plan §8.2). With the URL, back restores filters and scroll position, and nothing can drift out of sync. Tapping the Home or Search tab opens it with no filters, which works as a reset. |
| **FS6** | The delivery-time model | **Estimate = prep + ride + doorstep, shown as a window (§8).** *Prep* is the observed median of "order placed → handed to the rider" over the last 60 days, once a restaurant has ≥ 10 such orders; before that, Ankit's `prep_time_minutes`. *Ride* is distance × minutes per km. **Starting knobs:** prep 20 min, 4 min/km, doorstep 5 min, a 5-minute window. With these, a restaurant 2 km away shows "35–40 min". | The handover is timed by the database the moment the owner taps "Out for delivery", so prep is measured, not guessed. The ride is RedLotus's own riders, so Ankit sets its speed and tunes it with Appendix A.8. |
| **FS7** | Delivery-time options | **Sort "Delivery time: fastest first". Filter: Any time / Under 30 min / Under 45 min, judged on the window's *upper* end.** So a "30–35 min" card is not "Under 30". | The filter must never promise faster delivery than the card shows. Appendix A.8 shows how many restaurants each option keeps with the chosen knobs. |
| **FS8** | Show the estimate and Pure Veg on cards and the restaurant page | **Yes.** | A filter the customer can't check on the result looks broken. Zomato shows both. |
| **FS9** | Pure Veg | **Ankit sets `restaurants.is_pure_veg` after checking the kitchen.** From then on, database triggers guarantee a Pure Veg restaurant never shows an available non-veg dish, and owners get a clear message if they try. **"Serves non-veg"** means at least one available non-veg dish. | Pure Veg is a promise about the kitchen; only Ankit can verify that. The database keeps the menu consistent with the promise, so the badge can't drift. |
| **FS10** | Popularity | **A nightly score from 0 to 100**: per restaurant from completed orders in the last 30 days, per dish from units sold. Stored as a percentile. **Raw counts are never stored where a client can read them.** | Order volumes are business-sensitive (the grant doctrine, §3). A percentile is enough to sort, and the sort reveals the order anyway. |
| **FS11** | Buy 1 Get 1 | **A separate plan, after this ships.** The Offers category gains a "Buy 1 Get 1" option once that coupon type exists. | BOGO is a pricing-engine change to `place_order`, not a filter: per-item rules, the ₹500 cap, the never-free-food checks, the client pricing mirror, the coupon sheet and the receipts. |
| **FS12** | Offers by type | **Flat ₹ off · % off · Free delivery.** When a type is chosen, the card shows the best offer *of that type*. | The card then always explains why it matched. |
| **FS13** | "Show results" when nothing matches | **Disabled**, with "Nothing matches — remove a filter" above it. It enables again as soon as a change produces results. | All data is local, so the count is exact before applying. |
| **FS14** | The Search dish fetch | **Paginate it in pages of 1,000, and let a failed fetch be retried.** | Dish filters on Search must see every nearby dish; today the fetch can be silently cut at PostgREST's row cap. Retry gives the error states something to do. |
| **FS15** | Sheet primitive | **Add two optional props to `Sheet`:** `headerAction` (renders "Clear all") and `showCloseButton` (default `true`). Existing sheets are unchanged. | Focus trap, ESC, backdrop, scroll lock and Android back stay in one tested place (redesign plan §6.5). |
| **FS16** | Old orders | **Don't write guessed timestamps onto old orders.** Estimates start from Ankit's prep times. Appendix A.7 uses old orders' `updated_at` (read-only) to help him choose those prep times. Ship M1 first so real history builds up. | A guessed time stored on an order would make the column untrustworthy for ever. `updated_at` also moves for other reasons, such as account deletion. |

**Before Phase 1:** run the read-only audit in Appendix A in the SQL Editor (A.1–A.7). It sizes every option with real data and gives starting prep times per restaurant.

---

## 1. Context and goal

Customers can search and pick a category, but they can't **narrow or reorder** what they see. Home is always "nearest first", and Search is always "nearest restaurant, then dish name". Someone who wants "fast delivery", "well rated", "Pure Veg", "under ₹200" or "places with an offer" has to open restaurants one by one, and RedLotus has no data today to answer "how fast" or "how popular".

**Goal:** a familiar filter-and-sort panel whose every option is backed by data that is:

1. **real:** computed from orders, menus and verified settings, never typed into the client or guessed;
2. **current:** triggers keep menu facts in step with every edit, and a nightly job refreshes history-based scores;
3. **checkable:** what a filter tests is visible on the result (the estimate, rating, offer, Pure Veg mark, veg mark and price), with one documented exception (FS2);
4. **cheap at runtime:** no request per tap, and no change to the rest of the app when nothing is selected.

---

## 2. What v2 changes from v1

| Topic | v1 (frontend only) | v2 |
|---|---|---|
| Delivery time / Fast delivery | Not available | An estimate from server-stamped history, Ankit's prep times and travel knobs (§8); shown on cards (FS6–FS8) |
| Popularity | Not available | Nightly percentile scores for restaurants and dishes (FS10) |
| Restaurant Pure Veg | Not available | An admin-verified flag that triggers enforce against the menu (FS9) |
| Restaurant Non-veg | Optional | "Serves non-veg" from trigger-maintained counts |
| Restaurant price | Median computed in the browser after a dish fetch on Home | `restaurant_stats.price_median`, kept by a trigger. **Home fetches no dishes.** |
| Offers | One option: "with an offer" | By type, with the card showing the matching offer (FS12) |
| Buy 1 Get 1 | Not available | Still not built; its own plan (FS11) |
| Dish fetch completeness | Flagged risk (1,000-row cap) | Paginated (FS14) |
| Order step times | Not stored | Stamped by the database (M1). The tracker can use them later. |

Unchanged from v1: page contexts, staged selections, URL state, the "no filters = today's results" guarantee, accessibility and the copy style.

---

## 3. Constraints and doctrines

| Rule | Source | How v2 meets it |
|---|---|---|
| Every new table and function carries its own explicit GRANTs | 023 | Each migration grants anon / authenticated / service_role explicitly; the verify scripts check them |
| Clients write only granted columns | 024, 025 | **No client role gets a write grant on anything this plan adds.** Derived data is written only by SECURITY DEFINER triggers and the nightly job. Admin-set fields are edited in the Dashboard. |
| A new column on `restaurants` or `orders` is readable by every signed-in customer (table-level SELECT for authenticated) | 022 | Only customer-safe facts go on those tables: `is_pure_veg`, `prep_time_minutes`, the order stamps. Derived statistics go into side tables with their own grants. Nothing volume-revealing is exposed (FS10). |
| Anonymous visitors read `restaurants` through a column grant | 016 | The two new restaurant columns are added to it. **The frontend that selects them must not ship before the migration** (§20). |
| **`restaurants.updated_at` is the owner's "Last changed" label** | `RestaurantHeader.tsx:122` (the open/close toggle helper) | **No trigger or job in this plan ever updates a `restaurants` or `menu_items` row.** Menu facts and scores live in `restaurant_stats` / `menu_item_stats`, so a dish edit or the 03:30 job can't make an owner's dashboard say "Last changed 3:30 AM". |
| Aggregates are recomputed from scratch by SECURITY DEFINER functions with `search_path = ''` | 019, 026, 027 | The menu-facts refresh and the Pure Veg guards |
| Server-stamped times, immutable once set | 014 (`stamp_order_accept`) | M1's progress stamps, silently restored on any later write |
| Engine helpers live in `private` (no USAGE for clients); trigger functions there work | 027, 028 (`private.on_order_status_coupons`) | `private.refresh_restaurant_menu_facts`, the guards, `private.refresh_browse_stats` |
| Never put a `private` function in an index, CHECK or default on a client-written table | 027 lesson | None does |
| Principle 1: no delivery constants in the frontend | 022 | Every estimate knob is in `browse_config`. With no loaded config there is no estimate and no delivery-time option. |
| Rehearse on a preview branch; e2e in one never-committed transaction | 023, 027–029 | `ops/030–032_{verify,e2e,rollback}.sql` |
| Database before frontend; Ankit runs `db push` | the 022 distance-delivery cutover | §20 |
| Deploy outside 12–2 PM and 7–9:30 PM IST | CLAUDE.md | §20 |
| No mocked Supabase in tests | CLAUDE.md testing | Database behaviour is tested by the e2e SQL scripts; client tests stay pure |
| Tokens and primitives only; no new dependencies | Redesign plan §5–§6; the brief | `Sheet`, `Chip`, `Button`, `EmptyState`, `InlineNotice`, `VegMark`, `--rl-*`, `lucide-react` |

---

## 4. Data

### 4.1 What the screens already load

| Data | Fields | Source |
|---|---|---|
| Nearby restaurants | `id, name, cuisine_type, address, image_url, image_urls, lat, lng, delivery_radius_km, is_featured, featured_rank, rating_avg, rating_count` + computed `distance` | `BrowseContext` catalogue (`BrowseContext.tsx:221-225`), kept where the origin is inside the restaurant's own radius, sorted nearest first (`:442-461`) |
| Nearby dishes (Search) | `id, restaurant_id, name, description, price, is_veg, image_url, rating_avg, rating_count` | `BrowseContext` lazy dish fetch (`:475-504`); RLS returns **available** dishes only |
| Listed offers | `CouponOffer` | `list_offers` via `listOffers(null)` (`:250-261`), per caller |
| The customer's orders | `restaurant_id, status` | `orders`, own rows (`orders_customer_select`) |

### 4.2 What this plan adds

| Object | Field | Meaning | Written by | Read by |
|---|---|---|---|---|
| `orders` (M1) | `preparing_at`, `out_for_delivery_at`, `completed_at` | Server time of each transition | Trigger only | The order's customer and its restaurant's owner (existing RLS) |
| `restaurants` (M2) | `is_pure_veg boolean NOT NULL DEFAULT false` | The kitchen has been verified as pure vegetarian | Ankit (Dashboard) | Everyone |
| `restaurant_stats` (M2, new, one row per restaurant) | `menu_item_count`, `nonveg_item_count` | Available dishes; available non-veg dishes | Trigger on `menu_items` | Everyone, for visible restaurants |
| | `price_min`, `price_median`, `price_max` | Over available dishes | Trigger | Everyone (`price_median` is what the app uses) |
| `restaurants` (M3) | `prep_time_minutes smallint NOT NULL DEFAULT 20` | Ankit's estimate: minutes from order placed until handed to the rider | Ankit | Everyone |
| `restaurant_stats` (M3) | `observed_prep_minutes` | Median "placed → handed to rider", last `prep_lookback_days`; NULL below `prep_min_sample` orders | Nightly job | Everyone |
| | `popularity_score` (0–100) | Percentile of completed orders in the last `popularity_days` | Nightly job | Everyone |
| `menu_item_stats` (M3, new, one row per dish) | `popularity_score` (0–100) | Percentile of units sold in completed orders, last `popularity_days` | Nightly job | Everyone, for visible dishes |
| `browse_config` (M3, new, one row) | `minutes_per_km`, `doorstep_minutes`, `eta_window_minutes`, `prep_min_sample`, `prep_lookback_days`, `popularity_days` | The estimate's and the scores' knobs | Ankit | Everyone |

Never stored where a client can read it: sample sizes, raw order counts, units sold (FS10).

---

## 5. Filter catalogue (final verdicts)

| Brief item | v2 | Backed by |
|---|---|---|
| **A.** Sort: Relevance (default) | ✅ | Today's order (nearest first; dishes by restaurant distance, then name) |
| A. Rating: highest first | ✅ | `rating_avg`, `rating_count` |
| A. Price: low→high / high→low | ✅ | Dishes: `price`. Restaurants: `restaurant_stats.price_median` (FS2). |
| A. Popularity | ✅ | `restaurant_stats.popularity_score` / `menu_item_stats.popularity_score` (FS10) |
| A. Delivery time: fastest first | ✅ (new) | The estimate (§8) |
| **B.** Delivery time: Fast delivery (Under 30 min), Under 45 min | ✅ | The estimate's upper end (FS7) |
| **C.** Rating 3.5+ / 4.0+ / 4.5+ | ✅ | `rating_avg` |
| **D.** Offers by category | ✅ Flat ₹ off · % off · Free delivery | `list_offers` + `bestOfferFor` (FS12) |
| D. Buy 1 Get 1 | ❌ own plan | FS11 |
| **E.** Dish price bands | ✅ | Dishes: `price`. Restaurants: `price_median`. |
| **F.** Pure Veg / Non-Veg | ✅ | Restaurants: `is_pure_veg` / `nonveg_item_count > 0`. Dishes: `is_veg`. |
| **G.** Previously ordered / New to you | ✅ signed in | The customer's completed orders (FS4) |

---

## 6. Where filters apply

`FilterContext = "restaurants" | "dishes"`. Home's list and Search's Restaurants tab are `restaurants`; Search's Dishes tab is `dishes`.

| Category | Home (`restaurants`) | Search → Restaurants | Search → Dishes (`dishes`) |
|---|---|---|---|
| Sort by | Relevance · Delivery time · Rating · Popularity · Price ↑ · Price ↓ | same | Relevance · Rating · Popularity · Price ↑ · Price ↓ (the dish's own) |
| Delivery time | Any · Under 30 min · Under 45 min | same | **Hidden** (`DishRow` shows no estimate) |
| Rating | Restaurant `rating_avg` | same | Dish `rating_avg` (the number on `DishRow`) |
| Offers | Flat ₹ off · % off · Free delivery | same | **Hidden** (`DishRow` shows no offer) |
| Dish price | Restaurant `price_median` band | same | Dish `price` band |
| Veg / non-veg | Any · Pure Veg · Serves non-veg | same | All · Veg · Non-veg (the existing chips' state) |
| Collections | Signed-in: All · Previously ordered · New to you | same | **Hidden** (would read as "dishes I ordered") |

**Search shares one filter state across both tabs.** Each tab applies the categories that exist in its context and ignores the rest. A tab's filter bar shows chips only for categories that apply to it.

**Rule of thumb:** a filter tests something visible on the result. Sorts may use a value that isn't shown (popularity), as on Zomato. The single filter exception is the restaurant price band (FS2), which the panel explains.

---

## 7. Backend design

The SQL below shows the shape of each migration, not the final code. The final migrations follow the house style of 014, 019 and 027–029, with section headers, comments and idempotence where those migrations are idempotent.

### 7.1 M1 — Order progress times (`030_order_progress_times.sql`, ships first)

```sql
ALTER TABLE public.orders
  ADD COLUMN preparing_at        timestamptz,
  ADD COLUMN out_for_delivery_at timestamptz,
  ADD COLUMN completed_at        timestamptz;

-- 014's contract, extended: the database stamps each transition with its own
-- clock, and nothing (no client, no Dashboard edit) can move a stamp later.
CREATE FUNCTION public.stamp_order_progress()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.preparing_at        := OLD.preparing_at;
  NEW.out_for_delivery_at := OLD.out_for_delivery_at;
  NEW.completed_at        := OLD.completed_at;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    CASE NEW.status
      WHEN 'preparing'        THEN NEW.preparing_at        := now();
      WHEN 'out_for_delivery' THEN NEW.out_for_delivery_at := now();
      WHEN 'completed'        THEN NEW.completed_at        := now();
      ELSE NULL;
    END CASE;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER stamp_order_progress
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.stamp_order_progress();
```

- **Trigger order.** BEFORE UPDATE triggers fire alphabetically: `check_status_transition` (validates) → `set_orders_updated_at` → `stamp_order_accept` → `stamp_order_progress`. Status transitions only move forward (003), so each status, and so each stamp, happens once.
- **Grants.** No grant changes. Owners still UPDATE only `status`, `eta_minutes` and `decline_reason` (025). Column privileges apply to the columns an UPDATE names, not to what a trigger sets, so the stamps work exactly as 014's `accepted_at` does.
- **No backfill (FS16).** Old orders keep NULL stamps.
- **Invisible to customers and owners** until something reads it. It's safe to ship ahead of everything else, and it should be: each day live adds history for §8.

### 7.2 M2 — Menu facts and Pure Veg (`031_restaurant_menu_facts.sql`)

```sql
-- 1. Pure Veg: a promise about the kitchen, set by Ankit after checking it.
ALTER TABLE public.restaurants
  ADD COLUMN is_pure_veg boolean NOT NULL DEFAULT false;
GRANT SELECT (is_pure_veg) ON public.restaurants TO anon;
  -- authenticated: the table-level SELECT already covers it; no write grant.

-- 2. Menu facts live beside restaurants, never on them (see §3: updated_at).
CREATE TABLE public.restaurant_stats (
  restaurant_id     uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  menu_item_count   integer NOT NULL DEFAULT 0 CHECK (menu_item_count >= 0),
  nonveg_item_count integer NOT NULL DEFAULT 0 CHECK (nonveg_item_count BETWEEN 0 AND menu_item_count),
  price_min         numeric(10,2),
  price_median      numeric(10,2),
  price_max         numeric(10,2),
  menu_refreshed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (price_min <= price_median AND price_median <= price_max)
);
ALTER TABLE public.restaurant_stats ENABLE ROW LEVEL SECURITY;
-- A stats row is visible exactly when its restaurant is (RLS on restaurants
-- applies inside the subquery, for the caller).
CREATE POLICY restaurant_stats_read ON public.restaurant_stats
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id));
GRANT SELECT ON public.restaurant_stats TO anon, authenticated;
GRANT ALL    ON public.restaurant_stats TO service_role;

-- 3. Recompute from scratch (019 doctrine), over AVAILABLE dishes: what
--    customers can see.
CREATE FUNCTION private.refresh_restaurant_menu_facts(p_restaurant_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.restaurant_stats AS s
    (restaurant_id, menu_item_count, nonveg_item_count,
     price_min, price_median, price_max, menu_refreshed_at)
  SELECT p_restaurant_id,
         count(*), count(*) FILTER (WHERE NOT m.is_veg),
         min(m.price),
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY m.price))::numeric, 2),
         max(m.price), now()
  FROM public.menu_items m
  WHERE m.restaurant_id = p_restaurant_id AND m.is_available
  -- One aggregate row, or none when the restaurant is already gone: a
  -- cascading restaurant delete must not fail on the FK.
  HAVING EXISTS (SELECT 1 FROM public.restaurants WHERE id = p_restaurant_id)
  ON CONFLICT (restaurant_id) DO UPDATE SET
    menu_item_count   = EXCLUDED.menu_item_count,
    nonveg_item_count = EXCLUDED.nonveg_item_count,
    price_min         = EXCLUDED.price_min,
    price_median      = EXCLUDED.price_median,
    price_max         = EXCLUDED.price_max,
    menu_refreshed_at = EXCLUDED.menu_refreshed_at;
$$;
```

An aggregate with no `GROUP BY` always yields one row. So a restaurant whose dishes are all switched off gets counts of 0 and NULL prices, which is correct, and the `HAVING` turns "restaurant deleted" into "insert nothing". The e2e script tests both.

```sql
-- 4. Keep the facts current on every dish write.
CREATE FUNCTION private.on_menu_item_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM private.refresh_restaurant_menu_facts(OLD.restaurant_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id THEN
    PERFORM private.refresh_restaurant_menu_facts(NEW.restaurant_id);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER menu_items_facts
  AFTER INSERT OR DELETE OR UPDATE OF price, is_veg, is_available, restaurant_id
  ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION private.on_menu_item_change();

-- 5. Pure Veg is enforced, not hoped for.
CREATE FUNCTION private.guard_pure_veg_menu()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.is_available AND NOT NEW.is_veg THEN
    -- FOR SHARE: a concurrent "mark Pure Veg" waits for this write.
    PERFORM 1 FROM public.restaurants r
      WHERE r.id = NEW.restaurant_id AND r.is_pure_veg FOR SHARE;
    IF FOUND THEN
      RAISE EXCEPTION 'PURE_VEG_RESTAURANT: This restaurant is listed as Pure Veg, so it can''t offer a non-veg dish.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER menu_items_pure_veg
  BEFORE INSERT OR UPDATE OF is_veg, is_available, restaurant_id
  ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION private.guard_pure_veg_menu();

CREATE FUNCTION private.guard_pure_veg_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.is_pure_veg AND NOT OLD.is_pure_veg AND EXISTS (
       SELECT 1 FROM public.menu_items m
       WHERE m.restaurant_id = NEW.id AND m.is_available AND NOT m.is_veg) THEN
    RAISE EXCEPTION 'PURE_VEG_CONFLICT: Switch off this restaurant''s non-veg dishes before marking it Pure Veg.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER restaurants_pure_veg
  BEFORE UPDATE OF is_pure_veg ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION private.guard_pure_veg_flag();

-- 6. Backfill every restaurant once.
SELECT private.refresh_restaurant_menu_facts(id) FROM public.restaurants;
```

- **The invariant:** *a Pure Veg restaurant never has an available non-veg dish.* Old non-veg dishes that are switched off may remain. They can't be deleted, because `order_items` references them (RESTRICT), and RLS hides them from customers anyway.
- **Error prefixes** follow the `PRICING_MISMATCH:` / `REVIEW_NOT_ELIGIBLE:` convention. The owner menu editor maps `PURE_VEG_RESTAURANT:` to friendly copy (§12.5). Only Ankit sees `PURE_VEG_CONFLICT:`, in the Dashboard.
- **Owners notice nothing** until a restaurant is flagged: every flag starts `false`.
- **No raise is swallowed.** A failing facts refresh fails the dish write, so the facts can never silently drift. The function is a single aggregate, covered by the e2e script.

### 7.3 M3 — Estimate inputs, popularity, nightly refresh (`032_browse_stats.sql`)

```sql
-- 1. The knobs: one row, public read, Ankit writes (discount_config's pattern, 006).
CREATE TABLE public.browse_config (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  minutes_per_km     numeric(4,1) NOT NULL DEFAULT 4.0 CHECK (minutes_per_km > 0 AND minutes_per_km <= 20),
  doorstep_minutes   smallint NOT NULL DEFAULT 5  CHECK (doorstep_minutes BETWEEN 0 AND 30),
  eta_window_minutes smallint NOT NULL DEFAULT 5  CHECK (eta_window_minutes BETWEEN 0 AND 30),
  prep_min_sample    smallint NOT NULL DEFAULT 10 CHECK (prep_min_sample BETWEEN 3 AND 200),
  prep_lookback_days smallint NOT NULL DEFAULT 60 CHECK (prep_lookback_days BETWEEN 7 AND 365),
  popularity_days    smallint NOT NULL DEFAULT 30 CHECK (popularity_days BETWEEN 7 AND 365),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.browse_config DEFAULT VALUES;
ALTER TABLE public.browse_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY browse_config_read ON public.browse_config
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.browse_config TO anon, authenticated;
GRANT ALL    ON public.browse_config TO service_role;
CREATE TRIGGER set_browse_config_updated_at
  BEFORE UPDATE ON public.browse_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Ankit's prep estimate per restaurant: placed → handed to the rider,
--    including the time the owner takes to accept.
ALTER TABLE public.restaurants
  ADD COLUMN prep_time_minutes smallint NOT NULL DEFAULT 20
    CHECK (prep_time_minutes BETWEEN 5 AND 120);
GRANT SELECT (prep_time_minutes) ON public.restaurants TO anon;

-- 3. History-based facts.
ALTER TABLE public.restaurant_stats
  ADD COLUMN observed_prep_minutes smallint CHECK (observed_prep_minutes BETWEEN 1 AND 180),
  ADD COLUMN popularity_score      smallint NOT NULL DEFAULT 0 CHECK (popularity_score BETWEEN 0 AND 100),
  ADD COLUMN stats_refreshed_at    timestamptz;

CREATE TABLE public.menu_item_stats (
  menu_item_id     uuid PRIMARY KEY REFERENCES public.menu_items(id) ON DELETE CASCADE,
  popularity_score smallint NOT NULL DEFAULT 0 CHECK (popularity_score BETWEEN 0 AND 100),
  refreshed_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.menu_item_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_item_stats_read ON public.menu_item_stats
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.menu_items m WHERE m.id = menu_item_id));
GRANT SELECT ON public.menu_item_stats TO anon, authenticated;
GRANT ALL    ON public.menu_item_stats TO service_role;

-- 4. The nightly refresh (runs as the job owner; no client can reach private).
CREATE FUNCTION private.refresh_browse_stats()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$ … $$;

SELECT private.refresh_browse_stats();   -- once, now

-- Schedule, run once in the SQL Editor after db push (03:30 IST):
--   select cron.schedule('browse-stats-nightly', '0 22 * * *',
--                        $$select private.refresh_browse_stats()$$);
```

`private.refresh_browse_stats()` does four things, in one transaction, and only writes rows whose value changes:

1. **Ensures a stats row for every restaurant** (`INSERT … SELECT id FROM restaurants ON CONFLICT DO NOTHING`), so a restaurant with no dishes yet still has one.
2. **Observed prep** per restaurant: the median of `out_for_delivery_at − created_at` in minutes, rounded up. It uses `completed` orders from the last `prep_lookback_days` whose stamps exist and whose span is between 1 minute and 3 hours (outlier guard: a forgotten tap). The value is `NULL` while the restaurant has fewer than `prep_min_sample` such orders.
3. **Restaurant popularity:** completed orders per active restaurant over the last `popularity_days`, then `round(100 × percent_rank())`. Restaurants with no orders score 0.
4. **Dish popularity:** units sold (`SUM(order_items.quantity)`) of completed orders over the last `popularity_days`, per available dish, then `round(100 × percent_rank())`, upserted into `menu_item_stats`.

It finishes by stamping `stats_refreshed_at`. Because it's in-database pg_cron, no Edge Function, secret or `pg_net` is involved. Job runs are visible in `cron.job_run_details` (Appendix A.8).

### 7.4 Grants and RLS summary

| Object | anon | authenticated | service_role | Writers |
|---|---|---|---|---|
| `orders.preparing_at` / `out_for_delivery_at` / `completed_at` | — | SELECT (table grant; RLS: own / own restaurant's) | ALL | Trigger only |
| `restaurants.is_pure_veg`, `prep_time_minutes` | SELECT (column grant) | SELECT (table grant) | ALL | Ankit (Dashboard). **No client UPDATE** (024 keeps owners to `is_open`). |
| `restaurant_stats` | SELECT (rows of visible restaurants) | SELECT (same) | ALL | Triggers and the job |
| `menu_item_stats` | SELECT (rows of visible dishes) | SELECT (same) | ALL | The job |
| `browse_config` | SELECT | SELECT | ALL | Ankit |
| `private.*` functions | no USAGE | no USAGE | — | — |

Nothing in this plan writes to `restaurants` or `menu_items` rows (§3). The two public tables carry no raw volumes (FS10). **Future columns on `restaurant_stats` or `menu_item_stats` are public by construction; review each one against FS10.**

### 7.5 Verify, e2e and rollback scripts

| Script | Checks |
|---|---|
| `ops/030_verify.sql` | The three columns and the trigger exist; owners' column grants on `orders` are still exactly `status, eta_minutes, decline_reason` |
| `ops/030_e2e.sql` (preview branch, never committed) | As an owner: accept → preparing → out for delivery → delivered stamps each time once, in order. A direct write of a stamp is rejected (42501). A later update leaves stamps untouched. The decline / expire / cancel paths stamp nothing. |
| `ops/030_rollback.sql` | Drops the trigger and function. **Keeps the columns** (they hold history) unless run with the explicit drop section. |
| `ops/031_verify.sql` | `is_pure_veg` in the anon column grant; `restaurant_stats` grants and policy; no client INSERT/UPDATE/DELETE anywhere new; functions in `private` with `search_path = ''` and SECURITY DEFINER; every restaurant has a stats row; **stored facts equal a fresh recompute** (drift check) |
| `ops/031_e2e.sql` | Add / edit / switch off / delete dishes and watch the facts; the median with odd and even counts; a cascading restaurant delete succeeds; marking Pure Veg with an available non-veg dish raises `PURE_VEG_CONFLICT`, and after switching that dish off it succeeds; an owner adding a non-veg dish then raises `PURE_VEG_RESTAURANT`; an owner can't write `restaurant_stats` or `is_pure_veg` (42501) |
| `ops/031_rollback.sql` | Drops the triggers, functions, `restaurant_stats` and the column (revoking the grant). **Only after the frontend that reads them is gone** (§20.3). |
| `ops/032_verify.sql` | `browse_config` has one row and its grants; `prep_time_minutes` in the anon grant; `menu_item_stats` grants and policy; the refresh function exists; on production only (preview branches don't run pg_cron), the cron job exists and `stats_refreshed_at` is under 26 h old |
| `ops/032_e2e.sql` | Fixture orders → refresh: observed prep NULL below the sample, the median above it, outliers ignored; popularity percentiles for restaurants and dishes; the CHECKs reject bad knobs; anon can read the config and the stats |
| `ops/032_rollback.sql` | Unschedules the job, drops the function, tables and column (same caution) |

`verify` scripts are a single `UNION ALL` query each (`supabase db query` returns only the last statement's rows, per 023).

### 7.6 Cost

- **Menu-facts refresh:** one aggregate over one restaurant's dishes (tens of rows) per dish write. A bulk menu upload of 60 dishes runs 60 tiny refreshes.
- **Nightly job:** a few aggregate scans over 30–60 days of orders (`idx_orders_restaurant_status` helps), once a day at 03:30 IST.
- **Catalogue fetch:** one embedded one-to-one row per restaurant; no extra request.

---

## 8. The delivery-time estimate

### 8.1 Formula

```
prep  = restaurant_stats.observed_prep_minutes ?? restaurants.prep_time_minutes
ride  = ceil(distance_km × browse_config.minutes_per_km)
low   = round up to a multiple of 5 (prep + ride + browse_config.doorstep_minutes)   -- 27 → 30, 30 → 30
high  = low + browse_config.eta_window_minutes
label = "30–35 min", or "30 min" when the window is 0
```

`distance_km` is the same straight-line distance the card already shows (browse origin → restaurant). Riders travel by road, which is longer, but `minutes_per_km` is calibrated against real ride times over straight-line distances (`orders.delivery_distance_km` is haversine too, Appendix A.8), so the road factor is absorbed.

### 8.2 Worked examples (starting knobs: prep 20, 4 min/km, doorstep 5, window 5)

| Distance | Prep | Ride | Sum | Label | Under 30? | Under 45? |
|---|---|---|---|---|---|---|
| 0.4 km | 20 | 2 | 27 | 30–35 min | no | yes |
| 1.2 km | 20 | 5 | 30 | 30–35 min | no | yes |
| 2.0 km | 20 | 8 | 33 | 35–40 min | no | yes |
| 3.5 km | 20 | 14 | 39 | 40–45 min | no | yes |
| 1.0 km, observed prep 12 | 12 | 4 | 21 | 25–30 min | **yes** | yes |

"Under 30 min" is earned by fast, measured kitchens close by. Appendix A.8 shows how many qualify with the chosen knobs, and Ankit can tune the knobs without a deploy.

### 8.3 Honesty notes

- It's an **estimate before ordering**. The commitment is still the owner's promise at accept time (014), shown on the order page with its own window (`src/lib/eta.ts`). The two are separate on purpose.
- Prep is measured once there's enough history. Until then it is Ankit's figure (A.7 helps him set it). The card looks the same either way.
- Not modelled: rush hours, rider availability, rain. These are candidates for v2 (§21).
- With no `browse_config` loaded, no estimate is shown anywhere, and the delivery-time sort and filter are hidden (Principle 1). Every restaurant has a `prep_time_minutes` (NOT NULL), so with the config loaded, every restaurant has an estimate.

---

## 9. Filter model

### 9.1 State

```ts
// src/lib/browseFilters.ts
export type BrowseSort =
  | "relevance" | "delivery_time" | "rating" | "popularity" | "price_asc" | "price_desc";
export type TimeLimit = 30 | 45;
export type RatingFloor = 3.5 | 4 | 4.5;
export type OfferType = "flat" | "percent" | "free_delivery";
export type PriceBand = "under_200" | "200_350" | "over_350";
export type VegChoice = "any" | "pure_veg" | "nonveg";   // restaurant lists
export type FoodType = "all" | "veg" | "nonveg";          // dish lists (= searchResults' VegFilter)
export type Collection = "all" | "ordered" | "new";       // restaurant lists, signed in
export type FilterContext = "restaurants" | "dishes";

export interface BrowseFilters {
  sort: BrowseSort;
  maxMinutes: TimeLimit | null;
  minRating: RatingFloor | null;
  offerTypes: OfferType[];   // canonical order, no duplicates; [] = any (no filter)
  priceBands: PriceBand[];   // canonical order, no duplicates; [] = any
  vegChoice: VegChoice;
  foodType: FoodType;
  collection: Collection;
}

export const DEFAULT_BROWSE_FILTERS: BrowseFilters = {
  sort: "relevance", maxMinutes: null, minRating: null, offerTypes: [],
  priceBands: [], vegChoice: "any", foodType: "all", collection: "all",
};
```

### 9.2 Combination

- **Across categories: AND.** **Within** Offers and Dish price: **OR**.
- **Single choice** (radio groups with an explicit default option): Sort, Delivery time ("Any time"), Rating ("Any rating"), Veg / non-veg ("Any" / "All"), Collections ("All restaurants").

### 9.3 URL encoding

Filter params share the page's query string. `q`, `c` and any other key are preserved.

| Field | Param | Values (absent = default) |
|---|---|---|
| `sort` | `sort` | `delivery_time`, `rating`, `popularity`, `price_asc`, `price_desc` |
| `maxMinutes` | `time` | `30`, `45` |
| `minRating` | `rating` | `3.5`, `4`, `4.5` |
| `offerTypes` | `offers` | comma list of `flat`, `percent`, `free_delivery` |
| `priceBands` | `price` | comma list of `under_200`, `200_350`, `over_350` |
| `vegChoice` | `veg` | `pure_veg`, `nonveg` |
| `foodType` | `food` | `veg`, `nonveg` |
| `collection` | `coll` | `ordered`, `new` |

- **Lenient parsing.** Unknown or malformed values fall back to the default and never throw.
- **Canonical writing.** Default fields are omitted and lists are written in a fixed order, so one state always produces one URL.
- **`coll` is inert when signed out.** It's ignored, shows no chip, and the next write drops it.
- **`food` keeps today's behaviour.** Search's veg filter moves from `useState` into the URL. It still persists across queries and tab switches, and now also survives back and refresh.

---

## 10. Filtering and sorting rules

### 10.1 Relevance (default)

Today's order: restaurants nearest first (`BrowseContext.tsx:459`); dishes by restaurant distance, then name (`searchResults.ts:77`). With the defaults, `refineRestaurants()` / `refineDishes()` **return the input array itself**.

### 10.2 Delivery time (restaurants)

- `deliveryEstimate(r, distanceKm, config) → { low, high } | null` (§8; `null` without config).
- **Filter `time = t`:** keep where `high ≤ t`.
- **Sort `delivery_time`:** `low` ascending, then `high` ascending, then the tail (§10.9).

### 10.3 Rating

- **Rated:** `rating_count > 0 && Number.isFinite(Number(rating_avg))` (the `hasRatings` test in `ratings.ts`).
- **Filter:** keep rated items where `Math.round(Number(rating_avg) * 10) >= t * 10` (an integer compare). Unrated items are excluded.
- **Sort:** rated first, then `rating_avg` descending, then `rating_count` descending, then the tail.

### 10.4 Popularity

- **Restaurants:** `restaurant_stats.popularity_score` descending (a missing row counts as 0), then rating as in 10.3, then the tail.
- **Dishes:** `menu_item_stats.popularity_score` descending (missing = 0), then the tail.

### 10.5 Price

- **Dishes:** `Number(price)`, compared in paise.
- **Restaurants:** `restaurant_stats.price_median`. A restaurant with no stats row or no available dishes has **no price**.
- **Sorts:** priced items ascending or descending; **items with no price last in both directions**; then the tail.
- **Bands:** `under_200` = `< 200`; `200_350` = `200 ≤ p ≤ 350`; `over_350` = `> 350`, all in paise. ₹200 and ₹350 exactly fall in the middle band. An unpriced restaurant is excluded while any band is selected.

### 10.6 Offers (restaurants)

`bestOfferFor` gains an optional `types` argument: `bestOfferFor(offers, r.id, now, types)` considers only offers of those types. A restaurant passes when it returns non-null, **and the card receives that same offer**, so the offer line always explains the match. The pass condition is unchanged from today's card logic: a public coupon, status `ok`, open now and valid here. Results are per viewer, because `list_offers` is. Platform-wide rules (the festival discount, the free-delivery rule) don't distinguish restaurants and aren't part of this filter.

### 10.7 Veg / non-veg

- **Restaurants:** `pure_veg` keeps `is_pure_veg === true`; `nonveg` keeps `restaurant_stats.nonveg_item_count > 0`. A missing stats row counts as unknown and is excluded.
- **Dishes:** `veg` keeps `is_veg === true`; `nonveg` keeps `is_veg === false` (today's `searchResults` logic, unchanged).

### 10.8 Collections (signed-in, restaurants)

`orderedIds` is the set of distinct `restaurant_id`s of this account's `completed` orders. `ordered` keeps ids in the set and `new` keeps the rest. While the set is loading, the list shows its loading state. If loading fails, it shows the error state (§13.5), never "everything passes".

### 10.9 Deterministic tail

Every non-Relevance sort ends with the same tie-break chain, because the catalogue query has no `ORDER BY` and exact ties would otherwise come out in database order:

- **Restaurants:** distance ascending → `name.localeCompare` → `id`.
- **Dishes:** restaurant distance ascending → dish `name.localeCompare` → dish `id`.

### 10.10 Missing data

| Missing | Rule |
|---|---|
| No `browse_config` (loading) | Delivery-time options and sort hidden in the panel. A `time=` / `sort=delivery_time` URL shows the loading state, then results. |
| `browse_config` failed | Same options hidden; such a URL shows the error state (§13.5) |
| No `restaurant_stats` row | No price, non-veg unknown, popularity 0, prep falls back to `prep_time_minutes` |
| Unrated | Excluded by rating filters; last in the rating sort |
| Offers failed to load | No restaurant has an offer (as the cards show) |
| Dish fetch failed (Search) | Error state on the Dishes tab; the Restaurants tab is unaffected (restaurant facts come with the catalogue) |
| Order history failed | Error state while a collection is applied |

### 10.11 Counts

All counts are exact: each screen holds the whole in-radius set, and dishes are paginated (FS14).

- **Home header:** "*N* of *M* restaurants near you" while any filter (not sort) is active; otherwise unchanged.
- **Search tabs:** "Dishes · N" and "Restaurants · N" show filtered counts. The default-tab choice still uses the unfiltered candidates (`SearchPage.tsx:212-215`).
- **Panel footer:** the count for the pending selection.

---

## 11. Client data flow

### 11.1 One source of truth

```
URL ──parseBrowseFilters──▶ applied filters
                                 │
useBrowse(): nearby (+ stats, Pure Veg, prep), offers, browseConfig, dishes (+ popularity)
useOrderedRestaurantIds() ───────┤
                                 ▼
   refineRestaurants / refineDishes (pure, memoised) ──▶ list · counts · chips · card offer/estimate
FilterSheet: pending ── Show results ──▶ writeBrowseFilters ──▶ setParams(…, { replace: true })
```

### 11.2 Query changes (frontend, after the migrations are live)

| Query | Change |
|---|---|
| Catalogue (`BrowseContext.tsx:221-225`) | `+ is_pure_veg, prep_time_minutes, restaurant_stats(nonveg_item_count, price_median, observed_prep_minutes, popularity_score)`. A one-to-one embed (PK = FK): PostgREST returns an object or `null`. Verify the shape on the preview branch. |
| `browse_config` | **New, tiny:** one row, fetched with the catalogue and on the same staleness rule; exposed as `browseConfig` and through a non-activating `useBrowseConfig()` (like `useBrowseOrigin()`) so cards can read it |
| Dishes (`:484-489`) | `+ menu_item_stats(popularity_score)`; **paginated** with `.order("id").range(from, from + 999)` until a short page (FS14); `ensureDishes()` retries after an error |
| Restaurant page (`RestaurantMenu.tsx:140-145`) | `+ is_pure_veg, prep_time_minutes, restaurant_stats(observed_prep_minutes)` for its estimate and Pure Veg mark |
| Collections | `orders.select("restaurant_id").eq("customer_id", userId).eq("status", "completed")`: the first time Collections is opened or applied, signed-in only. A per-user session cache with a shared in-flight promise, re-read after 2 min (the `getCategoriesCached()` pattern). The explicit `eq` matters because admins' `FOR ALL` policy would otherwise return every order. |

**Home no longer needs any dish fetch.** Every restaurant filter is answered by the catalogue row.

### 11.3 No requests per tap

Toggling options changes only the panel's pending state. Counts are memoised pure computations. **Show results** writes the URL. The only requests this feature can cause are the config row (with the catalogue), the dish pages (Search, as today) and the order-history read (once per user per 2 min).

---

## 12. UI design

### 12.1 Filter bar

A horizontally scrolling row (`.fbar`): the **Filters** chip, then one removable chip per active choice that applies to the current context.

```
Home:            8 of 12 restaurants near you
                 [⚙ Filters 2] [Under 30 min ✕] [Pure Veg ✕] →

Search, Dishes:  [ Dishes · 14 ][ Restaurants · 5 ]
                 [⚙ Filters 1] [All] [Veg] [Non-veg] [Popularity ✕] →
```

- **Filters chip:** `Chip` with a `SlidersHorizontal` icon; `count` = active choices; `selected` when any are active. `aria-haspopup="dialog"`, `aria-expanded`, accessible name "Filters, 2 applied". It opens on **Sort by**.
- **Applied chips:** `Chip` with a trailing `X` and `aria-pressed={undefined}` (the recent-searches precedent, `SearchPage.tsx:261-266`). The accessible name is "Remove Under 30 min". **Removing applies immediately.** Tapping the label opens the panel on that category.
- **Hidden** when its list isn't shown: Home's loading, location and empty states; Search before a query; Search's "No results for …".

### 12.2 The panel

`FilterSheet` on `Sheet` (FS15): a bottom sheet on phones, a centred card from 768 px (640 px wide). The height is fixed (`min(88dvh, 640px)` on phones, `560px` on the card), and each pane scrolls on its own.

```
┌──────────────────────────────────────────┐
│                  ────                     │
│ Filters and sorting            Clear all │
├──────────────┬───────────────────────────┤
│▌Sort by      │ Delivery time             │
│ Delivery   • │ ○ Any time                │
│   time       │ ◉ Under 30 min            │
│ Rating       │ ○ Under 45 min            │
│ Offers       │                           │
│ Dish price   │ Estimated from each       │
│ Veg / non-veg│ kitchen's recent orders   │
│ Collections  │ and your distance.        │
├──────────────┴───────────────────────────┤
│ 4 restaurants match                      │
│ [    Close    ]  [   Show results    ]   │
└──────────────────────────────────────────┘
```

- **Header:** "Filters and sorting" with "Clear all" (a brand text button). No X: the footer has Close.
- **Left column, categories:** only those available in the context (§6) and, for Delivery time, only with a loaded config. The selected tab has the surface background, a 3 px brand bar on the left and a bold label. The others sit on `--rl-color-bg-sunken`. A brand dot marks a category whose pending value isn't its default.
- **Right column, options:** the category heading, then full-width rows at least 48 px tall with a **native** radio or checkbox on the left (the `AddressSection` pattern, `accent-color: var(--rl-color-brand-primary)`). A checked row's label is semibold. A hint line in secondary text sits under the options.
- **Footer:** the pending count line (an `aria-live` region), then **Close** (`secondary`) and **Show results** (`primary`), half width each.

### 12.3 Options

| Category | Control | Restaurants | Dishes | Hint |
|---|---|---|---|---|
| Sort by | radio | Relevance (default) · Delivery time: fastest first · Rating: highest first · Popularity · Price: low to high · Price: high to low | Relevance · Rating · Popularity · Price ↑ · Price ↓ | Restaurants: "Price uses the typical price of each restaurant's dishes." |
| Delivery time | radio | Any time · Under 30 min · Under 45 min | — | "Estimated from each kitchen's recent orders and your distance." |
| Rating | radio | Any rating · Rated 3.5+ · Rated 4.0+ · Rated 4.5+ | same | "Restaurants without ratings are hidden." / "Dishes without ratings are hidden." |
| Offers | checkbox | Flat ₹ off · % off · Free delivery | — | "Coupons you can use right now." |
| Dish price | checkbox | Under ₹200 · ₹200–₹350 · Above ₹350 | same | Restaurants: "Matched on the typical price of each restaurant's dishes." |
| Veg / non-veg | radio | Any · Pure Veg · Serves non-veg | All · Veg · Non-veg (with `VegMark`) | Restaurants: "Pure Veg kitchens are verified by RedLotus." |
| Collections | radio | All restaurants · Previously ordered · New to you | — | "Based on your delivered orders." |

### 12.4 Cards and the restaurant page (FS8)

- **`RestaurantCard`:**
  - The distance pill (feed / rail) becomes "📍 1.2 km · 30–35 min" (a `Clock` icon and the estimate). The result variant's meta line is the same text.
  - **Pure Veg:** a `VegMark` and the text "Pure Veg" after the cuisine line, so it has an accessible name and isn't colour-only.
  - The estimate is computed in the card from `useBrowseConfig()` + the restaurant + `distanceKm`, so the Featured and Top rated rails show it too without prop threading.
  - With no config: distance only, as today.
- **Restaurant page info card:** the estimate beside rating and distance, and the Pure Veg mark.
- No other card change. In particular, the slideshow and image rules are untouched (no transforms).

### 12.5 Owner menu editor (Pure Veg restaurants)

- `MenuManager` reads its restaurant's `is_pure_veg` (owners can read their row).
- In `MenuItemEditor`, the **Non-veg** choice is disabled, with "Your restaurant is listed as Pure Veg."
- `menuApi` maps `PURE_VEG_RESTAURANT:` to the same sentence for the availability toggle and saves. This is the backstop if an edit races the flag.
- This must ship **before** Ankit flags any restaurant (§19).

### 12.6 Copy

| Where | Text |
|---|---|
| Panel | Filters and sorting · Clear all · Close · Show results |
| Count line | "8 restaurants match" · "1 restaurant matches" · "12 dishes match" · "Nothing matches — remove a filter" · "Loading delivery times…" · "Loading your orders…" |
| Chips | Delivery time: fastest first · Rating: highest first · Popularity · Price: low to high · Price: high to low · Under 30 min · Under 45 min · Rated 3.5+ / 4.0+ / 4.5+ · Flat ₹ off · % off · Free delivery · Under ₹200 · ₹200–₹350 · Above ₹350 · Pure Veg · Serves non-veg · Previously ordered · New to you |
| Filtered empty | "No restaurants match these filters" / "No dishes match these filters" · "Try removing a filter." · **Clear filters** |
| Errors | "Couldn't load delivery times" · "Couldn't load dishes" · "Couldn't load your past orders" · **Try again** · **Remove this filter** |
| Estimate | "30–35 min" (cards, page) |
| Owner editor | "Your restaurant is listed as Pure Veg." |

Sentence case, short, no exclamation marks: the redesign's voice (§4.1, principle 8).

### 12.7 Styling

`FilterSheet.css` (`fsheet__`) and `FilterBar.css` (`fbar__`) beside their components, on `--rl-*` tokens only. The pane layout overrides the Sheet body inside `.fsheet`. If that proves brittle, add a `bodyClassName` prop to `Sheet`. The left column is `flex: 0 0 36%` with a `max-width` of 200 px. Reduced motion is handled globally (`base.css`).

---

## 13. Interaction behaviour

### 13.1 Opening

`pending` starts as a copy of the applied state. Focus goes to the selected category tab (`initialFocusRef`). The panel opens on Sort by, or on the tapped chip's category. If the pending state needs data that isn't loaded (order history), the panel asks for it, and the count line says so until it arrives.

### 13.2 The actions

| Action | Pending | Applied (URL) | Panel |
|---|---|---|---|
| Toggle an option | Updated | Unchanged | Open; count updates |
| **Clear all** | Reset to defaults | Unchanged | Open. Disabled while already at defaults. |
| **Close** / ESC / backdrop / Android back | Discarded | Unchanged | Closes; focus back to the Filters chip |
| **Show results** | — | `writeBrowseFilters(params, pending)`, `replace: true`, other keys kept | Closes; focus back to the Filters chip |

**Clear all** then **Show results** clears every filter and the sort. **Clear all** then **Close** changes nothing. **Show results** with no change just closes. It is **disabled only when the pending count is known to be 0** (FS13).

### 13.3 After applying

`ScrollManager` keeps the position on a same-path `REPLACE`. If the list header has scrolled above the viewport, it's brought back into view (instant under reduced motion). A visually hidden `aria-live="polite"` region announces "Showing 4 restaurants". Back from a menu restores the URL and the scroll position. Tapping the Home or Search tab opens with no filters (FS5).

### 13.4 Search specifics

- `writeQuery` (`SearchPage.tsx:151-155`) and `clearCategory` (`:177`) start from the applied filter params instead of an empty `URLSearchParams`, so a new query or a recent search **keeps the filters**. The debounce effect (`:108-122`) already copies `params`.
- A category opened from Home (`/search?c=…`) starts with no filters.
- "No results for '…'" (nothing matches before filters) takes precedence over the filtered-empty state.

### 13.5 Loading, empty and error states

| State | Home | Search tab | Panel footer |
|---|---|---|---|
| Browse loading / location / fetch error | Unchanged (`BrowseStatusView`); filter bar hidden | Unchanged | — |
| Config loading, delivery-time filter or sort applied | Three `RestaurantCardSkeleton`s under the bar | Card skeletons (Restaurants tab) | "Loading delivery times…" |
| Order history loading, collection applied | Card skeletons | Card skeletons | "Loading your orders…" |
| Nothing matches | `EmptyState` "No restaurants match these filters" + **Clear filters** | Same per tab | "Nothing matches — remove a filter"; Show results disabled |
| Config failed, delivery-time filter or sort applied | `EmptyState` (error) "Couldn't load delivery times" + **Try again** · **Remove this filter** | Same (Restaurants tab) | Delivery-time options hidden |
| Dishes failed (Search) | — | Today's "Couldn't load dishes" notice gains **Try again** (FS14) | — |
| Order history failed, collection applied | `EmptyState` (error) "Couldn't load your past orders" + **Try again** · **Remove this filter** | Same (Restaurants tab) | "Couldn't load your orders" |

No state shows a list that ignores an applied filter.

---

## 14. Accessibility

- **Dialog:** `Sheet` gives `role="dialog"`, `aria-modal`, `aria-labelledby`, the focus trap and restore, ESC and Android back (`useOverlay`).
- **Categories:** a `role="tablist"` with `aria-orientation="vertical"` and `aria-label="Filter categories"`. Tabs have `role="tab"`, `aria-selected` and `aria-controls`. Focus is roving: ↑/↓ move and select, Home/End jump, Tab enters the panel. Each tab's name includes its state ("Rating, 1 selected").
- **Options:** each `role="tabpanel"` holds a `fieldset` with a `legend` and **native** radios or checkboxes in `<label>`s. Hints are attached with `aria-describedby`.
- **Focus:** the global `:focus-visible` ring (`base.css`) everywhere; custom row styles must not suppress it.
- **Live regions:** the footer count and the post-apply announcement.
- **Targets:** rows at least 48 px tall; chips 36 px with a 44 px hit area (`--rl-size-touch-min`). Colour is never the only signal: the Pure Veg mark has text, and the category dot is paired with "selected" in the tab's name.
- **"Show results" disabled:** a real `disabled` attribute, with the reason in the count line just above it.
- **Estimates:** plain text ("30 to 35 minutes" via `aria-label` on the pill) so screen readers don't read "30–35 min" as a subtraction.

---

## 15. Files

### 15.1 Backend (new)

| File | Content |
|---|---|
| `supabase/migrations/030_order_progress_times.sql` | M1 (§7.1) |
| `supabase/migrations/031_restaurant_menu_facts.sql` | M2 (§7.2) |
| `supabase/migrations/032_browse_stats.sql` | M3 (§7.3), the cron snippet in its header |
| `supabase/ops/030–032_{verify,e2e,rollback}.sql` | §7.5 |

Numbers are the next free ones at write time (see the header).

### 15.2 Frontend (new)

| File | Responsibility |
|---|---|
| `src/lib/browseFilters.ts` (+ test) | The model (§9): types, defaults, `parseBrowseFilters`, `writeBrowseFilters`, `isDefaultFilters`, `activeFilterCount`, `appliedChips`, `categoriesFor(context, { signedIn, hasConfig })`, labels |
| `src/lib/browseFilterResults.ts` (+ test) | The rules (§10): `refineRestaurants(entries, filters, { offers, now, config, orderedIds })`, `refineDishes(results, filters)`. Pure; never mutates. |
| `src/lib/deliveryEstimate.ts` (+ test) | `deliveryEstimate(restaurant, distanceKm, config)`, `formatDeliveryEstimate` (§8) |
| `src/lib/orderedRestaurants.ts` | The completed-orders read with its per-user session cache |
| `src/components/browse/useBrowseFilters.ts` | URL ↔ filters (`replace: true`, other params kept) |
| `src/components/browse/useOrderedRestaurantIds.ts` | `{ ids, status, retry }`; idle when signed out or not needed |
| `src/components/browse/FilterBar.tsx` + `.css` (+ test) | §12.1 |
| `src/components/browse/FilterSheet.tsx` + `.css` (+ test) | §12.2–§13.2; lazy-loaded |

```ts
export interface FilterSheetProps {
  context: FilterContext;
  applied: BrowseFilters;
  signedIn: boolean;
  hasConfig: boolean;                      // delivery-time options shown
  initialCategory?: FilterCategoryId;
  countFor: (pending: BrowseFilters) => number | null; // null = data loading
  onNeedData: (pending: BrowseFilters) => void;        // e.g. order history
  noun: { one: string; other: string };
  onApply: (next: BrowseFilters) => void;
  onClose: () => void;
}

export interface FilterBarProps {
  context: FilterContext;
  filters: BrowseFilters;
  signedIn: boolean;
  onOpen: (category?: FilterCategoryId) => void;
  onChange: (next: BrowseFilters) => void; // chip removal applies immediately
  children?: ReactNode;                    // Search Dishes: the existing veg chips
}
```

### 15.3 Frontend (changed)

| File | Change |
|---|---|
| `src/context/BrowseContext.tsx` | Catalogue columns + embed; `browse_config` fetch + `useBrowseConfig()`; dish embed + pagination + retry (§11.2). The location engine is untouched. |
| `src/types/models.ts`, `src/types/database.ts` | New fields; `database.ts` regenerated with `npx supabase gen types typescript --linked` from Git Bash into a temp file (PowerShell's `>` writes UTF-16) |
| `src/lib/coupons.ts` (+ test) | Optional `types` argument on `bestOfferFor` |
| `src/components/ui/Sheet.tsx` | `headerAction`, `showCloseButton` (FS15) |
| `src/components/restaurant/RestaurantCard.tsx` (+ `.css`) | Estimate + Pure Veg (§12.4) |
| `src/pages/restaurants/RestaurantMenu.tsx` (+ `.css`) | Select + estimate + Pure Veg in the info card |
| `src/pages/discovery/DiscoveryPage.tsx` (+ `.css`) | Filter bar, refined list, "N of M", states; lazy `FilterSheet`. Rails unchanged. |
| `src/pages/search/SearchPage.tsx` (+ `.css`) | Veg into the URL; `writeQuery` / `clearCategory` keep filters; bars and panel on both tabs; filtered counts; filtered-empty state. `searchResults()` is called exactly as today. |
| `src/pages/dashboard/menu/MenuManager.tsx`, `MenuItemEditor.tsx`, `menuApi.ts` | Pure Veg guard UI and error mapping (§12.5) |

**Not changed:** `searchResults.ts`, `search.ts`, `categoryMatch.ts`, `topRated.ts`, `browseOrigin.ts`, `DishRow`, `BrowseStatusView`, the cart, checkout, pricing, `place_order`, coupons' server side and every Edge Function.

---

## 16. Invariants

1. With no filters, Home and Search are **identical** to today: same members, same order.
2. The browse engine (origin, location states, staleness rules) is untouched.
3. **No trigger or job updates a `restaurants` or `menu_items` row**, so the owner's "Last changed" label keeps meaning "open/close changed".
4. No client role can write any field this plan adds. Order stamps can't be moved by anyone.
5. A Pure Veg restaurant never shows an available non-veg dish.
6. Nothing volume-revealing is readable by clients (FS10).
7. The catalogue select only names columns the anon grant covers. **The frontend ships after the migrations.**
8. Search's `?q=`, `?c=`, recent searches, default tab, category notice and add to cart (including the replace-cart dialog) work as today.
9. Menus, cart, checkout, coupons, pricing, order placement, the owner dashboard's order flow and the order-page ETA are unchanged.
10. Featured and Top rated rails ignore filters. Owners are still redirected from both screens. Android back closes the panel first.
11. No filter result contains an item whose data can't prove it passes.

---

## 17. Performance and bundle

- **Data sizes:** tens of restaurants and up to a few hundred dishes per browse origin. Filtering and sorting take microseconds.
- **Memoisation:** the refined list depends on `[nearby, offers, browseConfig, orderedIds, filters]`; the pending count on `[pending, …]`. Pages re-render only on apply, chip removal or new browse data.
- **Requests:** none per tap (§11.3). Home gets *lighter*: restaurant price no longer needs dishes.
- **Bundle:** `FilterBar`, `deliveryEstimate` and the pure modules load eagerly (a few kB). **`FilterSheet` is lazy** (`React.lazy`, preloaded on the Filters chip's `pointerdown` / `focus`), shared by Home and Search. Measure the `index` chunk before and after (target: under 2 kB gzip growth) and record it in the PR.
- **Database:** see §7.6.

---

## 18. Testing and verification

### 18.1 Unit (Vitest, pure)

- **`deliveryEstimate`:** each §8.2 example; rounding at exact multiples of 5; window 0; observed vs configured prep; null config → null.
- **`browseFilters`:** URL round trips for every field; defaults omitted; canonical list order; junk values → defaults; `q` / `c` / foreign keys preserved; `coll` inert signed out; categories per context, sign-in state and config presence; `activeFilterCount` / `appliedChips`.
- **`browseFilterResults`:**
  - **Identity** at defaults (`toBe`).
  - **Every sort changes the order** on a purpose-built fixture (restaurants and dishes).
  - Delivery-time filter on the upper end, including boundaries.
  - Rating boundaries (3.4/3.5, 3.9/4.0, 4.4/4.5, `4.0000001`).
  - Popularity with missing stats rows.
  - Price: unpriced last in both directions; ₹200 / ₹350 exact; OR across bands.
  - Offers by type (and the card gets the matching offer).
  - Pure Veg / Serves non-veg with missing stats.
  - Collections partition; not-ready states.
  - AND across categories.
  - **Determinism** (shuffled input → identical output, for every sort) and **immutability**.
- **`bestOfferFor`:** the new `types` argument, including the existing cases unchanged.

### 18.2 Render (`@testing-library/react` + `user-event`)

- **`FilterSheet`:**
  - Initial pending state and focus.
  - Arrow-key tabs.
  - Only the context's categories; Delivery time only with config.
  - Close / ESC / backdrop never call `onApply`.
  - Clear all resets pending and is disabled at defaults.
  - Show results calls `onApply` once and is disabled exactly at count 0.
  - A `null` count shows the loading copy with the button enabled.
- **`FilterBar`:** the count and its name; chip removal resets the field; out-of-context chips hidden.
- **`RestaurantCard`:** the estimate with config, none without; the Pure Veg mark with its text.
- **`MenuItemEditor`:** Non-veg disabled for a Pure Veg restaurant.

### 18.3 Database (preview branch)

`030–032_e2e.sql` as in §7.5, then the `verify` scripts on the branch, then on production right after `db push`.

### 18.4 Manual QA (`npm run dev` against the migrated preview branch, then production after release)

| # | Scenario | Expected |
|---|---|---|
| 1 | Home, no filters | List, order and header as before; cards now show the estimate and Pure Veg marks; no dish request |
| 2 | Each sort | The order visibly changes where the data differs; missing values last |
| 3 | Under 30 / Under 45 | Only cards whose estimate's upper end fits |
| 4 | Rated 4.0+ | Only cards whose pill shows ≥ 4.0 |
| 5 | Offers: Free delivery | Only cards whose offer line is a free-delivery coupon |
| 6 | Pure Veg / Serves non-veg | Only marked kitchens / kitchens with an available non-veg dish (spot-check menus) |
| 7 | Under ₹200 | Restaurants whose typical price is under ₹200 (cross-check Appendix A.2) |
| 8 | Combine 3+ categories | AND semantics; panel count = list count |
| 9 | Clear all → Close / Clear all → Show results | Nothing changes / everything resets; the URL loses only filter keys |
| 10 | Change options → Close / ESC / backdrop / Android back | Applied state unchanged |
| 11 | A selection matching nothing | "Nothing matches — remove a filter"; Show results disabled; enabled again after a change |
| 12 | Filter → menu → back; refresh | Same filters and scroll / same results |
| 13 | Search: query + filters, new query, recent search | Filters kept; tab counts filtered |
| 14 | Search Dishes: veg chips ↔ panel | One shared state; results as before for each value |
| 15 | Category from Home | No filters; category notice works as before |
| 16 | Signed out / signed in Collections | Hidden / a partition with one `orders` request |
| 17 | Change location with filters applied | Re-derived list; filters kept; estimates change with distance |
| 18 | Owner: Pure Veg restaurant tries a non-veg dish | Non-veg disabled; the toggle error is the friendly sentence |
| 19 | Owner: progress an order through every step | Dashboard behaves as before; stamps set (SQL check) |
| 20 | Keyboard only; TalkBack / VoiceOver | Full use without a mouse; state and counts announced |
| 21 | 360 / 768 / 1024 px+ | Sheet / card; no horizontal page scroll; panes scroll independently |
| 22 | Regression: add to cart from Search, the replace-cart dialog, checkout up to the confirm modal (don't place) | Unchanged |

### 18.5 Gates

`npm test` (from 463 tests up), `npm run lint`, `npm run build` (runs `tsc -b`), the bundle comparison, the three `verify` scripts green on the preview branch and on production, and one device pass on the Capgo `staging` channel.

---

## 19. Implementation phases

| Phase | Work | Done when |
|---|---|---|
| 0 | Ankit answers FS1–FS16 and runs Appendix A.1–A.7 | Decisions recorded here |
| 1 | **M1** + its scripts → preview e2e → **Ankit runs `db push`** (production) | `030_verify` green; stamps appear on new orders |
| 2 | **M2** + scripts; owner menu editor Pure Veg handling (§12.5) | `031_e2e` green; editor tests green |
| 3 | **M3** + scripts; cron created in the SQL Editor (production) | `032_e2e` green; job ran once |
| 4 | Pure modules (`browseFilters`, `browseFilterResults`, `deliveryEstimate`, `bestOfferFor` types) + unit tests | §18.1 green |
| 5 | `Sheet` props, `FilterSheet`, `FilterBar`, hooks + render tests | §18.2 green |
| 6 | `BrowseContext` queries, types, cards and the restaurant page (estimate, Pure Veg) | QA 1, 17 |
| 7 | Home integration | QA 2–12, 16, 20–21 |
| 8 | Search integration | QA 13–15, 22 |
| 9 | Ankit's data setup: prep times, Pure Veg flags, knobs (Appendix C) | A.8 looks sane |
| 10 | Docs (§22), PR for Ankit's review | Review |

M2 and M3 can be pushed together once Phase 2's editor change is merged. They must be live before the Phase 6 frontend reaches production.

---

## 20. Rollout and rollback

### 20.1 Order of operations

1. Branch `feat/filters-and-sorting`. **Ask Ankit before opening the PR or pushing.**
2. The PR's Supabase preview branch applies the migrations and `seed.sql`. Run the e2e and verify scripts there. Run the frontend against the branch.
3. **M1 to production early** (Ankit runs `db push`, outside 12–2 PM and 7–9:30 PM IST), then `030_verify`.
4. **M2 + M3 to production** (Ankit runs `db push`), then `031_verify` / `032_verify`; create the cron job (Appendix C.4).
5. Ankit sets prep times, verifies and flags Pure Veg kitchens, and confirms the knobs (Appendix C).
6. **Merge the frontend** (Vercel), then bump `package.json`'s version so the CI `ota` lane ships it by Capgo. No native build: this is inside the OTA safe harbour (`capacitor_native_apps_plan.md` §5.4).

### 20.2 Compatibility

- **Old app bundles keep working against the new database:** the new columns, tables and triggers are additive.
- **A new bundle against the old database would break Home** (a column it selects is missing), which is why the database goes first.

### 20.3 Rollback

- **Frontend first:** revert the merge and ship the next OTA. Phones pick it up at their next launch; until then, they still need the new columns.
- **Database rollback only in an emergency, and only after the frontend revert has propagated.**
  - `030_rollback` keeps the stamp columns by default.
  - `031` / `032` rollbacks drop the objects.
  - Stopping the job alone (`cron.unschedule('browse-stats-nightly')`) leaves the last scores in place, which is safe.

---

## 21. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Owners tap "Out for delivery" late or early | Observed prep skews | The median and the outlier guard; A.8 compares observed with configured; Ankit coaches partners. RedLotus's own riders make the handover visible. |
| Cold start | Estimates rest on Ankit's figures | A.7 seeds them from history; M1 ships first |
| The menu trigger has a bug | Owner dish edits fail | One simple aggregate; `031_e2e`; the drift check in `031_verify` |
| The nightly job fails | Stale scores and observed prep (still valid values) | `cron.job_run_details` and `stats_refreshed_at` in `032_verify` / A.8 |
| A Pure Veg flag mistake | A false promise | Only Ankit sets it, after a kitchen check; the database blocks a conflicting menu |
| Popularity reveals ranking | Competitors can infer relative standing | Percentile only, no counts (FS10); the sort reveals order anyway |
| The embed shape differs from expectations | Client parses `null` / arrays wrongly | Verify on the preview branch; tolerant parsing (object, one-element array or null) |
| Deploy order slips | Home breaks for everyone | §20.1: the database first, verified before the merge |
| Sparse ratings or few kitchens meeting "Under 30" | Thin results | Honest counts; A.1 / A.8; tune the knobs |
| A coupon valid everywhere | An Offers type matches every restaurant | Correct by definition; the count shows it |
| The migration numbers collide with the OTP plan | Out-of-order migrations | Number at write time; update the OTP plan's note |
| Eager bundle growth | Slower first paint | Lazy `FilterSheet`; measured |
| Missing screenshot | Layout may differ from Ankit's picture | Check §12.2 before Phase 5 |

Later improvements (not in this plan): a rush-hour factor in the estimate, a blended "Recommended" order, BOGO (FS11), step times in the order tracker using M1, a "Bestseller" mark from dish popularity.

---

## 22. Docs to update (Phase 10)

- **CLAUDE.md:**
  - *Database:* the new tables, columns, triggers and job, with the **critical rules**: derived browse stats live in side tables (`restaurants.updated_at` = the owner's "Last changed"); Pure Veg is admin-set and trigger-enforced; order stamps are server-only and immutable; `browse_config` is public read and admin write.
  - *Routes:* the `/` and `/search` rows (filter bar, URL keys, lazy panel, estimates).
  - *File map* and *Testing* scope.
- **GEMINI.md:** mirror.
- **`customer_app_ui_redesign_plan.md` §3.1:** mark "Delivery-time estimate", "Popular" and "Timestamps for each step" as now real, linking here.
- **`v2_deferred_issues.md`:** BOGO, the rush-hour factor, a blended relevance, tracker step times.
- **`phone_otp_login_plan.md`:** update the migration-numbering note.
- **This doc:** the status line, decisions as answered, a phase log.

---

## Appendix A — Read-only data audit and ops queries

Run in the Supabase SQL Editor. **Every statement is a `SELECT`; nothing is written.** A.1–A.7 run on today's schema. A.8 needs M1–M3.

```sql
-- A.1 Restaurant ratings: what the Rating filter and sort would see
SELECT count(*)                                                       AS open_active,
       count(*) FILTER (WHERE rating_count > 0)                       AS rated,
       count(*) FILTER (WHERE rating_count > 0 AND rating_avg >= 3.5) AS rated_3_5_plus,
       count(*) FILTER (WHERE rating_count > 0 AND rating_avg >= 4.0) AS rated_4_0_plus,
       count(*) FILTER (WHERE rating_count > 0 AND rating_avg >= 4.5) AS rated_4_5_plus
FROM public.restaurants
WHERE is_active AND is_open;

-- A.2 Typical (median) dish price per open restaurant and its band (FS2)
SELECT r.name,
       count(m.id)                                                    AS available_dishes,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY m.price)           AS typical_price,
       min(m.price) AS cheapest, max(m.price) AS dearest
FROM public.restaurants r
JOIN public.menu_items m ON m.restaurant_id = r.id AND m.is_available
WHERE r.is_active AND r.is_open
GROUP BY r.id, r.name
ORDER BY typical_price;

-- A.3 Dishes: bands, ratings, and headroom under the 1,000-row page
SELECT count(*)                                            AS available_dishes,
       count(*) FILTER (WHERE m.price < 200)               AS under_200,
       count(*) FILTER (WHERE m.price BETWEEN 200 AND 350) AS band_200_350,
       count(*) FILTER (WHERE m.price > 350)               AS above_350,
       count(*) FILTER (WHERE m.rating_count > 0)          AS rated_dishes
FROM public.menu_items m
JOIN public.restaurants r ON r.id = m.restaurant_id
WHERE m.is_available AND r.is_active AND r.is_open;

-- A.4 Listed public offers by type and reach (FS12)
SELECT discount_type,
       count(*)                                          AS listed,
       count(*) FILTER (WHERE restaurant_ids IS NULL)    AS valid_everywhere,
       count(*) FILTER (WHERE restaurant_ids IS NOT NULL) AS restaurant_specific
FROM public.coupons
WHERE kind = 'public' AND show_in_offers AND active
  AND (ends_at IS NULL OR ends_at > now())
GROUP BY discount_type;

-- A.5 Pure Veg candidates (FS9): restaurants whose AVAILABLE menu is all veg,
--     and how many non-veg dishes are merely switched off
SELECT r.name,
       count(*) FILTER (WHERE m.is_available AND m.is_veg)         AS veg_shown,
       count(*) FILTER (WHERE NOT m.is_available AND NOT m.is_veg) AS nonveg_switched_off
FROM public.restaurants r
JOIN public.menu_items m ON m.restaurant_id = r.id
WHERE r.is_active AND r.is_open
GROUP BY r.id, r.name
HAVING count(*) FILTER (WHERE m.is_available AND NOT m.is_veg) = 0
ORDER BY r.name;

-- A.6 Popularity preview (FS10): completed orders in the last 30 days and the
--     percentile M3 would store. Volumes are visible here to Ankit only.
SELECT r.name, count(o.id) AS completed_30d,
       round(100 * percent_rank() OVER (ORDER BY count(o.id)))     AS score
FROM public.restaurants r
LEFT JOIN public.orders o
       ON o.restaurant_id = r.id AND o.status = 'completed'
      AND o.created_at >= now() - interval '30 days'
WHERE r.is_active
GROUP BY r.id, r.name
ORDER BY completed_30d DESC;

-- A.7 Starting prep times (FS16), from history, read-only. For completed
--     orders, updated_at is usually the "Delivered" tap; it also moves on
--     account deletion, hence the median and the 3-hour guard. Subtracting
--     the ride (4 min/km) and the doorstep (5 min) leaves an estimate of
--     "placed → handed to the rider".
SELECT r.name,
       count(*)                                                        AS orders,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY
         extract(epoch FROM (o.updated_at - o.created_at)) / 60
         - 4 * coalesce(o.delivery_distance_km, 0) - 5)::numeric)      AS suggested_prep_minutes
FROM public.orders o
JOIN public.restaurants r ON r.id = o.restaurant_id
WHERE o.status = 'completed'
  AND o.updated_at - o.created_at BETWEEN interval '5 minutes' AND interval '3 hours'
GROUP BY r.id, r.name
ORDER BY r.name;
```

**A.8 — after M1–M3 (ops, recurring):**

```sql
-- Observed vs configured prep, and sample sizes (Ankit only)
SELECT r.name, r.prep_time_minutes, s.observed_prep_minutes,
       count(o.id) FILTER (WHERE o.out_for_delivery_at IS NOT NULL) AS stamped_orders
FROM public.restaurants r
LEFT JOIN public.restaurant_stats s ON s.restaurant_id = r.id
LEFT JOIN public.orders o ON o.restaurant_id = r.id AND o.status = 'completed'
      AND o.created_at >= now() - interval '60 days'
GROUP BY r.id, r.name, r.prep_time_minutes, s.observed_prep_minutes
ORDER BY r.name;

-- Ride-speed calibration for browse_config.minutes_per_km
SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY
         extract(epoch FROM (completed_at - out_for_delivery_at)) / 60
         / delivery_distance_km)::numeric, 1)                AS median_minutes_per_km,
       count(*)                                               AS rides
FROM public.orders
WHERE status = 'completed' AND out_for_delivery_at IS NOT NULL
  AND completed_at IS NOT NULL AND delivery_distance_km >= 0.5
  AND completed_at - out_for_delivery_at BETWEEN interval '2 minutes' AND interval '90 minutes';

-- Job health
SELECT status, start_time, end_time, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'browse-stats-nightly')
ORDER BY start_time DESC LIMIT 7;
```

`list_offers` stays the authority on what each customer sees; A.4 is the catalogue side only.

---

## Appendix B — Option catalogue

| Category | Context | Option | Value | URL | Chip |
|---|---|---|---|---|---|
| sort | both | Relevance (default) | `relevance` | — | — |
| sort | restaurants | Delivery time: fastest first | `delivery_time` | `sort=delivery_time` | Delivery time: fastest first |
| sort | both | Rating: highest first | `rating` | `sort=rating` | Rating: highest first |
| sort | both | Popularity | `popularity` | `sort=popularity` | Popularity |
| sort | both | Price: low to high | `price_asc` | `sort=price_asc` | Price: low to high |
| sort | both | Price: high to low | `price_desc` | `sort=price_desc` | Price: high to low |
| time | restaurants | Any time | `null` | — | — |
| time | restaurants | Under 30 min | `30` | `time=30` | Under 30 min |
| time | restaurants | Under 45 min | `45` | `time=45` | Under 45 min |
| rating | both | Any rating | `null` | — | — |
| rating | both | Rated 3.5+ / 4.0+ / 4.5+ | `3.5` / `4` / `4.5` | `rating=…` | Rated 3.5+ / 4.0+ / 4.5+ |
| offers | restaurants | Flat ₹ off | `flat` | `offers=flat` | Flat ₹ off |
| offers | restaurants | % off | `percent` | `offers=percent` | % off |
| offers | restaurants | Free delivery | `free_delivery` | `offers=free_delivery` | Free delivery |
| price | both | Under ₹200 / ₹200–₹350 / Above ₹350 | `under_200` / `200_350` / `over_350` | `price=…` | same labels |
| veg | restaurants | Any | `any` | — | — |
| veg | restaurants | Pure Veg | `pure_veg` | `veg=pure_veg` | Pure Veg |
| veg | restaurants | Serves non-veg | `nonveg` | `veg=nonveg` | Serves non-veg |
| food | dishes | All / Veg / Non-veg | `all` / `veg` / `nonveg` | `food=…` | (shown by the existing chips) |
| coll | restaurants, signed in | All restaurants | `all` | — | — |
| coll | restaurants, signed in | Previously ordered | `ordered` | `coll=ordered` | Previously ordered |
| coll | restaurants, signed in | New to you | `new` | `coll=new` | New to you |

---

## Appendix C — Admin runbook (Ankit, Supabase Dashboard)

1. **Prep times.** Table Editor → `restaurants` → `prep_time_minutes` for each restaurant: minutes from "order placed" to "handed to the rider", including accept time. Start from A.7's `suggested_prep_minutes`, rounded to 5; the default is 20. Once a restaurant has `prep_min_sample` stamped orders, the observed value takes over automatically.
2. **Pure Veg.** Verify the kitchen (no meat, fish or egg prepared there). Then set `restaurants.is_pure_veg = true`. If the save fails with `PURE_VEG_CONFLICT`, the restaurant still has an available non-veg dish: fix the dish's veg mark if it was wrong, or switch it off, then save again. Unset the flag the day a kitchen stops qualifying.
3. **Knobs.** Table Editor → `browse_config` (one row): `minutes_per_km` (start at 4.0; recalibrate with A.8 after a few weeks), `doorstep_minutes`, `eta_window_minutes`, `prep_min_sample`, `prep_lookback_days`, `popularity_days`. The CHECKs reject out-of-range values. Changes show on the next catalogue refresh (about 2 min).
4. **The nightly job** (once, after M3 is pushed):
   ```sql
   select cron.schedule('browse-stats-nightly', '0 22 * * *',
                        $$select private.refresh_browse_stats()$$);   -- 03:30 IST
   ```
   Check it with A.8's job-health query. To pause it: `select cron.unschedule('browse-stats-nightly');` The last scores stay in place.

Editing `prep_time_minutes` or `is_pure_veg` updates that restaurant's row, so its owner's dashboard shows "Last changed" at the time of your edit. Triggers and the nightly job never do this (§3).

---

## Revision history

- **v1, 2026-10-23:** frontend-only. Delivery time, popularity, BOGO and restaurant Pure Veg were left out for lack of data. The restaurant price came from a browser-side median after a dish fetch on Home.
- **v2, 2026-10-23:** backend in scope. Three additive migrations (order progress stamps; menu facts and an enforced Pure Veg flag in side tables; estimate inputs, popularity and a nightly job). Delivery-time and popularity options; offers by type; estimates and Pure Veg on cards; the owner editor's Pure Veg guard; the dish fetch paginated. BOGO stays a separate plan (FS11).
