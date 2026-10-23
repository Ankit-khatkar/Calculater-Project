# Filters and Sorting — Feature Design & Implementation Plan

> **Status:** Draft, written before any code (2026-10-23). Waiting on Ankit's answers to §0 (FS1–FS9) and the read-only data audit in Appendix A. No code has changed for this feature.
> **Author:** Ankit (drafted with Claude)
> **Revision:** v1 — 2026-10-23
> **Baseline:** `main` @ `0d4754b` (plus uncommitted copy changes in the working tree): 463 tests pass in 39 files; lint and `tsc -b` clean.
> **Scope:** a Zomato-style "Filters and sorting" panel for the customer storefront's restaurant and dish lists: Home's "restaurants near you" list (`/`) and the Search results (`/search`, both tabs). Includes the entry point (a filter bar), the panel, the pure filtering and sorting logic, and its tests.
> **Out of scope:** any backend change (schema, migration, RLS, grants, RPC, trigger, Edge Function, `supabase/config.toml`), the restaurant menu page (`/restaurants/:id`, which already has in-menu search and "Veg only"), the Featured and Top rated rails, the owner dashboard, checkout, ordering and pricing logic.
> **Migrations:** none. **Native build:** none. JS/CSS only, so it can ship by Capgo OTA after review.
> **Coordinates with:** [customer_app_ui_redesign_plan.md](customer_app_ui_redesign_plan.md) (§3.1 data gaps, §4.1 "Honest UI", §6 primitives, §8.1 Home, §8.2 Search) · [customer_search_plan.md](customer_search_plan.md) (the nearby-scoped dish fetch) · [location_resilience_plan.md](location_resilience_plan.md) (the browse engine is not touched) · [coupons_and_promo_codes_plan.md](coupons_and_promo_codes_plan.md) (`list_offers`, `bestOfferFor`) · [reviews_and_ratings_plan.md](reviews_and_ratings_plan.md) (`rating_avg` / `rating_count`).
> **Brief:** the "Zomato-style Sorting and Filtering UI" prompt Ankit supplied on 2026-10-23. It is frontend-only: reuse existing data and queries, skip (and report) any filter the data can't support, and never fabricate data. **The screenshot the brief refers to was not attached to the conversation**, so the layout in §8 follows the brief's written description. Check §8.2 against the screenshot before Phase 2.

## At a glance

- **One panel, two screens.** A "Filters" button above Home's restaurant list and above each Search results tab opens a bottom sheet (a centred card on wider screens): "Filters and sorting" with "Clear all" in the header, categories on the left, the selected category's options on the right, and **Close** / **Show results** at the bottom.
- **Built on data we already load.** Home and Search already hold every nearby restaurant, the listed offers and (on Search) the nearby dishes in `BrowseContext`. Filtering and sorting run in the browser over that set, so a checkbox never triggers a request. The only new read is the signed-in customer's completed-order restaurant ids, for "Previously ordered" and "New to you", and it uses an existing table under its existing RLS.
- **What ships:** Sort (Relevance, Rating, Price low→high, Price high→low), Rating (3.5+, 4.0+, 4.5+), Offers, Dish price (Under ₹200, ₹200–₹350, Above ₹350), Veg / non-veg on dish lists, and Collections (Previously ordered, New to you) for signed-in customers.
- **What doesn't, and why** (§3.3): Delivery time and Fast delivery (no per-restaurant time estimate exists), Popularity (order counts are not readable by customers), Buy 1 Get 1 (no such coupon type), and a restaurant-level Pure Veg / Non-veg marker (no restaurant field, and deriving one from the visible menu can't be verified). These are left out of the UI, not shown disabled. This matches the redesign's "Honest UI" rule (redesign plan §4.1, §3.1).
- **Staged selections.** Changes in the panel are pending until **Show results**. **Close**, ESC, the backdrop and Android back discard them. **Clear all** resets the pending selections to defaults; it never touches the search query, the category or the location.
- **Applied state lives in the URL** (`/?sort=rating&rating=4`, `/search?q=paneer&price=under_200`), written with `replace`. Coming back from a menu and refreshing both keep the filters, and the list is always derived from that one source.
- **With nothing selected, the lists are exactly today's**: same items, same order, same object identity. This is the main regression guarantee, and it is tested.

---

## 0. Decisions for Ankit

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| **FS1** | Where the panel appears | **Home's "restaurants near you" list and Search results (both tabs).** Not the restaurant menu page, which already has in-menu search and "Veg only". The Featured and Top rated rails stay as they are. | The brief says to keep search, category and location constraints and to match "the current page context". Those constraints exist on exactly these two screens. |
| **FS2** | What "price" means for a restaurant | **Its typical dish price: the median price of its available dishes.** Both price sorts and the Dish price filter use it on restaurant lists, and the panel says so in one line. On dish lists, price is the dish's own price. *Alternatives:* (a) the cheapest dish ("from ₹X"); (b) no price options on restaurant lists. | There is no cost-for-two column (redesign plan §3.1). Any restaurant price is derived. The median isn't skewed by a ₹10 roti and puts every restaurant in exactly one price band. Under (a), almost every restaurant lands in "Under ₹200". |
| **FS3** | Rating sort and filter basis | **The average shown on the card or row, with no minimum number of ratings.** Ties go to the larger count. Unrated items are excluded by a rating filter and sorted last. *Alternative:* require ≥ 5 ratings, like the Top rated rail. | With no minimum, a single 5.0 review can top the sort. With a minimum, a card showing "4.6" could disappear from "Rated 4.5+", which looks broken. The audit (Appendix A.1) shows how sparse ratings are today. |
| **FS4** | "Previously ordered" | **Restaurants with at least one `completed` order on this account.** "New to you" is every other restaurant. Signed-in customers only, on restaurant lists only. *Alternative:* count any order that wasn't declined, expired or cancelled. | "Ordered from before" should mean the customer actually received food. An order still in progress counts once it's delivered. |
| **FS5** | Where applied filters are kept | **In the URL query, written with `replace`.** *Alternative:* a session-only React context. | Search already keeps its state in the URL so back and refresh restore it (redesign plan §8.2). With the URL, back from a menu restores both filters and scroll position, and nothing else can drift out of sync. One side effect: tapping the Home or Search tab opens it with no filters, which works as a reset. |
| **FS6** | Requested filters the data can't support | **Leave them out of the UI:** Delivery time / Fast delivery, Popularity, Buy 1 Get 1, and restaurant-level Pure Veg / Non-veg. Record each in `v2_deferred_issues.md` with what would make it real (§3.3). *Optional, cheap, honest extras (say if you want them):* a **"Most reviewed"** sort (`rating_count`), labelled as reviews, not popularity; and a **"Serves non-veg"** restaurant filter (an available non-veg dish exists). | Showing disabled options for missing data would advertise features that don't exist. |
| **FS7** | "Show results" when nothing matches | **Disabled**, with "Nothing matches — remove a filter" above it. It enables again as soon as a change produces results. It is never disabled for any other reason. | All the data is local, so the count is exact before applying. This saves a trip to an empty list. |
| **FS8** | Sheet primitive | **Add two optional props to `Sheet`:** `headerAction` (renders "Clear all") and `showCloseButton` (default `true`; the filter panel passes `false` because its footer has Close). Existing sheets are unchanged. *Alternative:* a separate overlay on `useOverlay`. | Focus trap, ESC, backdrop, scroll lock and Android back then stay in one tested place (redesign plan §6.5). |
| **FS9** | Retrying a failed dish fetch | **Yes:** let `ensureDishes()` start a new fetch after an error (a few lines in `BrowseContext`). | Price filters on Home depend on the dish fetch. Today a failed dish fetch stays failed until the nearby set changes, so "Try again" would have nothing to call. Search's "Couldn't load dishes" notice gains a retry path too. |

**Before Phase 1:** run the read-only audit in Appendix A in the SQL Editor. It shows how many nearby restaurants each rating threshold and price band would keep, whether any listed offer is restaurant-specific, and whether the dish fetch is near PostgREST's 1,000-row cap (§7.4).

---

## 1. Context and goal

Customers can search and pick a category, but they can't **narrow or reorder** what they see. Home's list is always "nearest first", and Search results are always "nearest restaurant, then dish name". A customer who wants "well-rated places", "something under ₹200" or "places with an offer" has to open restaurants one at a time.

**Goal:** give customers a familiar filter-and-sort panel, built on the data RedLotus already has, that:

1. narrows and reorders Home's restaurant list and Search's restaurant and dish results;
2. never claims something the data can't verify;
3. adds no backend work and no per-tap network calls;
4. leaves today's results unchanged when nothing is selected.

---

## 2. Constraints

| Constraint | Source | How this plan meets it |
|---|---|---|
| Frontend only: no schema, migration, RLS, grant, RPC, trigger or Edge Function change | The brief | The only data read that's new to these screens is a `SELECT` of the customer's own orders under the existing `orders_customer_select` policy (§7.2). |
| **Never add a column to the catalogue `select`** | 016 / 017 / 019 / 021 column grants | Anonymous visitors read `restaurants` through a column grant. Selecting a column outside it fails the whole query with `42501`, and Home then shows the fetch error. This plan reads only the columns `BrowseContext` already selects (`BrowseContext.tsx:221-225`). |
| No fake data | Redesign plan §4.1 "Honest UI"; the brief | Every option maps to a real field (§3.2). Items with missing data are excluded by a filter that needs that data, never assumed to pass (§6.8). |
| Reuse the browse engine | Redesign plan §7.9 | The catalogue, nearby set, offers and lazy dish fetch come from `useBrowse()`. The location engine is not touched. |
| Tokens and primitives only | Redesign plan §5–§6 | `Sheet`, `Chip`, `Button`, `EmptyState`, `InlineNotice`, `SectionHeader`, `Skeleton`, `--rl-*` tokens. No hex values in new CSS. |
| No new dependencies | The brief | None. Icons come from `lucide-react` (already used). |
| Customers never download the owner chunk; keep Home's first paint lean | CLAUDE.md "Bundle" | The panel is lazy-loaded on first open (§13). |
| No release without review | Ankit's standing rule | Feature branch → PR → Ankit's review. No merge, `db push`, deploy or OTA without his go-ahead (§16). |

---

## 3. What the data supports

### 3.1 Data already on the client

| Data | Fields | Where it comes from | Who can read it |
|---|---|---|---|
| Nearby restaurants | `id, name, cuisine_type, address, image_url, image_urls, lat, lng, delivery_radius_km, is_featured, featured_rank, rating_avg, rating_count` + computed `distance` (km) | `BrowseContext` catalogue fetch (`BrowseContext.tsx:221-225`), filtered to "the origin is inside the restaurant's own radius" and sorted nearest first (`:442-461`) | anon (column grant) + authenticated; RLS shows only `is_active AND is_open` |
| Nearby dishes | `id, restaurant_id, name, description, price, is_veg, image_url, rating_avg, rating_count` | `BrowseContext` lazy dish fetch, `.in('restaurant_id', nearbyIds)` (`:475-504`), started by `ensureDishes()` | anon + authenticated; RLS returns **available** dishes of visible restaurants only |
| Listed offers | `CouponOffer` (kind, status, discount type/value/cap, windows, `restaurantIds`) | `list_offers` RPC via `listOffers(null)` (`BrowseContext.tsx:250-261`) | per caller (eligibility and personal codes differ by account) |
| The customer's orders | `restaurant_id`, `status` | `orders` table (`OrderHistory.tsx:38-43` reads it today) | authenticated, own rows (`orders_customer_select`: `customer_id = auth.uid()`) |

Facts that shape the rules:

- `rating_avg` is `numeric(2,1)`, `NULL` until the first review; `rating_count` is `0` when unrated. `RatingPill` shows "New" when `count <= 0` (`ratings.ts` `hasRatings`).
- `menu_items.price` and `menu_items.is_veg` are `NOT NULL` (`types/database.ts`). Prices are coerced with `Number()` and guarded against `NaN`, as `DishRow` and the cart already do (their types allow `number | string`).
- Unavailable dishes never reach the client (RLS). A restaurant whose chicken dishes are toggled off looks all-veg. This is why a restaurant-level veg marker can't be derived (§3.3).
- Distance is real (haversine from the browse origin to the restaurant), and the lists are already ordered by it.

### 3.2 Requested filters: verdicts

| Brief item | Verdict | Backed by | Notes |
|---|---|---|---|
| **A. Sort by — Relevance (default)** | ✅ Ship | Today's order | Restaurants nearest first. Dishes by restaurant distance, then name. |
| A. Rating: highest first | ✅ Ship | `rating_avg`, `rating_count` (restaurant or dish) | FS3 |
| A. Price: low to high / high to low | ✅ Ship | Dish `price`. For restaurants, the median of their dish prices (FS2) | Restaurant lists need the dish fetch (§7.2) |
| A. Popularity | ❌ Not available | — | No order counts are readable by customers. `rating_count` counts reviews, not orders. Optional "Most reviewed" in FS6. |
| **B. Delivery time — Fast delivery and ranges** | ❌ Not available | — | No per-restaurant time field exists. `orders.eta_minutes` is a per-order promise visible only to that order's customer. Distance is shown on cards, and Relevance is already nearest first. |
| **C. Rating — 3.5+, 4.0+, 4.5+** | ✅ Ship | `rating_avg` (real, never hard-coded) | Single choice; unrated items excluded |
| **D. Offers — with an offer** | ✅ Ship | `bestOfferFor(offers, restaurantId)` | Exactly the condition that puts an offer line on the card (§6.4) |
| D. Buy 1 Get 1 and other offer categories | ❌ Not available | — | Coupon types are `percent`, `flat`, `free_delivery` only. BOGO is v2-deferred. Splitting "Offers" by type is possible but left out of v1: a type filter can match a restaurant whose card advertises a different, better offer (§6.4). |
| **E. Dish price — Under ₹200, ₹200–₹350, Above ₹350** | ✅ Ship | Dish `price`; for restaurants, the typical (median) dish price (FS2) | Multi-select (OR) |
| **F. Trust markers — Pure Veg / Non-Veg** | ⚠️ Dishes only | `menu_items.is_veg` | Dish lists: All / Veg / Non-veg, the same state as Search's existing chips. Restaurant lists: not available (§3.3). |
| **G. Collections — Previously ordered / New to you** | ✅ Ship (signed-in) | The customer's `completed` orders (FS4) | Hidden for logged-out visitors and on dish lists |

### 3.3 Not available, and what would make each real

| Gap | How the UI handles it | What would make it real (backend, not in this plan) |
|---|---|---|
| Delivery time / Fast delivery | Not shown | A server-side estimate per restaurant, e.g. the median of past `eta_minutes` through a SECURITY DEFINER RPC (redesign plan §3.1 already lists it) |
| Popularity | Not shown | A SECURITY DEFINER RPC returning order counts per restaurant (no personal data) |
| Buy 1 Get 1 | Not shown | A new coupon type in the 027 engine (`coupons_and_promo_codes_plan.md` §14 lists BOGO under v2) |
| Restaurant Pure Veg | Not shown | An admin-verified `restaurants.is_pure_veg` column plus its anon column grant. "Every visible dish is veg" is **not** the same claim: RLS hides unavailable items, and Pure Veg is a promise about the kitchen, not today's menu. Appendix A.5 shows how often the two would differ. |
| Restaurant Non-veg | Not shown (optional in FS6) | Already derivable without backend work ("at least one available non-veg dish"). It's left out of v1 because, without its Pure Veg counterpart, the category looks one-sided. |
| Cost for two | Not shown; restaurant price uses the typical dish price (FS2) | A `restaurants.cost_for_two` column (redesign plan §3.1) |

---

## 4. Where the filters apply

`FilterContext = "restaurants" | "dishes"`. Home's list and Search's Restaurants tab are `restaurants`; Search's Dishes tab is `dishes`.

| Category | Home list (`restaurants`) | Search → Restaurants (`restaurants`) | Search → Dishes (`dishes`) |
|---|---|---|---|
| Sort by | Relevance · Rating · Price ↑ · Price ↓ (typical dish price) | same | Relevance · Rating · Price ↑ · Price ↓ (the dish's own) |
| Rating | Restaurant `rating_avg` | same | Dish `rating_avg` (the number on `DishRow`) |
| Offers | Restaurant has a listed offer | same | **Hidden.** `DishRow` shows no offer, so results couldn't be checked against what's on screen. |
| Dish price | Typical dish price band | same | Dish price band |
| Veg / non-veg | **Hidden** (§3.3) | **Hidden** | All · Veg · Non-veg (`is_veg`) |
| Collections | Signed-in only | Signed-in only | **Hidden.** "Previously ordered" would read as "dishes I ordered". |

**Search shares one filter state across both tabs.** Each tab applies the categories that exist in its context and ignores the others. For example, `offers=1` narrows the Restaurants tab and leaves the Dishes tab alone. A tab's filter bar shows chips only for categories that apply to it. Sort and Rating apply in both contexts, each to its own field.

**Rule of thumb:** every filter checks something the customer can see on the result: the rating, the offer line, the veg mark, the dish price. The one documented exception is the restaurant "typical dish price" (FS2), which the panel explains in a hint line.

---

## 5. Filter model

### 5.1 State

```ts
// src/lib/browseFilters.ts
export type BrowseSort = "relevance" | "rating" | "price_asc" | "price_desc";
export type RatingFloor = 3.5 | 4 | 4.5;
export type PriceBand = "under_200" | "200_350" | "over_350";
export type FoodType = "all" | "veg" | "nonveg"; // = searchResults' VegFilter
export type Collection = "all" | "ordered" | "new";
export type FilterContext = "restaurants" | "dishes";

export interface BrowseFilters {
  sort: BrowseSort;
  minRating: RatingFloor | null; // null = any rating
  offersOnly: boolean;
  priceBands: PriceBand[];       // canonical order, no duplicates; [] = any price
  foodType: FoodType;            // dish lists only
  collection: Collection;        // signed-in, restaurant lists only
}

export const DEFAULT_BROWSE_FILTERS: BrowseFilters = {
  sort: "relevance",
  minRating: null,
  offersOnly: false,
  priceBands: [],
  foodType: "all",
  collection: "all",
};
```

### 5.2 Combination rules

- **Across categories: AND.** "Rated 4.0+" plus "Under ₹200" keeps items that pass both.
- **Within Dish price: OR.** "Under ₹200" plus "₹200–₹350" keeps either band.
- **Single choice:** Sort, Rating (nested thresholds: 4.0+ already implies 3.5+), Veg / non-veg and Collections (their options are complements). These are radio groups with an explicit default option ("Relevance", "Any rating", "All", "All restaurants").
- **Offers** is one checkbox.

### 5.3 URL encoding

The applied state is serialised into the page's existing query string. `q` (Search query), `c` (category slug) and any other key are preserved untouched.

| Field | Param | Values (absent = default) | Example |
|---|---|---|---|
| `sort` | `sort` | `rating`, `price_asc`, `price_desc` | `sort=rating` |
| `minRating` | `rating` | `3.5`, `4`, `4.5` | `rating=4` |
| `offersOnly` | `offers` | `1` | `offers=1` |
| `priceBands` | `price` | comma list of `under_200`, `200_350`, `over_350` | `price=under_200,200_350` |
| `foodType` | `food` | `veg`, `nonveg` | `food=veg` |
| `collection` | `coll` | `ordered`, `new` | `coll=new` |

- **Parsing is lenient.** An unknown or malformed value falls back to the default for that field and never throws, so a hand-edited or stale URL can't crash a screen.
- **Writing is canonical.** Default fields are omitted, and price bands are written in a fixed order, so the same state always produces the same URL (which matters for `replace` and for tests).
- **`coll` is inert when signed out.** It is ignored, shows no chip, and "Clear all" or the next write drops it.
- **`food` keeps today's behaviour.** Search's veg filter moves from component state into the URL. It still persists across query changes and tab switches as it does today, and now it also survives back and refresh.

---

## 6. Filtering and sorting rules

The exact definitions are below; the tests in §14.1 pin each one.

### 6.1 Relevance (the default)

- Restaurants: **today's order**, nearest first (`BrowseContext.tsx:459`).
- Dishes: **today's order**, by restaurant distance, then dish name (`searchResults.ts:77`).
- With `DEFAULT_BROWSE_FILTERS`, `refineRestaurants()` and `refineDishes()` **return their input array unchanged** (same order, same identity). Nothing is re-sorted.

### 6.2 Rating

- **Rated:** `rating_count > 0 && rating_avg != null && Number.isFinite(Number(rating_avg))`. This is the same test as `ratings.ts` `hasRatings`, so "rated" means "the pill shows a number".
- **Filter (`minRating = t`):** keep rated items where `Math.round(Number(rating_avg) * 10) >= t * 10`, comparing integers (35, 40, 45) to avoid float edge cases. Unrated items are excluded.
- **Sort (`rating`):** rated before unrated, then `rating_avg` descending, then `rating_count` descending, then the common tail (§6.9).

### 6.3 Price

- **Dish price:** `Number(price)`, compared in paise (`Math.round(price * 100)`).
- **Typical dish price (restaurants, FS2):** the median of the restaurant's loaded dish prices. For an even count it is the mean of the two middle values, rounded to the nearest paisa. Computed once per dish array (`typicalDishPrices(dishes) → Map<restaurantId, rupees>`). A restaurant with no loaded dishes **has no typical price**.
- **Sort `price_asc` / `price_desc`:** priced items by price ascending or descending; **items with no price come last in both directions**; then the common tail (§6.9).

### 6.4 Offers

A restaurant passes when `bestOfferFor(offers, r.id, now) !== null`, which is exactly when its card shows the offer line (`coupons.ts:452-481`): a public coupon, status `ok`, open right now, valid at that restaurant. So the filter and the card always agree. Consequences:

- **Results depend on the viewer.** `list_offers` answers per caller (eligibility, audience), as the cards do today.
- **Platform-wide rules don't count.** The festival discount (`discount_config`) and the free-delivery rule (`delivery_config`) apply to every restaurant, so they can't distinguish one restaurant from another.
- **A coupon valid at every restaurant makes every restaurant pass** while it's listed. That's correct, and the footer count makes it visible. Appendix A.4 shows whether that is the case today.
- **No per-type options in v1.** `bestOfferFor` advertises one offer per restaurant. A "Free delivery" filter could match a restaurant whose card shows "₹50 off", so the card wouldn't explain why it matched.

### 6.5 Dish price bands

| Band | Rule (rupees) | Label |
|---|---|---|
| `under_200` | `price < 200` | Under ₹200 |
| `200_350` | `200 ≤ price ≤ 350` | ₹200–₹350 |
| `over_350` | `price > 350` | Above ₹350 |

Exactly ₹200 and exactly ₹350 both fall in the middle band. Dishes are tested on their own price; restaurants on their typical dish price (FS2). A restaurant with no typical price is excluded while a band is selected.

### 6.6 Veg / non-veg (dish lists only)

`veg` keeps `is_veg === true`; `nonveg` keeps `is_veg === false`. This is `searchResults()`'s existing `vegFilter`, unchanged. Only the source of the value moves to the URL.

### 6.7 Collections (signed-in, restaurant lists only)

- **`orderedIds`:** the distinct `restaurant_id` values of this account's `completed` orders (FS4; query in §7.2).
- **`ordered`** keeps restaurants whose `id` is in `orderedIds`; **`new`** keeps those that aren't.
- While `orderedIds` is loading, the list shows the loading state. If loading fails, it shows the error state (§9.5). The filter never falls back to "everything passes".

### 6.8 Missing data

| Missing | Rule |
|---|---|
| Restaurant or dish unrated | Excluded by a rating filter; sorted last by rating |
| Restaurant with no loaded dishes | No typical price: excluded by a price band; sorted last by price |
| `price` or `rating_avg` not a finite number after `Number()` | Treated as missing (above) |
| Offers failed to load (`offers = []`) | No restaurant has an offer, which is the same thing today's cards show. The filter correctly returns none. |
| Dish fetch failed while a dish-dependent filter is applied | Error state, not a silently unfiltered list (§9.5) |
| Order history failed while a collection is applied | Error state (§9.5) |

### 6.9 Deterministic tie-breaking

Every non-Relevance sort ends with the same tail, so equal keys always come out in the same order whatever order the fetch returned them in (the catalogue query has no `ORDER BY`):

- Restaurants: **distance ascending, then `name.localeCompare`, then `id`**.
- Dishes: **restaurant distance ascending, then dish `name.localeCompare`, then dish `id`**.

`Array.prototype.sort` is stable, but stability alone isn't enough here, because the input order of exact ties comes from the database.

### 6.10 Counts

All counts are exact, because each screen holds the whole in-radius set and nothing is paginated (§7.4 covers the dish-fetch cap).

- **Home header:** "*N* restaurants near you" today. While any filter (not sort) is active: **"*N* of *M* restaurants near you"**.
- **Search tabs:** "Dishes · N" and "Restaurants · N" show the filtered counts. The **default tab choice** still uses the unfiltered candidates (`SearchPage.tsx:212-215`), so changing a filter never flips the tab under the customer.
- **Panel footer:** the count for the *pending* selection ("8 restaurants match"), computed with the same pure functions.

---

## 7. Data flow

### 7.1 One source of truth

```
URL query ──parseBrowseFilters──▶ applied: BrowseFilters
                                        │
useBrowse(): nearby, offers, dishes ────┼──▶ refineRestaurants / refineDishes (pure, memoised)
useOrderedRestaurantIds() ──────────────┘                │
                                                         ▼
                                     list, header count, tab counts, chips
FilterSheet: pending = copy of applied ── Show results ──▶ writeBrowseFilters ──▶ setParams(…, { replace: true })
```

Inputs are never mutated: the refine functions build new arrays (or return the input itself when nothing is active).

### 7.2 What is fetched, and when

| Data | Already loaded? | Fetched for this feature | Cached | Used by |
|---|---|---|---|---|
| Nearby restaurants + distance | Yes (Home, Search) | Never | `BrowseContext` | Every restaurant filter |
| Listed offers | Yes (with the catalogue) | Never | `BrowseContext` | Offers |
| Nearby dishes | Search: yes, on mount. **Home: no.** | Home: `ensureDishes()` the first time a dish-dependent option (price sort or band, restaurant context) is selected in the panel or present in the URL | `BrowseContext`; refetched only when the nearby set changes (existing rule) | Dish price, price sorts |
| Completed-order restaurant ids | No | The first time a signed-in customer opens the Collections category or loads a page with `coll=` in the URL | Session cache per user id; re-read when older than 2 min on the next open | Collections |

The order-history query (new code, existing table and policy):

```ts
supabase
  .from("orders")
  .select("restaurant_id")
  .eq("customer_id", userId)   // explicit: an admin's FOR ALL policy would return every order
  .eq("status", "completed");
```

- `idx_orders_customer_created (customer_id, created_at DESC)` covers it (003).
- RLS `orders_customer_select` already limits rows to the caller. The explicit `eq` keeps an admin's "Previously ordered" correct.
- The cache is keyed by user id, so a sign-out or an account switch can never show the previous account's set. It is memory-only: nothing goes to `localStorage`.
- In-flight promises are shared, so the panel and the page asking at the same time make one request. A failed load isn't kept, so the next ask tries again. This mirrors `getCategoriesCached()` (`lib/discovery.ts`).

### 7.3 No requests per tap

Toggling options changes only the panel's local `pending` state. The count is a memoised pure computation over data already in memory. **Show results** writes the URL, and the page re-derives its list from memory. The only requests this feature can cause are the two lazy loads above, each once.

### 7.4 Data completeness: the 1,000-row cap

The dish fetch has no `.range()`, so it is subject to PostgREST's `max_rows` (Supabase default **1,000**; it isn't set in `supabase/config.toml`, so the Dashboard value applies). If the dishes of one browse origin's nearby restaurants ever exceed it, the response is cut off **silently**, and both Search (today) and the price filters would work from a partial menu. `customer_search_plan.md` recorded ~15 restaurants and ~300–400 dishes in total, well under the cap, but the business is now multi-city and the figure is old.

- **This plan:** Appendix A.3 checks the headroom before implementation. The risk is recorded in §17.
- **If the audit shows < 1,000 available dishes in total,** no browse origin can reach the cap and nothing more is needed.
- **If it's close,** paginate the dish fetch in `BrowseContext` (a frontend-only change, but it changes a shared fetch, so it needs its own approval).

---

## 8. UI design

### 8.1 Entry point: the filter bar

A horizontally scrolling row (`.fbar`) with the **Filters** chip first, then one removable chip per active choice. Chips that don't apply to the current context are not shown.

**Home**, under the list's `SectionHeader` (`DiscoveryPage.tsx:91-97`):

```
8 of 12 restaurants near you
[⚙ Filters 2] [Rated 4.0+ ✕] [Under ₹200 ✕] →
```

**Search, Dishes tab**: the existing All / Veg / Non-veg chips keep their place, and the Filters chip is added in front:

```
[ Dishes · 14 ][ Restaurants · 5 ]
[⚙ Filters 1] [All] [Veg] [Non-veg] [Price: low to high ✕] →
```

**Search, Restaurants tab:** `[⚙ Filters] [chips…]` above the cards.

- **Filters chip:** the `Chip` primitive with a `SlidersHorizontal` icon. `count` is the number of active choices, and `selected` is set when any are active. `aria-haspopup="dialog"`, `aria-expanded`, and an accessible name "Filters, 2 applied". It opens the panel on **Sort by**.
- **Applied chips:** `Chip` with a trailing `X` and `aria-pressed={undefined}` (the recent-searches precedent in `SearchPage.tsx:261-266`). The accessible name is "Remove Rated 4.0+". **Removing a chip applies immediately**: it's an applied-state edit, not a pending one. Tapping the chip's label opens the panel on that chip's category.
- **Hidden** when the list it controls isn't shown: Home's loading, location and empty states (`BrowseStatusView`); Search before a query or category; Search's "No results for …" state.

### 8.2 The panel

`FilterSheet` renders on `Sheet` (FS8): a bottom sheet on phones, a centred card from 768 px. It has a **fixed height** (`min(88dvh, 640px)` on phones, `560px` on the card) so it doesn't jump between categories; each pane scrolls on its own. On the card layout the width grows to 640 px.

Phone (360 px):

```
┌──────────────────────────────────────────┐
│                  ────                     │
│ Filters and sorting            Clear all │
├──────────────┬───────────────────────────┤
│▌Sort by      │ Sort by                   │
│ Rating     • │ ◉ Relevance (default)     │
│ Offers       │ ○ Rating: highest first   │
│ Dish price • │ ○ Price: low to high      │
│ Collections  │ ○ Price: high to low      │
│              │                           │
│              │ Price uses the typical    │
│              │ price of each restaurant's│
│              │ dishes.                   │
├──────────────┴───────────────────────────┤
│ 8 restaurants match                      │
│ [    Close    ]  [   Show results    ]   │
└──────────────────────────────────────────┘
```

Card (≥ 768 px):

```
┌──────────────────────────────────────────────────────────────┐
│ Filters and sorting                                Clear all │
├────────────────────┬─────────────────────────────────────────┤
│▌Sort by            │ Rating                                  │
│ Rating           • │ ○ Any rating                            │
│ Offers             │ ○ Rated 3.5+                            │
│ Dish price       • │ ◉ Rated 4.0+                            │
│ Collections        │ ○ Rated 4.5+                            │
│                    │ Restaurants without ratings are hidden. │
├────────────────────┴─────────────────────────────────────────┤
│ 8 restaurants match              [ Close ] [ Show results ]  │
└──────────────────────────────────────────────────────────────┘
```

- **Header:** the title "Filters and sorting" with "Clear all" (brand text button) on the right. No X: the footer has Close.
- **Left: categories.** Only those available in the context (§4). The selected one has the surface background, a 3 px brand bar on the left and a bold label. The others sit on `--rl-color-bg-sunken` in secondary text. A brand dot marks a category whose pending value isn't its default.
- **Right: options.** A heading (the category name), then the options as full-width rows at least 48 px tall, with a native radio or checkbox on the left (the `AddressSection` pattern, `accent-color: var(--rl-color-brand-primary)`). A checked row's label is semibold. Optional hint text in `--rl-color-text-secondary` sits under the options.
- **Footer:** the pending count line (an `aria-live` region), then **Close** (`secondary`) and **Show results** (`primary`) side by side, each half width.

### 8.3 Options per category

| Category | Control | Options (restaurant context) | Options (dish context) | Hint |
|---|---|---|---|---|
| Sort by | radio | Relevance (default) · Rating: highest first · Price: low to high · Price: high to low | same labels | Restaurants only: "Price uses the typical price of each restaurant's dishes." |
| Rating | radio | Any rating · Rated 3.5+ · Rated 4.0+ · Rated 4.5+ | same | "Restaurants without ratings are hidden." / "Dishes without ratings are hidden." |
| Offers | checkbox | Restaurants with offers | — (hidden) | "Restaurants showing a coupon you can use now." |
| Dish price | checkbox ×3 | Under ₹200 · ₹200–₹350 · Above ₹350 | same | Restaurants only: "Matched on the typical price of each restaurant's dishes." |
| Veg / non-veg | radio | — (hidden) | All · Veg · Non-veg (each with its `VegMark`) | — |
| Collections | radio | All restaurants · Previously ordered · New to you | — (hidden) | "Based on your delivered orders." |

### 8.4 Copy

| Where | Text |
|---|---|
| Panel title | Filters and sorting |
| Header action | Clear all |
| Footer buttons | Close · Show results |
| Count line | "8 restaurants match" · "1 restaurant matches" · "12 dishes match" · "Nothing matches — remove a filter" · "Checking dish prices…" · "Loading your orders…" |
| Applied chips | Rating: highest first · Price: low to high · Price: high to low · Rated 3.5+ / 4.0+ / 4.5+ · Offers · Under ₹200 · ₹200–₹350 · Above ₹350 · Previously ordered · New to you |
| Filtered-empty state | "No restaurants match these filters" / "No dishes match these filters" · body "Try removing a filter." · action "Clear filters" |
| Dish-data error | "Couldn't load dish prices" · body "The price filter needs them." · actions "Try again" · "Remove price filter" |
| Order-history error | "Couldn't load your past orders" · actions "Try again" · "Remove this filter" |

Sentence case, short, no exclamation marks. This is the redesign's voice (§4.1 principle 8).

### 8.5 Styling

- New CSS files sit beside their components: `FilterSheet.css` (`fsheet__` prefix) and `FilterBar.css` (`fbar__`), on `--rl-*` tokens only.
- The pane layout overrides the Sheet body inside `.fsheet` (no side padding; two flex columns). If overriding `.rl-sheet__body` proves brittle, add a `bodyClassName` prop to `Sheet` instead.
- Left column: `flex: 0 0 36%` (about 128 px at 360 px wide), `max-width: 200px`.
- Reduced motion is already handled globally (`base.css`). The panel adds no animation of its own beyond `Sheet`'s.

---

## 9. Interaction behaviour

### 9.1 Opening

- `pending` starts as a **copy of the applied state** (the URL).
- Focus goes to the **selected category tab** (`initialFocusRef`), not to "Clear all".
- The panel opens on **Sort by**, or on the category of the applied chip that was tapped.
- If the pending state needs dish data or order history that isn't loaded yet, the panel asks for it (`onNeedData`), and the count line shows the matching "Checking…" or "Loading…" text until it arrives.

### 9.2 The three actions

| Action | Pending state | Applied state (URL) | Panel |
|---|---|---|---|
| Select or unselect an option | Updated | Unchanged | Stays open; count updates |
| **Clear all** | Reset to `DEFAULT_BROWSE_FILTERS` | Unchanged | Stays open. Disabled while pending already equals the defaults. |
| **Close**, ESC, backdrop, Android back | Discarded | Unchanged | Closes; focus returns to the Filters chip |
| **Show results** | — | `writeBrowseFilters(params, pending)` with `replace: true`; `q`, `c` and every other key kept | Closes; focus returns to the Filters chip |

- **Clear all + Show results** clears every filter and the sort. **Clear all + Close** changes nothing. The search query, category, location and cart are never touched, because they aren't part of `BrowseFilters`.
- **Show results with no changes** just closes (no URL write).
- **Show results is disabled only when the pending count is known to be 0** (FS7). While a count is still loading it stays enabled; applying then shows the loading state.

### 9.3 After applying

- `ScrollManager` keeps the scroll position on a same-path `REPLACE` (`ScrollManager.tsx`), which is what we want. If the list header has scrolled above the viewport, it is brought back into view (`scrollIntoView({ block: "start" })`, instant under reduced motion), so the customer sees the top of the new results.
- A visually hidden `aria-live="polite"` region announces "Showing 8 restaurants".
- Back from a restaurant menu (`POP`) restores the filtered URL and its scroll position. Tapping the Home or Search tab opens the screen with no filters (FS5).

### 9.4 Search specifics

- **A new query or a recent search keeps the filters.** `writeQuery` (`SearchPage.tsx:151-155`) and `clearCategory` (`:177`) currently build a fresh `URLSearchParams`. They change to start from the applied filter params, so typing a new query doesn't silently drop filters. The debounce effect (`:108-122`) already copies `params` and needs no change.
- Opening a category from Home (`/search?c=…`) starts with no filters, as today.
- **Precedence of empty states:** "No results for '…'" (the query or category matches nothing, before filters) wins over "No restaurants/dishes match these filters".

### 9.5 Loading, empty and error states

| State | Home list | Search tab | Panel footer |
|---|---|---|---|
| Browse loading / location / fetch error | Unchanged (`BrowseStatusView`); filter bar hidden | Unchanged | — |
| Dish data loading, dish-dependent filter applied | Three `RestaurantCardSkeleton`s under the filter bar | `DishRowSkeleton` (as today) | "Checking dish prices…" |
| Order history loading, collection applied | Card skeletons | Card skeletons | "Loading your orders…" |
| Filters match nothing | `EmptyState`: "No restaurants match these filters", **Clear filters** | Same, per tab | "Nothing matches — remove a filter"; Show results disabled |
| Dish fetch failed, dish-dependent filter applied | `EmptyState` (error tone): "Couldn't load dish prices", **Try again** (FS9) · **Remove price filter** | Search's existing "Couldn't load dishes" notice gains **Try again**; the Restaurants tab with a price filter shows the same error state | Price options stay selectable; count line "Couldn't load dish prices" |
| Order history failed, collection applied | `EmptyState` (error tone): "Couldn't load your past orders", **Try again** · **Remove this filter** | Same (Restaurants tab) | Count line "Couldn't load your orders" |

"Clear filters" and "Remove …" apply immediately (they're applied-state edits). No state ever shows a list that ignores an applied filter.

---

## 10. Accessibility

- **Dialog:** `Sheet` provides `role="dialog"`, `aria-modal`, `aria-labelledby` (the title), focus trap, focus restore, ESC and Android back (`useOverlay`).
- **Categories:** `role="tablist"` with `aria-orientation="vertical"` and `aria-label="Filter categories"`. Each tab has `role="tab"`, `aria-selected` and `aria-controls`. Focus is roving: ↑/↓ move between tabs and select them, Home/End jump, and Tab moves into the panel. Each tab's accessible name includes its state, e.g. "Rating, 1 selected".
- **Options:** each panel is `role="tabpanel"` (`aria-labelledby` its tab) containing a `fieldset` with a `legend` (the visible heading). Radios and checkboxes are **native inputs** in `<label>`s, so they get keyboard behaviour, checked state and screen-reader semantics without extra ARIA. Hints are tied to the fieldset with `aria-describedby`.
- **Focus visibility:** the global `:focus-visible` ring (`base.css`) on tabs, inputs and buttons. Custom row styles must not suppress it.
- **Live regions:** the footer count line (`aria-live="polite"`) and the post-apply announcement (§9.3).
- **Targets:** rows at least 48 px tall and chips 36 px tall (the `Chip` primitive), each with a 44 px hit area (`--rl-size-touch-min`). Colour is never the only signal: selected state is also shown by the native control and the label weight, and the category dot comes with the "selected" text in the accessible name.
- **Disabled "Show results":** a real `disabled` attribute, with the reason visible in the count line just above it.

---

## 11. Files and responsibilities

### 11.1 New

| File | Responsibility |
|---|---|
| `src/lib/browseFilters.ts` | The model (§5): types, `DEFAULT_BROWSE_FILTERS`, `parseBrowseFilters(params)`, `writeBrowseFilters(params, filters)`, `isDefaultFilters`, `activeFilterCount(filters, context, { signedIn })`, `appliedChips(…)`, `categoriesFor(context, { signedIn })`, `needsDishData(filters, context)`, `needsOrderHistory(filters, context, signedIn)`, the labels. Pure. |
| `src/lib/browseFilterResults.ts` | The rules (§6): `typicalDishPrices(dishes)`, `priceBandOf(rupees)`, `refineRestaurants(entries, filters, { offers, now, typicalPrices, orderedIds })`, `refineDishes(results, filters)`. Pure; inputs never mutated. |
| `src/lib/orderedRestaurants.ts` | `getOrderedRestaurantIds(userId)`: the completed-orders query (§7.2) with a per-user session cache and shared in-flight promise. |
| `src/components/browse/useBrowseFilters.ts` | `useSearchParams` ↔ `BrowseFilters`: returns `{ filters, setFilters }`, writes with `replace: true`, keeps every other param. |
| `src/components/browse/useOrderedRestaurantIds.ts` | `{ ids, status, retry }` for a signed-in customer; idle when signed out or not needed. |
| `src/components/browse/FilterBar.tsx` + `.css` | The Filters chip and the applied chips (§8.1). |
| `src/components/browse/FilterSheet.tsx` + `.css` | The panel (§8.2–§9.2). Lazy-loaded (§13). |
| `src/lib/browseFilters.test.ts`, `src/lib/browseFilterResults.test.ts` | Unit tests (§14.1). |
| `src/components/browse/FilterSheet.test.tsx`, `FilterBar.test.tsx` | Render tests (§14.2). |

Signatures:

```ts
// FilterSheet.tsx
export interface FilterSheetProps {
  context: FilterContext;
  applied: BrowseFilters;
  signedIn: boolean;
  initialCategory?: FilterCategoryId;
  /** Items the pending selection would show; null while its data is loading. */
  countFor: (pending: BrowseFilters) => number | null;
  /** The pending selection needs dish data or order history. */
  onNeedData: (pending: BrowseFilters) => void;
  noun: { one: string; other: string }; // restaurant(s) | dish(es)
  onApply: (next: BrowseFilters) => void;
  onClose: () => void;
}

// FilterBar.tsx
export interface FilterBarProps {
  context: FilterContext;
  filters: BrowseFilters;
  signedIn: boolean;
  onOpen: (category?: FilterCategoryId) => void;
  /** Chip removal: applies immediately. */
  onChange: (next: BrowseFilters) => void;
  /** Search's Dishes tab: the existing All / Veg / Non-veg chips. */
  children?: ReactNode;
}
```

### 11.2 Changed

| File | Change |
|---|---|
| `src/components/ui/Sheet.tsx` (+ `.css` if needed) | Two optional props, `headerAction?: ReactNode` and `showCloseButton?: boolean = true` (FS8). Every existing call site renders as before. |
| `src/pages/discovery/DiscoveryPage.tsx` (+ `.css`) | Reads `useBrowseFilters()`. Derives the list with `refineRestaurants`. Renders `FilterBar` under the section header, the "N of M" count, and the loading/empty/error states (§9.5). Calls `ensureDishes()` only when `needsDishData`. Opens the lazy `FilterSheet`. **Rails and everything above the list are unchanged.** |
| `src/pages/search/SearchPage.tsx` (+ `.css`) | The veg filter moves from `useState` to the URL (`food`). Chips behave as before. `writeQuery` and `clearCategory` keep the filter params (§9.4). Both tabs get `FilterBar` + `FilterSheet`. Tab counts are filtered. Adds the filtered-empty state. `searchResults()` is called exactly as today; refining happens on its output. |
| `src/context/BrowseContext.tsx` | **Only with FS9:** `ensureDishes()` re-arms the dish fetch after an error. No other change. |
| Docs | §18. |

**Not changed:** `searchResults.ts`, `search.ts`, `categoryMatch.ts`, `topRated.ts`, `coupons.ts`, `RestaurantCard`, `DishRow`, `BrowseStatusView`, `RestaurantMenu`, the cart, checkout, pricing, and everything under `supabase/`.

---

## 12. Invariants (must still hold after the change)

1. With no filters, Home's list and Search's results are **identical** to today's: same members, same order. This is tested against the existing `searchResults` fixtures.
2. The browse origin, the location states, the catalogue and offers fetches and their staleness rules are untouched (`location_resilience_plan.md`).
3. The dish fetch stays **scoped to nearby restaurants** and lazy. Home makes **no** dish request unless a dish-dependent filter is selected or applied.
4. The catalogue `select` gains **no** columns (anon column grant).
5. Search's `?q=` and `?c=` behaviour, recent searches, the default-tab rule, the category notice and add-to-cart (including the replace-cart dialog) work as today.
6. Restaurant menus, the cart, checkout, coupons, pricing and order placement are untouched.
7. The Featured and Top rated rails ignore the filters.
8. Owners are still redirected to `/dashboard` from both screens.
9. Android back closes the panel before it does anything else (`backStack`).
10. No filter result ever contains an item whose data can't prove it passes (§6.8).

---

## 13. Performance and bundle

- **Data sizes:** tens of restaurants and at most hundreds of dishes per browse origin. Filtering and sorting are O(n log n) over arrays already in memory: microseconds.
- **Memoisation:** `typicalDishPrices` with `useMemo([dishes])`; the refined list with `useMemo([nearby, offers, dishes-derived index, orderedIds, filters])`; the panel's pending count with `useMemo([pending, …])`. The page re-renders only on Show results, a chip removal, or a change in the browse data.
- **Requests:** at most one dish fetch on Home (and only for price filters), at most one order-history read per user per 2 min, and nothing per tap (§7.3).
- **Bundle:** Home is the eager `index` chunk (~345 kB / ~111 kB gzip, CLAUDE.md "Bundle"). `FilterBar` and the pure modules load eagerly (a few kB). **`FilterSheet` is lazy** (`React.lazy` + `Suspense`; preloaded on the Filters chip's `pointerdown` / `focus`), shared by Home and Search. Measure the `index` chunk before and after (target: under 2 kB gzip growth) and record it in the PR.

---

## 14. Testing and verification

### 14.1 Unit tests (Vitest, pure)

`browseFilters.test.ts`:
- Parse/write round trip for every field. Defaults are omitted. Price bands come out in canonical order and are de-duplicated. Unknown and malformed values fall back to defaults. `q`, `c` and foreign keys are preserved byte for byte.
- `activeFilterCount`, `appliedChips` and `categoriesFor` per context and signed-in state. `coll` is inert when signed out. Offers and Collections are hidden in the dish context; Veg / non-veg in the restaurant context.
- `needsDishData` / `needsOrderHistory` truth tables.

`browseFilterResults.test.ts`:
- **Identity:** defaults return the input array itself (`toBe`).
- **Each sort changes the order**, on a fixture built so Relevance, Rating, Price ↑ and Price ↓ all give different orders, for restaurants and for dishes.
- Rating thresholds at the boundaries (3.4/3.5, 3.9/4.0, 4.4/4.5, float input `4.0000001`); unrated excluded or last; count as tie-break.
- Typical price: odd and even counts, paisa rounding, string prices, a restaurant with no dishes (excluded by a band, last in both price sorts).
- Bands at exactly ₹200 and ₹350; multiple bands OR together.
- Offers: matches `bestOfferFor` for specific, everyone, expired, time-windowed and non-public offers.
- Collections: `ordered` / `new` partition the list; with the set missing, both report "not ready".
- Combinations: AND across categories, OR within price; an empty result.
- **Determinism:** shuffled input in, identical output out, for every sort (exact ties broken by distance → name → id).
- **Immutability:** inputs are deep-equal before and after.

### 14.2 Render tests (`@testing-library/react` + `user-event`)

`FilterSheet.test.tsx`:
- Opens with pending = applied and focus on the selected tab.
- ↑/↓ move between tabs; each tab shows its panel; only the context's categories are listed.
- Selecting options updates the count line; **Close**, ESC and the backdrop don't call `onApply`.
- **Clear all** resets pending (the count updates), is disabled at defaults, and doesn't call `onApply`.
- **Show results** calls `onApply` once with the pending state, and is disabled exactly when `countFor` returns 0.
- A count of `null` shows the loading copy and leaves Show results enabled.
- Uses `overlays.test.tsx`'s patterns for ESC and the back stack.

`FilterBar.test.tsx`: the Filters chip's count and accessible name; removing a chip calls `onChange` with that field reset; chips hidden for out-of-context fields.

### 14.3 Manual QA (`npm run dev`, real data, read-only browsing)

| # | Scenario | Expected |
|---|---|---|
| 1 | Home, no filters | List, order and header exactly as before; no dish request in the Network tab |
| 2 | Sort: Rating, then each Price sort | Order visibly changes (where the data differs — Appendix A says whether it does); unrated / unpriced last |
| 3 | Rated 4.0+ | Only cards whose pill shows ≥ 4.0; header "N of M"; the chip appears |
| 4 | Offers | Exactly the cards with an offer line |
| 5 | Under ₹200 on Home | One dish request (first time only); skeletons, then results; toggling other options makes no further requests |
| 6 | Combine Rating + Price + Offers | AND semantics; count in the panel = count on the list |
| 7 | Clear all → Close | Nothing changes. Clear all → Show results: back to the item-1 state, URL without filter keys |
| 8 | Change options → Close / ESC / backdrop / Android back | Applied state unchanged |
| 9 | A selection matching nothing | "Nothing matches — remove a filter"; Show results disabled; changing a filter re-enables it |
| 10 | Filter → open a restaurant → back | Same filters, same scroll position |
| 11 | Refresh with filters in the URL | Same results |
| 12 | Search: query + filters, type a new query, pick a recent search | Filters kept; `q` updates; tab counts are filtered |
| 13 | Search Dishes tab: Veg chips and the panel's Veg / non-veg | Same state both ways; results as before for each value |
| 14 | Category from Home (`/search?c=…`) | Starts with no filters; category notice and Clear behave as before |
| 15 | Signed out | No Collections category; a `coll=` URL is inert |
| 16 | Signed in: Previously ordered / New to you | Partition of the list; one `orders` request |
| 17 | Change location (address picker) with filters applied | List re-derives; filters kept; dish data refetched only because the nearby set changed |
| 18 | Offline: apply a price filter on Home before dishes load | Error state with Try again (FS9) and Remove price filter |
| 19 | Keyboard only (desktop) | Open, navigate categories, toggle, apply and close without a mouse; focus ring visible throughout |
| 20 | TalkBack (Android) / VoiceOver | Dialog, tabs, radios and checkboxes announced with state; count announced |
| 21 | 360 px, 768 px, 1024 px+ | Bottom sheet / card; no horizontal page scroll; panes scroll independently |
| 22 | Regression: add to cart from Search, the replace-cart dialog, checkout to the confirm modal (don't place the order) | Unchanged |

### 14.4 Gates

`npm test` (all suites; the count rises from 463), `npm run lint`, `npm run build` (runs `tsc -b`, then the Vite build), the bundle-size comparison (§13), and one device pass on the Capgo `staging` channel before any release.

---

## 15. Implementation phases

| Phase | Work | Done when |
|---|---|---|
| 0 | Ankit answers FS1–FS9 and runs Appendix A | Decisions recorded at the top of this doc |
| 1 | `browseFilters.ts`, `browseFilterResults.ts`, `orderedRestaurants.ts` + unit tests | §14.1 green; no UI yet |
| 2 | `Sheet` props, `FilterSheet`, `FilterBar`, the hooks + render tests | §14.2 green |
| 3 | Home integration (+ FS9 if accepted) | QA rows 1–11, 15–19 |
| 4 | Search integration (veg into the URL, `writeQuery` / `clearCategory`) | QA rows 12–14, 22 |
| 5 | Polish: accessibility pass, 360 / 768 / 1024 px screenshots, bundle measurement | QA rows 19–21; §14.4 gates |
| 6 | Docs (§18), PR for Ankit's review | Review |

---

## 16. Rollout

- Branch `feat/filters-and-sorting` from `main`. Commits per phase.
- **Ask Ankit before opening the PR or pushing.** Nothing is merged, deployed or sent by OTA without his review.
- Vercel preview for the web review. The Capgo `staging` channel for a device test (Android back, TalkBack, a low-end phone).
- Release is a normal JS-only OTA: bump `package.json`'s version on the release commit (the CI `ota` lane ships nothing without a bump). No native build, so it's inside the OTA safe harbour (`capacitor_native_apps_plan.md` §5.4).
- Rollback: revert the merge commit and ship the next OTA. No data was written, so there's nothing to clean up.

---

## 17. Risks and open questions

| Risk | Impact | Mitigation |
|---|---|---|
| Dish fetch silently capped at 1,000 rows (§7.4) | Price filters and Search work from a partial menu in a dense area | Appendix A.3 now; paginate the shared fetch if the headroom gets thin |
| Sparse ratings | Rating filters return few or no restaurants; the rating sort barely differs from Relevance | Appendix A.1 sizes it. The counts are honest, and FS3 keeps the displayed number as the basis. |
| A coupon valid everywhere | "Offers" matches every restaurant while it's listed | Correct by definition (§6.4); the count shows it; Appendix A.4 |
| The median price surprises someone | A restaurant with many cheap sides isn't "Under ₹200" | Hint copy in the panel; FS2 alternatives |
| Filters in the URL on `/` | The Home tab resets filters | Deliberate (FS5); matches how the Search tab treats `q` |
| Eager bundle growth on Home | Slower first paint on cheap phones | Lazy `FilterSheet`; measured in the PR (§13) |
| Admin accounts read every order | Wrong "Previously ordered" for admins | Explicit `.eq("customer_id", userId)` (§7.2) |
| A coupon's time window opens or closes while the page is open | The Offers result lags until the next render, as the cards do today | Accepted; same behaviour as today's offer lines |
| Missing screenshot | Layout may differ from what Ankit pictured | Check §8.2 against it before Phase 2 |

Open questions beyond FS1–FS9: none.

---

## 18. Docs to update (Phase 6)

- **CLAUDE.md:** the `/` and `/search` rows of the routes table (the filter bar, the URL keys, the lazy panel); the file map (`lib/browseFilters.ts`, `lib/browseFilterResults.ts`, `lib/orderedRestaurants.ts`, `components/browse/FilterBar`, `FilterSheet`, the hooks; the `Sheet` props); the testing scope.
- **GEMINI.md:** mirror the same.
- **`v2_deferred_issues.md`:** add the §3.3 gaps (delivery-time filter, popularity sort, BOGO, restaurant Pure Veg) with what would make each real.
- **`customer_app_ui_redesign_plan.md` §3.1:** cross-reference this plan.
- **This doc:** status line, decisions as answered, phase log.

---

## Appendix A — Read-only data audit

Run in the Supabase SQL Editor. **Every statement is a `SELECT`; nothing is written.** The results size the options before anything is built.

```sql
-- A.1 Restaurant ratings (what the Rating filter and sort would see)
SELECT count(*)                                                          AS open_active,
       count(*) FILTER (WHERE rating_count > 0)                          AS rated,
       count(*) FILTER (WHERE rating_count > 0 AND rating_avg >= 3.5)    AS rated_3_5_plus,
       count(*) FILTER (WHERE rating_count > 0 AND rating_avg >= 4.0)    AS rated_4_0_plus,
       count(*) FILTER (WHERE rating_count > 0 AND rating_avg >= 4.5)    AS rated_4_5_plus
FROM public.restaurants
WHERE is_active AND is_open;

-- A.2 Typical (median) dish price per open restaurant, and its band (FS2)
SELECT r.name,
       count(m.id)                                                       AS available_dishes,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY m.price)              AS typical_price,
       min(m.price)                                                      AS cheapest,
       max(m.price)                                                      AS dearest,
       CASE
         WHEN percentile_cont(0.5) WITHIN GROUP (ORDER BY m.price) < 200   THEN 'Under ₹200'
         WHEN percentile_cont(0.5) WITHIN GROUP (ORDER BY m.price) <= 350  THEN '₹200–₹350'
         ELSE 'Above ₹350'
       END                                                               AS band
FROM public.restaurants r
JOIN public.menu_items m ON m.restaurant_id = r.id AND m.is_available
WHERE r.is_active AND r.is_open
GROUP BY r.id, r.name
ORDER BY typical_price;

-- A.3 Dishes: price bands, ratings, and headroom under the 1,000-row cap (§7.4)
SELECT count(*)                                              AS available_dishes,  -- < 1000 ⇒ no browse origin can hit the cap
       count(*) FILTER (WHERE m.price < 200)                 AS under_200,
       count(*) FILTER (WHERE m.price BETWEEN 200 AND 350)   AS band_200_350,
       count(*) FILTER (WHERE m.price > 350)                 AS above_350,
       count(*) FILTER (WHERE m.rating_count > 0)            AS rated_dishes
FROM public.menu_items m
JOIN public.restaurants r ON r.id = m.restaurant_id
WHERE m.is_available AND r.is_active AND r.is_open;

-- A.4 Listed public offers: does any one cover every restaurant? (§6.4)
SELECT slug, title, discount_type, audience,
       CASE WHEN restaurant_ids IS NULL THEN 'every restaurant'
            ELSE cardinality(restaurant_ids) || ' restaurant(s)' END    AS scope,
       starts_at, ends_at
FROM public.coupons
WHERE kind = 'public' AND show_in_offers AND active
  AND (ends_at IS NULL OR ends_at > now())
ORDER BY scope, slug;

-- A.5 Why restaurant "Pure Veg" can't be derived (§3.3): restaurants whose
--     visible menu is all-veg only because non-veg items are switched off
SELECT r.name,
       count(*) FILTER (WHERE m.is_available AND m.is_veg)          AS veg_shown,
       count(*) FILTER (WHERE m.is_available AND NOT m.is_veg)      AS nonveg_shown,
       count(*) FILTER (WHERE NOT m.is_available AND NOT m.is_veg)  AS nonveg_hidden
FROM public.restaurants r
JOIN public.menu_items m ON m.restaurant_id = r.id
WHERE r.is_active AND r.is_open
GROUP BY r.id, r.name
HAVING count(*) FILTER (WHERE m.is_available AND NOT m.is_veg) = 0
ORDER BY r.name;
```

`list_offers` stays the authority on what each customer sees: A.4 shows the catalogue side only, not per-customer eligibility.

---

## Appendix B — Option catalogue

| Category id | Context | Option | Field value | URL | Chip label |
|---|---|---|---|---|---|
| `sort` | both | Relevance (default) | `relevance` | — | — |
| `sort` | both | Rating: highest first | `rating` | `sort=rating` | Rating: highest first |
| `sort` | both | Price: low to high | `price_asc` | `sort=price_asc` | Price: low to high |
| `sort` | both | Price: high to low | `price_desc` | `sort=price_desc` | Price: high to low |
| `rating` | both | Any rating | `null` | — | — |
| `rating` | both | Rated 3.5+ | `3.5` | `rating=3.5` | Rated 3.5+ |
| `rating` | both | Rated 4.0+ | `4` | `rating=4` | Rated 4.0+ |
| `rating` | both | Rated 4.5+ | `4.5` | `rating=4.5` | Rated 4.5+ |
| `offers` | restaurants | Restaurants with offers | `true` | `offers=1` | Offers |
| `price` | both | Under ₹200 | `under_200` | `price=under_200` | Under ₹200 |
| `price` | both | ₹200–₹350 | `200_350` | `price=200_350` | ₹200–₹350 |
| `price` | both | Above ₹350 | `over_350` | `price=over_350` | Above ₹350 |
| `food` | dishes | All | `all` | — | — |
| `food` | dishes | Veg | `veg` | `food=veg` | (shown by the existing chips) |
| `food` | dishes | Non-veg | `nonveg` | `food=nonveg` | (shown by the existing chips) |
| `collection` | restaurants, signed in | All restaurants | `all` | — | — |
| `collection` | restaurants, signed in | Previously ordered | `ordered` | `coll=ordered` | Previously ordered |
| `collection` | restaurants, signed in | New to you | `new` | `coll=new` | New to you |
