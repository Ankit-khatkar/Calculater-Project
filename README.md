# Customer App UI Redesign — Figma-Driven Build Plan

> **Status:** Draft for review — 2026-10-05. Nothing has been built yet. No code, Figma file or database was changed while writing this plan. Decisions D1–D17 (§0) need Ankit's yes/no before Phase 1.
> **Author:** Ankit (drafted with Claude)
> **Revision:** v1 — 2026-10-05
> **Baseline:** measured on `main` @ `76e4a1f`: 312 tests pass in 20 files; bundle sizes in §12.1.
> **Scope:** every customer-facing screen of the shared web / PWA / Android (Capacitor) codebase: the shell and navigation, Home, Search, Restaurant, Cart & Checkout, Order tracking, Orders, Offers and Profile. Plus one design system that exists twice, in code (`src/styles/tokens.css`) and in Figma (variables + components), kept in sync by name.
> **Out of scope:** the owner dashboard, marketing pages, auth screens (owned by [phone_otp_login_plan.md](phone_otp_login_plan.md) §8), payments, and any schema, RLS, RPC or Edge Function change.
> **Migrations:** none. **Native build:** none expected. Everything ships by Capgo OTA; §16.3 lists the optional items that would need a store build.
> **Coordinates with:** [phone_otp_login_plan.md](phone_otp_login_plan.md) (D6 public menus, `?next=` return path, Profile phone row, D10 WhatsApp number) · [capacitor_native_apps_plan.md](capacitor_native_apps_plan.md) (NativeBridge, OTA safe harbour §5.4) · [customer_ui_revamp_plan.md](customer_ui_revamp_plan.md) (its data contract stays; its layout is superseded) · [location_resilience_plan.md](location_resilience_plan.md) (engine invariants) · [delivery_address_capture_plan.md](delivery_address_capture_plan.md) · [distance_based_delivery_plan.md](distance_based_delivery_plan.md) (Principle 1) · [coupons_and_promo_codes_plan.md](coupons_and_promo_codes_plan.md) · [reviews_and_ratings_plan.md](reviews_and_ratings_plan.md) · [restaurant_card_slideshow_plan.md](restaurant_card_slideshow_plan.md) · [design.md](design.md) (superseded by §5 once Phase 1 lands).
> **Brief:** the "senior mobile UI/UX designer" prompt Ankit supplied on 2026-10-05. It asks for Zomato / Swiggy / DoorDash patterns as inspiration, a distinct RedLotus identity, no fake data and no business-logic change. Where the brief and RedLotus disagree, §2 records which wins and why.

## At a glance

- **Design in Figma first, then code from Figma.** Claude builds the design system and screens in Figma through the Figma MCP server. Ankit reviews and approves each screen there. Code is then implemented from the approved frames with `get_design_context`. No screen is coded before its frame is approved.
- **The connected Figma account is on the Starter plan** (Full seat), checked 2026-10-05. That gives 200 MCP calls a day (10 a minute), 3 design files with 3 pages each, and **no Code Connect** (Organization / Enterprise only). The plan fits inside that: one design file with three pages plus one FigJam file, and Figma ↔ React mapping by naming convention (§13).
- **One design system in two places.** `src/styles/tokens.css` holds CSS custom properties (`--rl-…`). Figma variables mirror them 1:1 with `var(--rl-…)` code syntax, so design-to-code output lands on real tokens. The palette is today's palette, consolidated, with three changes made for contrast and FSSAI conformance (§5.2).
- **An app shell with a bottom navigation bar**: Home · Search · Orders · Offers · Profile, on phones and tablets. It replaces the marketing `Navbar`, which every customer screen except Home uses today.
- **Screens are restyled around their logic, not through it.** Pricing, coupons, the geofence, `place_order`, Realtime and the geolocation engine are moved verbatim or not touched at all. §15.4 lists every invariant to re-verify.
- **No fake data.** Every element maps to a real source (§3). Things the backend can't support yet (delivery-time estimates, cost for two, menu categories, popularity) are left out, not invented, and §3.1 says what would make each one real.
- **It ships by OTA in two waves**: Browse (shell, Home, Search, Restaurant), then Transact (Checkout, Orders, Offers, Profile). Each wave is tested on the Capgo `staging` channel first and released only after Ankit's review.

---

## 0. What this plan needs from Ankit

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| **D1** | Navigation model | **Yes:** a 5-tab bottom bar, Home · Search · Orders · Offers · Profile, with labels always visible. Shown below 1024 px on the five tab screens only. Drill-down screens (restaurant, checkout, order detail, review, saved addresses) get a back-arrow header instead. Owners never see it. Desktop keeps one top bar with the same five links. | Today Orders, Offers and Profile are reachable only from the avatar menu. Every screen except Home shows the marketing `Navbar` with a hamburger and, for logged-out visitors, "Partner Program / About Us" links. That is two navigation systems in one product. |
| **D2** | Search gets its own route | **Yes:** `/search` is a tab. Home's search bar and category chips open it. Recent searches are kept per device (max 8) and cleared on sign-out. | Moves about 400 lines of search and filter code out of `DiscoveryPage` (1,174 lines). One results UI serves both text and category search. |
| **D3** | Cart and checkout stay one screen at `/checkout` | **Yes:** restructured into sections, with a sticky footer: "Place order · ₹X". No separate `/cart` route. | A separate cart would either duplicate the pricing and geofence logic or show a total that can't be known without an address (Principle 1). |
| **D4** | Public restaurant menus | **Yes:** take `/restaurants/:id` out of `ProtectedRoute`. Ship it with whichever of this plan or the OTP plan lands first (it is that plan's D6). | The brief's critical flow starts logged out. Today the first restaurant tap hits the login wall and, after login, returns the visitor to Home rather than the restaurant. |
| **D5** | Logged-out visitors on the Orders and Profile tabs | **Yes:** show an in-place "Log in to see your orders" panel instead of redirecting to `/login`. | The tab bar stays and the visitor keeps their place. The data is still protected by RLS. |
| **D6** | Header location copy | **"Your location ▾"** above the locality label, not "Delivering to". | The bar sets the *browse origin*. The delivery pin is confirmed at checkout. "Delivering to" would promise something the bar doesn't do. |
| **D7** | Checkout's default address | **Yes:** if the browse origin is one of the customer's saved addresses (same coordinates), checkout pre-selects that address. Otherwise keep today's rule (top row of the book). | Prevents browsing at "Office" and then finding "Home" pre-selected at checkout. This is the only selection-logic change in the plan, and it reads existing data only. |
| **D8** | Typography | **Plus Jakarta Sans for all UI.** DM Serif Display only for the wordmark and a few editorial headings. | Keeps the brand's character while giving app screens the dense, legible type they need. |
| **D9** | Veg / non-veg marks | **Shape-coded, per the FSSAI convention:** a green circle for veg, a brown triangle for non-veg, both in squares, with darker colours for contrast. | Today both marks are dots told apart only by colour (`#2ECC71` at 2.1:1 on white). That fails WCAG 1.4.1 and 1.4.11. The non-veg red also collides with the brand red. |
| **D10** | Self-host the two font families | **Yes:** bundle the woff2 files and drop the Google Fonts CDN. | One fewer third-party origin at cold start. Fonts work offline in the native shell, which has no service worker, and they ride in the OTA bundle. |
| **D11** | Saved-addresses screen in Profile | **Yes:** list, set default and delete, on the existing `addressBook.ts`. Adding a new address stays in checkout for v1. | The address book shipped in 015. Only its management screen was deferred, and the data layer for it already exists. |
| **D12** | Sections derived from ratings | **Yes:** a "Top rated near you" rail (needs ≥ 3 restaurants with ≥ 5 ratings) and a "Top rated here" menu section (needs ≥ 2 dishes with ≥ 3 ratings). Both hide below their thresholds. | These are real data. They replace the brief's "Popular" and "Top picks" rails, which have no backing data. |
| **D13** | Order tracking refreshes itself | **Yes:** refetch the order when the app resumes, when the tab becomes visible and when the Realtime channel reconnects. | Supabase Realtime doesn't replay missed events. A phone that slept through "Out for delivery" shows a stale status until a manual reload. The owner dashboard already refetches on reconnect. |
| **D14** | Release strategy | **An integration branch and two waves:** Browse, then Transact. Each wave is tested on the Capgo `staging` channel, then released after Ankit's review. | Phase-by-phase releases would put a half-old, half-new app in customers' hands for weeks. One big release would be too large to review. |
| **D15** | Figma plan | **Stay on Starter:** 1 design file × 3 pages, plus 1 FigJam file. Upgrade only if the limits start to bite. | It fits (§13.1). Professional Full seats get the same 200 calls a day, so upgrading buys more files and pages but no more MCP budget. |
| **D16** | Rating display | **Keep the gold star and the number.** No green rating pills. | Green pills are Zomato's signature. The gold star is already RedLotus's (`starGold #F5A623`). |
| **D17** | WhatsApp number on customer screens | **Ankit to answer.** The code uses `919460049608` (storefront, login, error screen) and `916378939472` (delete-account page, partner pages, owner tools). CLAUDE.md lists `916378939472`. | Same question as the OTP plan's D10. The redesign moves the numbers into one `src/lib/contact.ts` and keeps each surface's current number until this is answered. |

**Also before Phase 1:** run the read-only data-audit SQL in Appendix C (it sizes rails and thresholds with real data), and confirm that the Figma account `whoami` reports (Starter team, Full seat) is the one to use.

---

## 1. Why this redesign

### 1.1 The customer app today

Traced from the code on 2026-10-05:

| Screen | Route | File (lines) | Header | Loading UI | Notes |
|---|---|---|---|---|---|
| Home / storefront | `/` | [`DiscoveryPage.tsx`](../pages/discovery/DiscoveryPage.tsx) (1,174) | `AppTopBar` | Card skeletons | Owns the geolocation engine, search, category filter, cart bar and nine empty states |
| Restaurant | `/restaurants/:id` | [`RestaurantMenu.tsx`](../pages/restaurants/RestaurantMenu.tsx) (503) | Marketing `Navbar` | "Loading menu…" text | Behind a login wall. Hero uses the single legacy `image_url`. Flat menu. |
| Checkout | `/checkout` | [`Checkout.tsx`](../pages/checkout/Checkout.tsx) (1,155) | `Navbar` | A skeleton for the delivery-fee line only | The Place Order button sits at the end of a long page and isn't sticky |
| Order status | `/orders/:id` | [`OrderStatus.tsx`](../pages/orders/OrderStatus.tsx) (616) | `Navbar` | "Loading order…" | Tracker labels are raw enum text ("out for delivery") |
| Orders | `/orders` | [`OrderHistory.tsx`](../pages/orders/OrderHistory.tsx) (210) | `Navbar` | "Loading…" | Badge text is raw enum text |
| Offers | `/coupons` | [`CouponsPage.tsx`](../pages/coupons/CouponsPage.tsx) (323) | `Navbar` | "Loading offers…" | |
| Profile | `/profile` | [`Profile.tsx`](../pages/profile/Profile.tsx) (238) | `Navbar` | none | No log-out, help, legal or address rows on the page itself |
| Review | `/orders/:id/review` | [`OrderReview.tsx`](../pages/orders/OrderReview.tsx) (304) | `Navbar` | "Loading…" | |

### 1.2 Problems found

1. **Two navigation systems.** Home has an app header. Every other customer screen uses the website `Navbar` with a hamburger. There is no persistent navigation, so Orders, Offers and Profile hide behind the avatar menu.
2. **The login wall arrives early.** `/restaurants/:id` is wrapped in `ProtectedRoute`, which redirects to `/login` without a return path. A logged-out visitor's first restaurant tap ends on the login page, and after login they land on Home (this is the OTP plan's §1.1 finding).
3. **No design system.** Only `Hero.css` uses CSS variables. The rest of the code repeats hard-coded values:
   - 9 copies of `formatPrice` and 2 of `formatDistance`;
   - 7 spellings of the same two font stacks;
   - about 10 border radii (12, 8, 10, 14, 16, 9, 6, 20, 24, 18 px);
   - 65 `@keyframes` blocks across 62 CSS files, 16 of them separate spinners;
   - six near-identical light-red tints (`#fdecea`, `#fdedec`, `#fef2f2`, `#fde8e8`, `#fce5e2`, `#fff5f4`) and red-tinted shadows chosen per file.
4. **Accessibility gaps.**
   - Muted text colours fall below AA for small text: `#9ca3af` (2.5:1), `#9a9189` (3.1:1), `#8a8178` (3.8:1).
   - Veg and non-veg are told apart only by colour, and the veg green `#2ECC71` sits at 2.1:1.
   - Modals restore focus but don't trap it.
   - Android's hardware back leaves the page instead of closing an open sheet.
5. **Loading, empty and error states are inconsistent.** Six screens show plain "Loading…" text. A deep link to a closed restaurant renders "Something went wrong. Not found."
6. **Order screens degrade when a kitchen is closed.** Customers can read only open restaurants and their available dishes (RLS). After closing time, order history says "Restaurant", the order page shows no restaurant name, items read "Item", and the veg mark falls back to **non-veg** (§18 F1).
7. **Checkout hides its own blockers.** When Place Order is disabled, the reason is in another section that may be off-screen.
8. **No scroll management.** There's no `ScrollRestoration` (it needs a data router) and no `scrollTo`, so a new page can open at the previous page's scroll offset. Verify in the Phase 0 baseline.
9. **Image rules drifted.** The restaurant page shows one legacy image, while cards show a five-image slideshow. `models.ts` calls promo media "1:1", but the carousel renders 16:9.
10. **The index chunk is heavy** (390.6 kB raw, about 124 kB gzip), because the storefront is eager. The redesign must not grow it (§12).

### 1.3 What this is not

- **Not a backend change.** No migration, RLS, RPC or Edge Function. Queries may *add* columns that existing grants already allow (§3).
- **Not a logic rewrite.** Pricing, coupons, the geofence, order placement, cancellation, reviews, push, the geolocation engine and auth stay as they are (§15.4).
- **Not the owner dashboard.** `/dashboard*` is untouched. It may adopt the tokens later, under a separate plan.
- **Not the login redesign.** `/login`, `/signup`, `/verify-phone`, `/auth/callback` and `/reset-password` belong to the OTP plan. This plan gives that work tokens and primitives to build with (§8.9).
- **Not dark mode, Hindi or iOS native.** Tokens are structured so dark mode can be added later (§5.1), but this plan ships light only.

---

## 2. The brief vs. what RedLotus actually is

The brief is generic. These are the places where it doesn't match this codebase, and what wins.

| The brief asks for | Reality in RedLotus | This plan |
|---|---|---|
| "Preserve the existing Razorpay/payment integration"; a "Pay ₹249" button | There is no payment integration. v1 is cash on delivery only (CLAUDE.md product constraints; Razorpay deferred in `capacitor_native_apps_plan.md` §7). | No payment UI. The CTA stays "Place order · ₹X", and a static "Cash on delivery" row explains payment. Nothing to preserve. |
| A "pays" step in the critical flow | Placing an order is the confirm dialog → `place_order` | Verification reads "places the order (COD)" (§15.2). |
| "Taxes if applicable" | `CartPricing` has no tax line | No tax row. |
| "Payment methods if supported" in Profile | Not supported | Omitted. |
| Delivery time on restaurant cards | No per-restaurant field. ETA is per order, set by the owner at accept time (`orders.eta_minutes`). | Cards show distance. Tracking shows the owner's ETA. |
| "Price information" (cost for two) | Not modelled | Omitted. |
| Menu categories on the restaurant page | Menu-item categories are a v2 deferral (`menu_items` has no category) | A toolbar, "Top rated here" and the full list. The category jump list is designed but hidden until a column exists. |
| "Popular dishes", "Popular near you", "Top picks for you", "Fast delivery" | No client-readable popularity or preparation-time data | Only "Featured" (admin flag) and "Top rated" (ratings, D12) are built. |
| "Popular searches" | No search analytics exist | "Explore categories", from the admin-curated `menu_categories`. Never labelled "popular". |
| A notification icon | No in-app notification inbox; push only | No bell. |
| A "Pickup" tracker step | Statuses run pending → accepted → preparing → out_for_delivery → completed | "On the way" covers pickup. No invented step. |
| Timestamps for every tracker step | Only `created_at` and `accepted_at` are stored | Those two steps show times; the others are untimed. |
| "Preserve Phone OTP" | MSG91 phone verification (`/verify-phone`) is live. OTP *login* is a separate plan. | Untouched (§8.9). |
| Coupon "Apply" buttons; "never validate coupons only on the client" | Coupons are already validated by the server (`preview_coupon`, `place_order` v5) | UI only. Every apply still goes through `preview_coupon`. |
| Add-to-cart animation and button feedback | The shipped binary has no haptics plugin | Visual feedback only. Haptics would need a store build (§16.3). |
| "Use the existing logo and brand assets" | `public/logo-mark.svg` (the same mark as the launcher icon) and a wordmark set in DM Serif Display. The Play Store graphics use a different bold sans wordmark. | Use `logo-mark` and the current wordmark. The store-graphics wordmark is a brand question (§18 F6). |
| Copy that calls it a "mobile app" | CLAUDE.md copy rule: never "app", "download" or "install" (the web-only `InstallPrompt` excepted) | Copy stays neutral. |
| A "Search" tab | Search lives inside Home today | A new `/search` route (D2). |

---

## 3. UI → data contract

Every element below maps to a real source. **Real** = read as stored. **Derived** = computed on the client from real fields. Nothing in this table needs a schema change.

| Screen | Element | Source | Kind |
|---|---|---|---|
| Home | Location label | `locationCache` label ← `reverseGeocode()` (Nominatim), or a saved address's label, or "Gudha Gorji" (`VILLAGE_LABEL`) | Real |
| Home | Avatar or "Log in" | `AuthContext.profile` | Real |
| Home | Promo carousel | `promotions` (RLS publishes only live rows), image or muted video, optional `link_url` | Real, hidden when empty |
| Home | Category chips | `menu_categories` (`image_url`, or the existing emoji fallback) | Real |
| Home | Offer strip | `discount_config` (`isLive`), plus `delivery_config` free-delivery minimum and distance. The delivery half is omitted while the config is null (Principle 1). | Real |
| Home | Featured rail | `restaurants.is_featured` / `featured_rank`, intersected with the nearby set | Real |
| Home | Top rated rail | `restaurants.rating_avg` / `rating_count`, intersected with the nearby set (D12) | Derived |
| Home | Restaurant cards | `name`, `cuisine_type`, `address`, `image_urls` → `image_url` (`getCardImages`), rating, distance (haversine from the browse origin), restaurant-specific offer (`list_offers` → `bestOfferFor`), featured tag | Real / derived |
| Home | "N restaurants near you" | Size of the nearby set | Derived |
| Home, Search, Restaurant | Cart bar | `CartContext`: item count and **item total only** (no address yet, so no fee) | Real |
| Search | Recent searches | `localStorage`, this device only; the customer's own input | Real |
| Search | Suggestions and results | Nearby restaurants (`restaurantMatches`) and dishes fetched with `.in(nearbyIds)` (`dishMatches`). The token-AND matcher is unchanged. | Real |
| Restaurant | Hero | `image_urls` (slideshow) → `image_url` → placeholder. Needs `image_urls` added to the select; it is in the anon column grant. | Real |
| Restaurant | Name, cuisine, address, rating, reviews | `restaurants`, `restaurant_reviews` (`listRestaurantReviews`) | Real |
| Restaurant | Distance; "doesn't deliver to your location" notice | Haversine from the browse origin to `lat` / `lng`, compared with `delivery_radius_km`. Needs those three added to the select; all are anon-granted. | Derived |
| Restaurant | Offer chips | `discount_config`, `delivery_config`, `list_offers` (`bestOfferFor`). Copy logic moves verbatim. | Real |
| Restaurant | Menu | `menu_items` (RLS returns available dishes only): name, description, price, `image_url`, `is_veg`, rating | Real |
| Restaurant | "Top rated here" | `menu_items.rating_avg` / `rating_count` (D12) | Derived |
| Checkout | Everything | Unchanged sources: `CartContext`, `computeCartPricing`, `delivery_config`, `discount_config`, restaurant geo, `delivery_addresses`, coupons (`preview_coupon`, `list_offers`) | Real |
| Order tracking | Status, ETA, items, bill, address | `orders` + joins, Realtime `UPDATE`, `computeEtaWindow`, the stored fee snapshot, `receiptDiscountLine` | Real |
| Order tracking | Step times | `created_at` (placed) and `accepted_at` (accepted) only | Real |
| Orders | Cards | Today's select. An optional item summary adds `order_items(quantity, menu_items(name))`; customers can read their own `order_items`. | Real |
| Offers | Lists, checker, referral | `list_offers`, `preview_coupon`, `get_my_referral_code` | Real |
| Offers | Festival and free-delivery cards | `discount_config` (when live), `delivery_config` | Real |
| Profile | Header | `users`: `full_name`, `phone`, `phone_verified`, `email` | Real |
| Profile | Saved addresses | `delivery_addresses` via `addressBook.ts` | Real |
| Profile | Version line | `VITE_APP_VERSION` (package.json) | Real |

### 3.1 Data gaps: designed for, but not shown

| Gap | How the UI handles it now | What would make it real (not in this plan) |
|---|---|---|
| Menu categories / sections | Hidden. The jump-list component is designed in Figma only. | A `menu_items.section` column or a `menu_sections` table (v2 "menu-item categories") |
| Delivery-time estimate per restaurant | Distance only | A server-side estimate, e.g. the median of past `eta_minutes` per restaurant through a SECURITY DEFINER RPC |
| Popular dishes / restaurants | Not built | A SECURITY DEFINER RPC returning order counts per dish (no personal data) |
| Timestamps for preparing, on the way and delivered | Untimed steps | Stamp columns or a status-history table |
| Live rider location | Not built | v2 delivery tracking |
| Notification inbox | No bell | A notifications table (v2) |
| Reorder | Not built | A current-price and availability check before refilling the cart, so stored `unit_price` snapshots are never reused |
| Cost for two | Not shown | A new restaurant column |
| Order screens for closed restaurants | Neutral fallbacks (§8.5) | §18 F1 |

---

## 4. Design direction

### 4.1 Principles

1. **Food first.** Photos and dish names carry each screen. Chrome stays quiet.
2. **One accent.** Brand red marks primary actions, the active tab, offers and selection. Green appears only for veg, success and live order progress.
3. **Honest UI.** Every element maps to data (§3). Missing data means a missing element, never a filled-in guess.
4. **Thumb first.** Primary actions sit in the bottom third of the screen, in sticky bars. Touch targets are at least 44 px (48 px for navigation).
5. **Fast on cheap phones.** Motion is CSS only, there are no new runtime dependencies, and skeletons match the layout they stand in for.
6. **Calm density.** 16 px side gutters, an 8-point rhythm and lightly elevated cards. Lists, not grids, on phones.
7. **One system everywhere.** Tokens and primitives only; no per-screen colours.
8. **A local voice.** Short, plain, warm English that knows it serves Gudha Gorji.

### 4.2 What makes it RedLotus and not Zomato

| Pattern borrowed from food-delivery apps | RedLotus treatment |
|---|---|
| A location-first header | The lotus mark, then "Your location ▾" and the locality, on warm white |
| Circular category thumbnails | A warm ring around each circle. Local dishes (Thali, Dal Baati) lead, in admin order. |
| Restaurant feed cards | The existing image slideshow, a gold star, a distance chip, and an offer badge with a **ticket notch**: the coupon-ticket motif used as a brand device |
| An ADD button overlapping the dish photo | A brand-outlined ADD that becomes a lotus-red stepper |
| A floating cart bar | A brand-red bar showing the item count and item total |
| The bill summary | A receipt card with a ticket edge, the same motif again |
| The order tracker | A vertical stepper. The live step is green with a soft pulse (none under reduced motion). |
| Green rating badges | A gold star and the number (D16) |
| A white or grey canvas | A warm off-white page (`#FDF8F6`) under white surfaces |
| A neutral system font | Plus Jakarta Sans for the UI, DM Serif Display for the wordmark and editorial moments (D8) |

### 4.3 Imagery, icons, voice and formats

**Imagery**

- Restaurant photos are uploaded at 4:3 (`design.md`). The feed card can show them at 16:9 (denser: about 2.3 cards per screen at 360 px instead of about 1.8) or at 4:3 (no cropping). **Decide in Figma with real photos in Phase 4**; the ratio is a single token in code.
- Dish photos render square at 96–112 px. Owner uploads are already compressed below 115 KB.
- Placeholders are a sunken neutral surface with the lotus mark at about 20 % opacity. **Never** stock food photos.
- Promo media is 16:9: what `PromoCarousel` renders today. The "1:1" wording in `models.ts` and migration 017 is stale. Admins should upload at 1280 × 720 and keep text inside the central 80 %.
- Category thumbnails are 1:1 circles. The emoji fallback stays for categories without an image.

**Icons**

- `lucide-react` only. Stroke 2 at 16–24 px; stroke 1.5 for decorative icons of 32 px and up.
- No emoji in UI chrome. The category fallback is the one exception.

**Voice.** Sentence case, short, warm and specific. Examples:

| Today | Redesign |
|---|---|
| "View Cart →" | "View cart" |
| "Back to Restaurants" | A back-arrow icon button labelled "Back" |
| "out for delivery" (raw enum) | "On the way" |
| "Loading menu…" | A skeleton |
| "Something went wrong. Not found." (restaurant) | "This kitchen isn't taking orders right now." |

The full status sentences in `OrderStatus` (`STATUS_MESSAGES`) stay as they are; §8.5 adds short labels beside them.

**Formats** (one helper each, in `src/lib/format.ts`)

- Money: ₹180, ₹180.50 (`formatRupees`; the same output as today's `formatPrice`).
- Distance: 350 m, 1.2 km.
- Time (IST): 7:45 PM.
- Date and time: 19 Jul, 10:59 PM.

---

## 5. Design system: tokens

### 5.1 Architecture

- **Three new files** under `src/styles/`, imported once in `main.tsx` before `index.css`:
  - `tokens.css`: CSS custom properties only (Appendix A);
  - `base.css`: element defaults (page background, font, `:focus-visible` ring, tabular numerals, `color-scheme: light`, the global reduced-motion rule);
  - `motion.css`: the shared keyframes (`rl-spin`, `rl-shimmer`, `rl-fade-in`, `rl-sheet-up`, `rl-pop`, `rl-pulse`).
- **Name parity with Figma.** CSS name = `--rl-` + the Figma variable path with `/` replaced by `-`. So `color/brand/primary` is `--rl-color-brand-primary`. Every Figma variable's WEB code syntax is `var(--rl-…)`, which makes `get_design_context` emit our real tokens.
- **Light only.** Figma uses a single mode called "Light". Dark mode later means a second mode plus a `[data-theme="dark"]` block. Note: the Android `AppTheme.NoActionBar` is a DayNight theme, so on a phone in dark mode the WebView may report `prefers-color-scheme: dark`. **Never add `prefers-color-scheme` rules casually**; `base.css` declares `color-scheme: light`.
- **No big-bang migration.** Existing component CSS is left alone until its phase rewrites that screen. New code uses only tokens; a stylelint-style grep check in review rejects raw hex in new files.

### 5.2 Colour

Values are consolidated from today's CSS (use counts in brackets). Contrast ratios were computed with the WCAG formula; re-check them with a contrast tool in Phase 1.

| CSS token | Figma variable | Value | From today | Use | Contrast |
|---|---|---|---|---|---|
| `--rl-color-brand-primary` | `color/brand/primary` | `#D63031` | `red` (168) | Primary buttons, active tab, ADD, links, focus ring | 4.9:1 on white, 4.6:1 on page; white text on it 4.9:1 |
| `--rl-color-brand-pressed` | `color/brand/pressed` | `#B71C1C` | `redDark` (55) | Pressed and hover; text on brand-soft | 5.8:1 on brand-soft |
| `--rl-color-brand-soft` | `color/brand/soft` | `#FDECEA` | (19) | Selected chips, offer strips, soft badges | n/a |
| `--rl-color-brand-border` | `color/brand/border` | `#F5C2C2` | (8) | Borders on brand-soft surfaces | decorative |
| `--rl-color-text-on-brand` | `color/text/on-brand` | `#FFFFFF` | | Text and icons on brand | 4.9:1 |
| `--rl-color-text-primary` | `color/text/primary` | `#1A1A1A` | `charcoal` (212) | Headings, body | 17:1 |
| `--rl-color-text-secondary` | `color/text/secondary` | `#4A4A4A` | `slate` (175) | Supporting text | 8.9:1 |
| `--rl-color-text-tertiary` | `color/text/tertiary` | `#6F665E` | **new**: replaces `#8a8178`, `#9a9189` and `#9ca3af` wherever they colour text | Meta text: distance, timestamps, hints | 5.6:1 on white, 5.3:1 on page |
| `--rl-color-text-disabled` | `color/text/disabled` | `#9A9189` | (9) | Disabled labels only | exempt |
| `--rl-color-bg-page` | `color/bg/page` | `#FDF8F6` | `warmBg` (33) | Page canvas | |
| `--rl-color-bg-surface` | `color/bg/surface` | `#FFFFFF` | (247) | Cards, bars, sheets | |
| `--rl-color-bg-sunken` | `color/bg/sunken` | `#F1ECE7` | (7) | Image placeholders, skeleton base, input fill | |
| `--rl-color-bg-scrim` | `color/bg/scrim` | `rgba(26,26,26,.4)` | (6) | Behind sheets and dialogs | |
| `--rl-color-border-default` | `color/border/default` | `#E8E2DC` | `border` (134) | Card borders, dividers | decorative |
| `--rl-color-border-subtle` | `color/border/subtle` | `#F0EBE5` | (10) | Row separators | decorative |
| `--rl-color-border-strong` | `color/border/strong` | `#8A8178` | (7) | Input, radio and stepper outlines | 3.8:1 on white, 3.6:1 on page (UI parts need ≥ 3:1) |
| `--rl-color-success` | `color/status/success` | `#1F7A3A` | (12) | Success text and icons, the live tracker step, "You save" | 5.4:1 |
| `--rl-color-success-soft` | `color/status/success-soft` | `#EAFCE8` | (2) | Success backgrounds | success text on it 5.0:1 |
| `--rl-color-warning` | `color/status/warning` | `#8A5A00` | (11) | Pending text and icons | 5.9:1 |
| `--rl-color-warning-soft` | `color/status/warning-soft` | `#FFF8EE` | (8) | Pending backgrounds | |
| `--rl-color-warning-border` | `color/status/warning-border` | `#F3D68A` | (8) | Pending borders | |
| `--rl-color-danger` | `color/status/danger` | `#C0392B` | `redAccent` (85) | Errors, destructive actions | 5.4:1 |
| `--rl-color-danger-soft` | `color/status/danger-soft` | `#FEF2F2` | (6) | Error backgrounds | |
| `--rl-color-danger-border` | `color/status/danger-border` | `#FECACA` | (6) | Error borders | |
| `--rl-color-neutral-soft` | `color/status/neutral-soft` | `#F5F0ED` | (7) | Cancelled badge, neutral chips | |
| `--rl-color-veg` | `color/food/veg` | `#1F7A3A` | (12) | Veg mark (D9) | 5.4:1 |
| `--rl-color-nonveg` | `color/food/non-veg` | `#8B4513` | **new**: FSSAI brown (D9) | Non-veg mark | 7.1:1 |
| `--rl-color-star` | `color/rating/star` | `#F5A623` | `starGold` (13) | Star glyph, always next to the number | decorative |

**Retired for text and marks:** `#E74C3C` (non-veg red / error), `#2ECC71` (veg green), `#F39C12` (pending), `#3498DB` (active) and `#27AE60` (success). All are below 3:1 on white. Blue leaves the customer palette entirely: live statuses become green, as the brief suggests. (The owner dashboard keeps its own colours; it is out of scope.)

**Rules**

- Text on `brand-soft` uses `brand-pressed`. Brand red on brand-soft is only 4.3:1.
- At most one brand-filled button per screen region.
- Error states never rely on hue alone: always an icon plus the soft background.
- Shadows are neutral-tinted. The single brand-tinted shadow is reserved for the cart bar and the primary CTA.

### 5.3 Typography

| Token set (`--rl-type-*`) | Size / line height | Weight | Family | Use |
|---|---|---|---|---|
| `display` | 28 / 34 | 400 | DM Serif Display | The wordmark lock-up and rare editorial headings |
| `title-lg` | 22 / 28 | 700 | Plus Jakarta Sans | Tab-screen titles; the restaurant name on its page |
| `title-md` | 18 / 24 | 700 | Plus Jakarta Sans | Section headers |
| `title-sm` | 16 / 22 | 700 | Plus Jakarta Sans | Card titles, dish names |
| `body-lg` | 16 / 24 | 400 / 500 | Plus Jakarta Sans | Inputs (16 px stops iOS Safari zooming on focus), important body text |
| `body-md` | 14 / 20 | 400 / 500 | Plus Jakarta Sans | Default body |
| `body-sm` | 13 / 18 | 400 / 500 | Plus Jakarta Sans | Secondary text, dish descriptions |
| `label-md` | 14 / 20 | 600 | Plus Jakarta Sans | Buttons, tabs |
| `label-sm` | 12 / 16 | 600 | Plus Jakarta Sans | Chips, badges, bottom-nav labels |
| `caption` | 12 / 16 | 400 / 500 | Plus Jakarta Sans | Meta text, timestamps |
| `micro` | 11 / 14 | 600 | Plus Jakarta Sans | Overlines and badge text only, never body text |

- Weights stay 400–700 (what is loaded today). No 800.
- Prices, quantities and bill rows use `font-variant-numeric: tabular-nums`.
- In Figma these are text styles named `Display`, `Title/LG`, `Title/MD`, `Title/SM`, `Body/LG`, `Body/MD`, `Body/SM`, `Label/MD`, `Label/SM`, `Caption` and `Micro`, with sizes bound to number variables.
- **Text scaling.** The Android WebView typically applies the phone's font-size setting to page text. Layouts must survive 130 % text: no fixed heights on text containers, and test with the system font set to Large (§15.3).

### 5.4 Space, layout and breakpoints

| Group | Tokens |
|---|---|
| Space (4-point base, 8-point rhythm) | `--rl-space-0-5` 2 · `-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 20 · `-6` 24 · `-8` 32 · `-10` 40 · `-12` 48 · `-16` 64 |
| Gutters | `--rl-gutter` 16 px (< 768), 24 px (768–1023), 32 px (≥ 1024) |
| Widths | `--rl-content-max` 1200 px (Home grid) · `--rl-reading-max` 720 px (single-column screens on desktop) |
| Bars | `--rl-header-height` 56 · `--rl-bottomnav-height` 56 · `--rl-cartbar-height` 56 · `--rl-sticky-cta-height` 72 (all plus safe areas) |
| Touch | `--rl-touch-min` 44 · `--rl-touch-nav` 48 |
| Breakpoints | 480 / 768 / 1024 px, the same as today. CSS can't use variables inside media queries, so these are documented constants. |

Design at **360 × 800** (the worst common Android width). Verify at 412 × 915, 768 × 1024 and 1280 × 800. Layouts must not scroll sideways at 320 px.

### 5.5 Radius, borders and elevation

| Token | Value | Use |
|---|---|---|
| `--rl-radius-xs` | 6 px | Badges, veg marks |
| `--rl-radius-sm` | 8 px | Chips, small buttons, thumbnails |
| `--rl-radius-md` | 12 px | Buttons, inputs, dish images, the cart bar |
| `--rl-radius-lg` | 16 px | Cards |
| `--rl-radius-xl` | 24 px | Sheet top corners, hero cards |
| `--rl-radius-full` | 999 px | Pills, avatars, category circles |
| `--rl-border-width` | 1 px | Everywhere. 1.5 px for veg marks and focus rings at 2 px. |
| `--rl-shadow-1` | `0 1px 2px rgba(26,26,26,.06), 0 1px 3px rgba(26,26,26,.04)` | Resting cards |
| `--rl-shadow-2` | `0 4px 12px rgba(26,26,26,.08)` | Sticky bars, menus, raised cards |
| `--rl-shadow-3` | `0 12px 32px rgba(26,26,26,.16)` | Sheets and dialogs |
| `--rl-shadow-brand` | `0 6px 16px rgba(214,48,49,.28)` | The cart bar and the primary CTA only |

### 5.6 Motion

| Token | Value |
|---|---|
| `--rl-duration-fast` | 120 ms (press feedback, small state changes) |
| `--rl-duration-base` | 200 ms (fades, stepper morph, header colour) |
| `--rl-duration-slow` | 320 ms (sheets, page transitions) |
| `--rl-ease-standard` | `cubic-bezier(.2, 0, 0, 1)` |
| `--rl-ease-decelerate` | `cubic-bezier(0, 0, 0, 1)` (entering) |
| `--rl-ease-accelerate` | `cubic-bezier(.3, 0, 1, 1)` (leaving) |

Under `prefers-reduced-motion: reduce`, durations drop to 0 ms and shimmer and pulse stop. The JavaScript slideshows (`RestaurantCardSlideshow`, `PromoCarousel`) already check reduced motion themselves.

### 5.7 Layers and sizes

| Token | Value | Layer |
|---|---|---|
| `--rl-z-sticky` | 20 | Sticky sub-headers (menu toolbar) |
| `--rl-z-cartbar` | 30 | Cart bar, sticky CTA |
| `--rl-z-bottomnav` | 40 | Bottom navigation |
| `--rl-z-header` | 50 | App header |
| `--rl-z-overlay` | 100 | Sheets, dialogs, the location disclosure |
| `--rl-z-toast` | 200 | Toasts |
| `--rl-z-offline` | 300 | The offline banner (as today) |
| Icon sizes | 16 · 20 · 24 (32 · 40 for empty states) | |

### 5.8 Migration rules

1. Tokens land in Phase 1 with no visible change, except the page background and font smoothing in `base.css`; screenshot-check every customer screen.
2. A screen moves to tokens only in the phase that redesigns it. Owner and marketing CSS are not touched.
3. Raw hex, pixel radii and one-off shadows aren't allowed in new or rewritten CSS. Use tokens.
4. Shared keyframes replace per-file copies when a file is rewritten. The 16 spinners become `rl-spin`.
5. Any token change happens in `tokens.css` **and** the Figma variable in the same session, and is recorded in Appendix B's changelog.

---

## 6. Component architecture

### 6.1 Folder layout

```
src/
  styles/        tokens.css · base.css · motion.css                 (NEW)
  components/
    ui/          primitives: Button, IconButton, Chip, Badge, VegMark, RatingPill,
                 AddToCartControl, SearchField, Sheet, Dialog, Skeleton,
                 EmptyState, InlineNotice, SectionHeader, ListRow,
                 SegmentedControl, Avatar, Card                       (NEW)
    shell/       CustomerShell, BottomNav, AppHeader, CartBar,
                 StickyActionBar, ScrollManager                       (NEW)
    restaurant/  RestaurantCard (+ skeleton), RestaurantHero, OfferStrip   (NEW)
    menu/        DishRow (+ skeleton), MenuToolbar                     (NEW)
    checkout/    BillDetails, CouponRow, AddressSection                (NEW)
    orders/      OrderStatusHero, OrderStatusTracker, OrderCard        (NEW)
    …existing    AddressPickerSheet, CouponTicket, StarRating, LocationDisclosure… (restyled)
  context/       BrowseContext.tsx                                     (NEW, §7.9)
  lib/           format.ts (+formatRupees, formatDistance) · orderStatus.ts · contact.ts ·
                 billLines.ts · checkoutGate.ts · navVisibility.ts · backStack.ts ·
                 recentSearches.ts · browseOrigin.ts                   (NEW or extended)
  pages/         search/SearchPage.tsx · profile/SavedAddresses.tsx    (NEW)
```

Conventions: each component has a co-located `.css` file (the repo's convention) with class prefix `rl-` for primitives (`.rl-btn`, `.rl-btn--primary`) and a component prefix for domain pieces (`.rcard__…`). There are no barrel files, there is no Tailwind and there is no new UI library.

### 6.2 Primitives

The **Figma name** column is the component's name in Figma, exactly. Variant properties in Figma use the React prop names.

| Figma name | React | Variants / key props | Replaces today | Notes |
|---|---|---|---|---|
| `Button` | `ui/Button.tsx` | `variant` primary · secondary · tertiary · danger; `size` sm 36 · md 44 · lg 52; `loading`; `fullWidth`; `iconStart` / `iconEnd` | About 30 one-off button classes (`checkout__submit`, `rlist__empty-retry`, `cpage__use`…) | `loading` shows a spinner and sets `aria-busy`; the label stays for screen readers |
| `IconButton` | `ui/IconButton.tsx` | `variant` plain · tonal · overlay (on images); `size` 40 · 44 | The close and back buttons in sheets and headers | `aria-label` is required by the TypeScript type |
| `Chip` | `ui/Chip.tsx` | `selected`, leading icon, count | `rlist__vegchip`, text filter chips | `aria-pressed` |
| `Badge` | `ui/Badge.tsx` | `tone` brand · success · warning · danger · neutral; `size` sm · md | `ohist__badge*`, `disc__featured-badge`, `cticket__tag` | Text plus colour, never colour alone |
| `VegMark` | `ui/VegMark.tsx` | `kind` veg · nonveg; `size` 14 · 16 | Four separate veg-dot implementations | `role="img"` with "Vegetarian" or "Non-vegetarian". **Renders nothing when `is_veg` is unknown** (§18 F1). |
| `RatingPill` | `ui/RatingPill.tsx` | `avg`, `count`, `size` | `disc__card-rating`, `rmenu__item-rating` | Uses `ratings.ts`; shows "New" when the count is 0 |
| `AddToCartControl` | `ui/AddToCartControl.tsx` | `quantity` (0 shows ADD); `size` sm · md; `placement` inline · overlay; `disabled` | `rlist__dish-add` / `stepper`, `rmenu__add` / `stepper`, `checkout__stepper` | Calls the existing `addItem` / `updateQuantity`; going below 1 removes the item, as today. The hit area is ≥ 44 px even when the visual height is 32 px. |
| `SearchField` | `ui/SearchField.tsx` | `mode` input · button; clear; `enterKeyHint="search"` | `rlist__search` | Button mode navigates to `/search` |
| `Sheet` | `ui/Sheet.tsx` | `title`, `dismissible`, `initialFocusRef`, `busy` | The mechanics of `AddressPickerSheet` and `CouponSheet` | §6.5 |
| `Dialog` | `ui/Dialog.tsx` | `title`, body, primary / secondary actions, `tone`, `busy`, `initialFocus` | The mechanics of `ConfirmOrderModal`, `CancelOrderModal`, `DeleteAccountModal` and both replace-cart modals | Default focus stays on the **safe** action, as today |
| `Skeleton` | `ui/Skeleton.tsx` | `shape` rect · line · circle; size | `rlist__skeleton`, `checkout__skeleton` | `aria-hidden`; shimmer stops under reduced motion |
| `EmptyState` | `ui/EmptyState.tsx` | `tone` neutral · error; icon, title, body, primary and secondary actions, WhatsApp link | `rlist__empty`, `ohist__empty`, `cpage__empty` | The error tone takes an already-humanised message (§9) |
| `InlineNotice` | `ui/InlineNotice.tsx` | `tone` info · success · warning · danger; optional action | `checkout__pricing-error`, the coupon notices, `checkout__delivery-blocked` | `role="status"`, or `role="alert"` for danger |
| `SectionHeader` | `ui/SectionHeader.tsx` | title, count, action ("See all") | `rlist__section-head`, `disc__grid-head` | |
| `ListRow` | `ui/ListRow.tsx` | icon, title, subtitle, trailing (chevron · badge · check), link or button | `profile__link-card`, `apsheet__row` | Renders a real `<a>` or `<button>` |
| `SegmentedControl` | `ui/SegmentedControl.tsx` | options, value | new (Search results tabs) | `role="tablist"` |
| `Avatar` | `ui/Avatar.tsx` | initial; icon fallback | `topbar__avatar` | |
| `Card` | `ui/Card.tsx` | padding sm · md; elevation 0 · 1 | Many card classes | |

### 6.3 Shell components

| Figma name | React | Purpose |
|---|---|---|
| `Shell/BottomNav` | `shell/BottomNav.tsx` | Five tabs (D1); `<nav aria-label="Main">`; `aria-current="page"`; hidden by the rules in §7.3 |
| `Shell/AppHeader` | `shell/AppHeader.tsx` | `variant` home (logo, location, avatar) · stack (back, title, actions) · overlay (round icon buttons over the restaurant hero, turning solid on scroll). Replaces `AppTopBar` and, on customer screens, `Navbar`. |
| `Shell/LocationSelector` | part of `AppHeader` | "Your location ▾" plus the label; opens the existing `AddressPickerSheet` |
| `Shell/CartBar` | `shell/CartBar.tsx` | "N items · ₹X · View cart" (item total only), floating above the bottom nav on Home and Search and at the bottom on Restaurant; `aria-live="polite"` |
| `Shell/StickyActionBar` | `shell/StickyActionBar.tsx` | The bottom CTA container: safe-area and keyboard aware |
| none | `shell/ScrollManager.tsx` | Scroll to top on PUSH; restore on POP (§7.6) |
| none | `shell/CustomerShell.tsx` | The layout route (§7.2) |

### 6.4 Domain components

| Figma name | React | Replaces | Notes |
|---|---|---|---|
| `Restaurant/Card` (variants feed · rail · result) | `restaurant/RestaurantCard.tsx` | `DiscoveryPage.renderCard`, the `FeaturedRail` card markup | Keeps `RestaurantCardSlideshow` and `getCardImages` (feed and rail) |
| `Restaurant/Card skeleton` | `restaurant/RestaurantCardSkeleton.tsx` | `rlist__skeleton` | One per variant |
| `Restaurant/Hero` | `restaurant/RestaurantHero.tsx` | `rmenu__hero` | Slideshow from `image_urls` |
| `Offers/Strip`, `Offers/Chips` | `restaurant/OfferStrip.tsx` | `rlist__offer-strip`, `rmenu__offer-pill`, `rmenu__coupon-line` | The headline copy logic moves **verbatim** (it encodes Principle 1) |
| `Discovery/PromoCarousel` | existing `PromoCarousel.tsx` | | Restyle only |
| `Discovery/CategoryRail`, `Discovery/CategoryGrid` | existing `CategoryRail.tsx` + grid variant | | Chip taps navigate to `/search?c=slug` |
| `Menu/DishRow` (variants menu · search; with or without image) | `menu/DishRow.tsx` | `rmenu__item`, `rlist__dish` | §8.3 has the spec |
| `Menu/DishRow skeleton` | `menu/DishRowSkeleton.tsx` | "Loading menu…" | |
| `Menu/Toolbar` | `menu/MenuToolbar.tsx` | none | In-menu search and the veg toggle; sticky |
| `Coupon/Ticket` | existing `CouponTicket.tsx` | | API unchanged |
| `Checkout/CouponRow` | `checkout/CouponRow.tsx` | `checkout__coupon` | Labels are computed exactly as today |
| `Checkout/BillDetails` | `checkout/BillDetails.tsx` | The checkout lines, `cmodal__summary`, `orderst__breakdown`, `ohist__breakdown` | Takes `BillLine[]` from `lib/billLines.ts` (§8.4) |
| `Checkout/AddressSection` | `checkout/AddressSection.tsx` | `checkout__saved`, `checkout__new-address` | Same state, same radio semantics |
| `Orders/StatusHero` | `orders/OrderStatusHero.tsx` | `orderst__status-card`, `orderst__eta` | |
| `Orders/Tracker` | `orders/OrderStatusTracker.tsx` | `orderst__progress` | |
| `Orders/Card` | `orders/OrderCard.tsx` | `ohist__card` | |
| `Auth/SignInPanel` | `components/SignInPanel.tsx` | new (D5) | "Log in" carries `?next=` once the OTP plan ships it |
| `Profile/Header`, `Profile/AddressItem` | `profile/…` | `profile__form` header | |

### 6.5 The overlay contract (Sheet and Dialog)

All current overlays hand-copy the same mechanics. The primitives centralise them and add what's missing:

| Concern | Rule |
|---|---|
| Structure | Portal into `document.body`; `role="dialog"`, `aria-modal="true"`, labelled by its title |
| Focus | Moves to `initialFocusRef` (or the first focusable element), is **trapped** inside (new), and returns to the opener on close |
| Closing | ESC, backdrop tap, the close button and **Android hardware back** (new, §7.5). All are ignored while `busy` (today's `placing` / `locating` / `applying` rules). |
| Scroll lock | `body { overflow: hidden }` as today, with a nesting counter so a dialog over a sheet can't unlock the page early |
| Layout | A Sheet is bottom-anchored below 768 px (grabber, `max-height: 88dvh`, scrolling body, safe-area padding) and a centred card at 768 px and up. A Dialog is always centred. |
| Motion | The sheet slides up in 320 ms (decelerate); a dialog fades and scales from 0.96 in 200 ms; reduced motion means an instant fade |
| Nesting | Avoid it. A two-step flow uses steps inside one Sheet. Only a Dialog may sit over a Sheet. |

Each existing overlay keeps its own content and behaviour, including its default focus (for example, "Go back" in `ConfirmOrderModal` and "Keep my order" in `CancelOrderModal`).

### 6.6 Shared helpers

| File | What | Rule |
|---|---|---|
| `lib/format.ts` | `formatRupees` (the 9 `formatPrice` copies), `formatDistance` (2 copies), `formatClockIST`, `formatDateTimeIST`; `formatKm` stays | Output must be byte-identical to today's helpers; parity tests compare old and new on sample values |
| `lib/orderStatus.ts` | Short label, tone and tracker step for each `order_status` | Presentation only; `STATUS_MESSAGES` sentences stay |
| `lib/contact.ts` | WhatsApp numbers by purpose, support email, `waLink(number, message)` | Each surface keeps its current number until D17 is answered |
| `lib/billLines.ts` | `billLinesFromPricing(p, labels)` (checkout) and `billLinesFromOrder(order)` (receipts) → `BillLine[]` | Pure and tested. Receipts render from the order snapshot, never live config. |
| `lib/checkoutGate.ts` | `canPlaceOrder(inputs)`: today's `canPlace` expression moved **verbatim**; `checkoutBlocker(inputs)`: the first failing reason as copy | A test asserts `checkoutBlocker(x) === null` exactly when `canPlaceOrder(x)` (§8.4) |
| `lib/navVisibility.ts` | `shouldShowBottomNav(pathname, role, isDesktop)` | §7.3 matrix as tests |
| `lib/backStack.ts` | `pushBackHandler(fn)` → unregister; `runTopBackHandler()` | §7.5 |
| `lib/recentSearches.ts` | read / add / clear, max 8, case-insensitive dedupe, newest first | `localStorage`, wrapped in try/catch like `couponStorage` |
| `lib/browseOrigin.ts` | `decideFix(…)`: the pure decision table from `DiscoveryPage`'s `acceptFix` | §7.9 |

---

## 7. App shell and navigation

### 7.1 Route map

| Path | Today | After |
|---|---|---|
| `/` | `DiscoveryPage`, `AppTopBar`, search and category filter inline | Inside `CustomerShell`, **Home tab**. Search and categories open `/search`. Owner redirect kept. |
| `/search` | none | **NEW**, **Search tab** (D2): `?q=` for the query, `?c=` for a category slug |
| `/restaurants/:id` | `ProtectedRoute` + `Navbar` | Inside the shell, **public** (D4); overlay header; no tab bar |
| `/checkout` | `ProtectedRoute role="customer" requirePhoneVerified` + `Navbar` | Same guard; stack header; sticky footer; no tab bar |
| `/orders` | `ProtectedRoute` + `Navbar` | **Orders tab**; in-place sign-in panel when logged out (D5). While auth is still loading, show the skeleton, as `ProtectedRoute`'s loader does today. |
| `/orders/:id` | `ProtectedRoute` + `Navbar` | Same guard; stack header |
| `/orders/:id/review` | `ProtectedRoute requirePhoneVerified` + `Navbar` | Same guard; stack header; restyled |
| `/coupons` | Public + `Navbar` | **Offers tab**. The path stays: `?apply=` links already exist in banners, pushes and shares. |
| `/profile` | `ProtectedRoute` + `Navbar` | **Profile tab**; in-place sign-in panel when logged out (D5). `?setup=true` (the Google gate) still works, with the tab bar hidden. |
| `/profile/addresses` | none | **NEW** (D11): `ProtectedRoute role="customer"`; stack header |
| `/restaurants` | `Navigate` to `/` | Unchanged |
| Auth, marketing, legal, `/verify-phone`, `/dashboard*` | | **Unchanged and outside the shell** |

### 7.2 `CustomerShell`, a layout route

```tsx
// App.tsx (sketch). Paths are unchanged except the two new ones.
<Route element={<CustomerShell />}>
  <Route index element={<DiscoveryPage />} />
  <Route path="search" element={<SearchPage />} />
  <Route path="coupons" element={<CouponsPage />} />
  <Route path="orders" element={<OrderHistory />} />
  <Route path="profile" element={<Profile />} />
  <Route path="restaurants/:id" element={<RestaurantMenu />} />
  <Route path="checkout" element={<ProtectedRoute role="customer" requirePhoneVerified><Checkout /></ProtectedRoute>} />
  <Route path="orders/:id" element={<ProtectedRoute><OrderStatus /></ProtectedRoute>} />
  <Route path="orders/:id/review" element={<ProtectedRoute requirePhoneVerified><OrderReview /></ProtectedRoute>} />
  <Route path="profile/addresses" element={<ProtectedRoute role="customer"><SavedAddresses /></ProtectedRoute>} />
</Route>
```

```tsx
// shell/CustomerShell.tsx (sketch)
export default function CustomerShell() {
  const { pathname } = useLocation();
  const { profile } = useAuth();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const showTabs = shouldShowBottomNav(pathname, profile?.role, isDesktop);
  return (
    <BrowseProvider>                {/* §7.9: starts GPS only when a screen asks */}
      <ScrollManager />
      <div className={`shell${showTabs ? " shell--tabs" : ""}`}>
        <Outlet />
      </div>
      {showTabs && <BottomNav />}
    </BrowseProvider>
  );
}
```

- `DiscoveryPage` stays the eager import. The shell is small and goes in the index chunk. Every other screen stays lazy.
- Customers still never download the owner chunk.

### 7.3 When the bottom nav shows

| Condition | Bottom nav |
|---|---|
| Viewport ≥ 1024 px | Hidden; the desktop header carries the links |
| Role is `owner` | Hidden everywhere |
| Path is `/`, `/search`, `/orders`, `/coupons` or `/profile` (without `?setup=true`) | **Shown** |
| Any other path in the shell | Hidden (stack screens) |
| On-screen keyboard open | Hidden (§7.7) |

The tabs are ordinary `NavLink`s (history push), so the browser's back button works as people expect on the web. The cart bar stacks 8 px above the nav. The offline banner sits above both.

### 7.4 Headers

| Variant | Used on | Contents |
|---|---|---|
| `home` | `/` | Lotus mark (tap scrolls to top) · LocationSelector · avatar or "Log in". Sticky. The search field sits under it and can dock into the header on scroll (optional; decide in Figma). |
| `title` | `/search`, `/orders`, `/coupons`, `/profile` | Screen title (`title-lg`) and optional actions. On `/search` the title is the search input itself. |
| `stack` | Checkout, order detail, review, saved addresses | Back (`IconButton`), a title that truncates, optional actions (for example "Help" on order detail) |
| `overlay` | `/restaurants/:id` | Round back and search buttons over the hero. Past the hero it turns solid white and shows the restaurant name. |

### 7.5 Android hardware back

Today `NativeBridge` calls `history.back()` everywhere except `/` and `/dashboard`, where it minimises the app. The new rules, in order:

| Context | Back does |
|---|---|
| An overlay is open (Sheet, Dialog, the location disclosure) | Closes the top overlay through `runTopBackHandler()`. Ignored while it's busy. |
| Stack screen with history | `history.back()` |
| Stack screen opened cold from a push or App Link (no history) | Goes to its tab root: `/orders/:id` → `/orders`; `/restaurants/:id` → `/` |
| Tab root other than Home | `navigate("/", { replace: true })` |
| `/` or `/dashboard` | `minimizeApp()`, as today. Never `exitApp()`. |

Implementation: `lib/backStack.ts` keeps a stack of handlers. `Sheet` and `Dialog` push one on mount. `NativeBridge` checks the stack before applying the route rules. The OAuth return, App Links, push taps, splash and Capgo `notifyAppReady()` code paths are untouched. Web back behaviour doesn't change.

### 7.6 Scroll management

`ScrollManager` uses `useNavigationType()`:

- **PUSH**, or a **REPLACE** to a different path: scroll to the top.
- **REPLACE on the same path** (updating `?q=` on `/search`, stripping `?apply=` on `/coupons`): keep the position.
- **POP**: restore the position saved for that history entry (a `Map` keyed by `location.key`).

Home renders from `BrowseProvider`'s cached data immediately (§7.9), so a restored position lands on real content.

### 7.7 Safe areas, system bars and the keyboard

- **Native Android.** `@capawesome/capacitor-android-edge-to-edge-support` turns the system-bar insets into WebView margins, so `env(safe-area-inset-*)` reads 0 and **content can never draw under the status bar**. The overlay header therefore starts below the status strip. Figma frames must show a solid status strip, not a photo underneath.
- **System bar colours.** The plugin version in the binary (8.0.8) has `setStatusBarColor` and `setNavigationBarColor`. The shell sets the status strip to white (it sits against the white header) and the navigation strip to white when a bottom bar is visible, otherwise to the page colour. These are JavaScript calls, safe for OTA.
- **Web and iOS PWA.** Keep `env(safe-area-inset-*)` padding on every fixed bar (the viewport meta already has `viewport-fit=cover`).
- **Keyboard.** `@capacitor/keyboard` is compiled into the shipped binary but unused. Listen for its show and hide events to set `html[data-keyboard="open"]`; CSS then hides the bottom nav and sticky bars so they don't ride above the keyboard. On the web, use a `visualViewport` resize heuristic instead.
- **Verify on Android 15 and 16** that the keyboard doesn't cover focused inputs under edge-to-edge (checkout address and notes, the coupon code box). If it does, the fix is `Keyboard.resizeOnFullScreen: true` in `capacitor.config.ts`. That is a **store build** (§16.3), because plugin configuration lives in the native assets, not in the OTA bundle.
- Full-height layouts use `min-height: 100dvh` with a `100vh` fallback.

### 7.8 Tablet and desktop

- **768–1023 px:** the bottom nav stays; Home becomes a 2-column grid; single-column screens centre at `--rl-reading-max`.
- **1024 px and up:** no bottom nav. The `home` header becomes one bar: logo · location · inline search field · Home / Orders / Offers / Profile links · cart button. Home becomes a 3-column grid; Checkout puts bill details in a right column that sticks; sheets become centred cards.
- The web and PWA build gets the same redesign as the native app. Nothing is native-only except the back button, system bars and keyboard events.

### 7.9 Browse state shared by Home, Search and Restaurant

Today the geolocation engine, the restaurant fetch, the nearby filter, the listed-offers fetch and the lazy dish fetch all live inside `DiscoveryPage`. Search (D2) and the restaurant page's distance need them too, so they move into `BrowseProvider` (`src/context/BrowseContext.tsx`), mounted by `CustomerShell`:

```ts
type BrowseState = {
  origin: Coords | null; originLabel: string | null; locationError: LocationError | null;
  restaurants: RestaurantCard[]; restaurantsStatus: "loading" | "ready" | "error"; restaurantsError: string | null;
  nearby: VisibleEntry[];        // today's `visible`: in each restaurant's own radius, distance-sorted
  offers: CouponOffer[];         // list_offers(null), for the card offer lines
  dishes: DishRow[]; dishesStatus: "idle" | "loading" | "loaded" | "error"; ensureDishes(): void;
  retry(): void; override(): void; pick(coords: Coords, label: string | null): void;
};
```

**How the move is done**

1. **A pure move first.** Cut the state, effects and handlers from `DiscoveryPage` into the provider **unchanged**: the same constants, options, refs and cancellation flags. Commit that on its own and verify there is no behaviour change.
2. **Extract the decision table.** `acceptFix`'s decisions (escalate · inaccurate · keep cached within 500 m drift · accept) move into `lib/browseOrigin.ts` as a pure `decideFix()`, with unit tests for every row of `location_resilience_plan.md`'s edge-case table. The cache write stays in the hook, still first.
3. **Start lazily.** The provider does nothing until a screen calls `useBrowse()` (Home, Search, Restaurant). `/orders`, `/profile` and `/coupons` therefore never trigger an OS location prompt, and `LocationDisclosure` still precedes the first prompt on native.
4. **Keep data across screens.** The provider outlives route changes, so Restaurant → back → Home doesn't refetch. Restaurants are refetched when Home becomes visible and the last fetch is over 2 minutes old, and when the app resumes. (RLS hides closed kitchens, so a stale list could show one that just closed; the restaurant page handles that case, §8.3.)

**Invariants that must survive the move** (from `location_resilience_plan.md`, `customer_ui_revamp_plan.md` and CLAUDE.md)

- Coarse first (`enableHighAccuracy: false`, 8 s, 5-minute `maximumAge`). Escalate to precise (15 s) only when the coarse fix is worse than 1,000 m, or when it fails and there is no cache.
- Hydrate from the 24 h cache with zero spinner frames; a background refresh updates the origin only after more than 500 m of drift.
- The five `LocationError` states keep distinct copy and actions: retry and override where they apply, WhatsApp-only for `denied` and `unsupported`. Never collapse them into one banner.
- "Show restaurants anyway" seeds `VILLAGE_CENTRE` for the session only, with no cache write. A picker choice writes the cache with the 50 m synthetic accuracy.
- Reverse geocoding happens at most once per distinct fix (Nominatim's 1 request/second policy). The cached label is adopted on a cached load.
- A restaurant is shown only if `distance <= r.delivery_radius_km` (migration 021).
- On native, the disclosure gate comes before any OS prompt; "Not now" leads to the retriable `unavailable` state.
- Sign-out clears the coordinate cache, and now the recent searches too.
- Owners are redirected to `/dashboard` from `/`.

---

## 8. Screen specifications

Each screen lists its layout, behaviour, states, what must not change, and how to accept it. Wireframes are at 360 px.

### 8.1 Home (`/`)

```
┌────────────────────────────────────┐
│ ✿  Your location ▾          (A)    │  AppHeader/home
│    Gudha Gorji                     │  (A) = avatar, or "Log in"
│ ┌────────────────────────────────┐ │
│ │ 🔍 Search dishes or restaurants│ │  SearchField (button → /search)
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │        PROMO (16:9)            │ │  PromoCarousel — hidden when none live
│ └────────────────────────────────┘ │
│               ● ○ ○                │
│ What's on your mind?               │
│  (◯)   (◯)   (◯)   (◯)   (◯)  →    │  CategoryRail → /search?c=slug
│ Thali  Pizza Chinese Chaat Burger  │
│ ┌────────────────────────────────┐ │
│ │ % 11% OFF on ₹200+ · automatic │ │  OfferStrip (discount / delivery config)
│ │   Free delivery on ₹199+ ≤1.5km│ │
│ └────────────────────────────────┘ │
│ Featured near you              →   │  FeaturedRail (is_featured ∩ nearby)
│ ┌──────┐ ┌──────┐ ┌──────┐         │
│ Top rated near you             →   │  TopRatedRail (D12), hides when sparse
│ 16 restaurants near you            │
│ ┌────────────────────────────────┐ │
│ │ [ slideshow ]          1.2 km  │ │  Restaurant/Card feed
│ │ ▸₹50 OFF above ₹199            │ │  ticket-notch offer badge
│ │ Sharma Bhojnalaya      ★ 4.3   │ │
│ │ Rajasthani, Thali              │ │
│ └────────────────────────────────┘ │
├────────────────────────────────────┤
│ 🛒 2 items · ₹310       View cart  │  CartBar (only with items)
├────────────────────────────────────┤
│ Home  Search  Orders  Offers  Me   │  BottomNav (label for the 5th tab: "Profile")
└────────────────────────────────────┘
```

**Behaviour**

- The header's LocationSelector opens the existing `AddressPickerSheet` (GPS, saved addresses, "Browse all of Gudha Gorji"), restyled on `Sheet`.
- Tapping the search field navigates to `/search` with focus. Tapping a category chip navigates to `/search?c=<slug>`. Home no longer filters in place.
- **OfferStrip copy logic moves verbatim** from `DiscoveryPage` (`stripHeadline` / `stripSub`). The delivery half is omitted while `delivery_config` is null.
- **Cards show only restaurant-specific coupon offers** (`bestOfferFor`). The festival discount applies everywhere, so it appears once, in the strip.
- **Top rated rail (D12):** nearby restaurants with `rating_count >= 5`, sorted by average then count, at most 8; shown only when at least 3 qualify. The thresholds are constants in one file.
- The list is 1 column on phones, 2 at 768 px and 3 at 1024 px. The first card's lead image is eager with `fetchpriority="high"` (the likely LCP element); the rest are lazy.
- `InstallPrompt` (web only) and `LocationDisclosure` (native, first run) stay mounted here.

**States**

- **Loading:** header, search field, five category circles and three card skeletons.
- **Location:** the five location states, "none in range", "all closed" and "couldn't load". The configs and copy are today's, rendered with `EmptyState`.
- **Partial failure:** promos, categories and offers that fail to load simply hide, as today.

**Must not change:** everything in §7.9's invariant list; the featured rail rules (flag ∩ nearby, rank order, hide when none); the owner redirect.

**Acceptance**

- A returning visitor with a cached fix sees the list with no spinner frame.
- A first native run shows the disclosure before any OS prompt.
- No section ever renders an empty box.
- A category tap shows the same results today's inline filter would.
- Lighthouse mobile LCP is no worse than the Phase 0 baseline.

### 8.2 Search (`/search`, D2)

```
┌────────────────────────────────────┐
│ ←  [🔍 paneer tikka         ✕ ]    │  title header = search input (autofocus)
├────────────────────────────────────┤
│ IDLE:  Recent searches     Clear   │  recentSearches (this device)
│        ↺ biryani   ↺ pizza  …      │
│        Explore categories          │  CategoryGrid (menu_categories)
│        (◯) (◯) (◯) (◯) …           │
├────────────────────────────────────┤
│ TYPING (≥2 chars): suggestions     │  ≤ 6 rows: restaurant · cuisine · dish
├────────────────────────────────────┤
│ RESULTS: [ Dishes 12 | Restaurants 3 ]   SegmentedControl
│ [All] [Veg] [Non-veg]              │  Chips (dishes tab)
│ ▣ Paneer Tikka            [ ADD ]  │  Menu/DishRow (search variant)
│   Punjab Dhaba · 1.4 km  ₹220      │  restaurant line links to its menu
└────────────────────────────────────┘
```

- **Data.** Everything comes from `BrowseProvider`: nearby restaurants, plus dishes fetched lazily (`.in(nearbyIds)`) on first focus. That is today's query and scope, so dishes from other cities are never fetched.
- **Matching** uses `search.ts` and `categoryMatch.ts` unchanged (token-AND within a query; OR across a category's keywords). The query is debounced by 200 ms.
- **URL.** `?q=` mirrors the submitted query, written with `replace` so it doesn't push on every keystroke. `?c=` shows a "Showing Pizza near you · Clear" banner.
- **Recent searches** are saved on submit or when a result or suggestion is tapped, never per keystroke. Max 8, cleared on sign-out (an additive line in `AuthContext.signOut`).
- **Default tab** is Dishes when there are dish results, otherwise Restaurants.
- **Adding from results** keeps today's logic: Add, then a stepper; adding from a second restaurant opens the replace-cart `Dialog` (same copy).

**States**

- No location yet: the compact location prompt with the picker, or the same location states as Home.
- Dishes loading: dish-row skeletons.
- Dishes failed: "Couldn't load dishes — restaurant results still shown" (today's copy).
- No results: today's `noMatchConfig` and `noCategoryConfig` copy, with the WhatsApp link and category suggestions.

**Acceptance:** for any query, results equal today's inline results (same sets, same distance-then-name order); the veg filter matches today's.

### 8.3 Restaurant (`/restaurants/:id`)

```
┌────────────────────────────────────┐
│ (←)                        (🔍)    │  AppHeader/overlay over the hero
│ [   image_urls slideshow 16:9    ] │  Restaurant/Hero
│ ┌────────────────────────────────┐ │
│ │ Sharma Bhojnalaya      ★ 4.3   │ │  info card (title-lg)
│ │ Rajasthani, Thali      (128)   │ │
│ │ 1.2 km · Main Bazar, Gudha …   │ │  distance only when the origin is known
│ │ % 11% OFF on ₹200+ │ ₹50 OFF … │ │  Offers/Chips (h-scroll)
│ └────────────────────────────────┘ │
│ [🔍 Search in menu ]   [ Veg ◯ ]   │  Menu/Toolbar (sticky under the header)
│ ★ Top rated here                   │  D12, hides when sparse
│ ▣ Dal Baati Churma          ┌────┐ │
│   ₹180 · ★ 4.6 (12)         │img │ │  Menu/DishRow
│   Three baatis with…  more  └ADD─┘ │  ADD overlaps the image
│ Full menu · 42                     │
│ …                                  │
│ Ratings & reviews                  │  existing reviews list
├────────────────────────────────────┤
│ 2 items · ₹310          View cart  │  CartBar (no bottom nav here)
└────────────────────────────────────┘
```

- **Public (D4).** `RestaurantMenu` makes no auth-dependent calls, and `restaurants` and `menu_items` are anon-readable (016).
- **Select additions:** `image_urls`, `lat`, `lng` and `delivery_radius_km`, all in the anon column grant. The hero slideshow then comes from `image_urls`, closing the v2 deferral noted in CLAUDE.md.
- **Distance and area.** Distance shows when `BrowseProvider` has an origin. If the origin is outside this restaurant's radius, an info notice reads "This kitchen doesn't deliver to your selected location". Checkout still enforces the real geofence.
- **Menu tools.**
  - In-menu search filters the loaded items with `dishMatches`. No network call.
  - The veg toggle is All · Veg (Non-veg as a third chip is optional).
  - "Top rated here": `rating_count >= 3`, sorted by average, at most 5; shown when at least 2 qualify. Those dishes also appear in the full list.
- **Dish row spec**
  - Text column: veg mark, name (`title-sm`, 2 lines), price (`label-md`), rating "★ 4.6 (12)" when the count is above 0, and the description (`body-sm`, clamped to 2 lines with "more").
  - The image is 112 × 112 at `radius-md`, with ADD overlapping its bottom edge. With no image, ADD aligns right. There is never a placeholder food photo.
- **The cart** uses the existing `addItem` / `updateQuantity` and the single-restaurant lock. The replace-cart dialog copy is unchanged.
- **Unavailable restaurant.** RLS hides closed and inactive kitchens, so a missing row means closed, inactive or wrong ID. Show `EmptyState`: "This kitchen isn't taking orders right now", with "See open restaurants" → `/`. Today this case renders "Something went wrong. Not found."
- **Menu categories** stay hidden (§3.1). The jump-list component is designed in Figma only.

**States:** hero and info skeleton plus 6 dish-row skeletons; reviews load independently (today's behaviour); an empty menu shows "This restaurant's menu is being updated" (today's copy).

**Must not change:** cart semantics, the `menuItem → CartItem` mapping (list price), the offer copy rules and the reviews data source.

**Acceptance**

- A logged-out visitor opens a menu with no login wall.
- Adding, stepping and replacing behave exactly as today.
- The hero shows up to 5 images, or a static image under reduced motion.

### 8.4 Cart & Checkout (`/checkout`, D3)

```
┌────────────────────────────────────┐
│ ←  Cart                            │  AppHeader/stack
│ ┌ Sharma Bhojnalaya ─────────────┐ │
│ │ ▣ Dal Baati     [− 2 +]  ₹360  │ │  items: AddToCartControl + line total
│ │ ▲ Chicken Curry [− 1 +]  ₹220  │ │
│ │ + Add more items               │ │  → /restaurants/:cart.restaurant_id
│ │ ✎ Add cooking instructions     │ │  expands the existing `notes` textarea
│ └────────────────────────────────┘ │
│ ┌ % Apply coupon     3 available ▸┐│  Checkout/CouponRow → CouponSheet
│ └────────────────────────────────┘ │
│ ┌ Deliver to ────────────────────┐ │
│ │ (•) Home · 12 Main Bazar …  📍 │ │  Checkout/AddressSection (inline)
│ │ ( ) Office · …                 │ │
│ │ ( ) Add a new address          │ │
│ └────────────────────────────────┘ │
│ ┌ Bill details ──────────────────┐ │
│ │ Item total               ₹580  │ │  Checkout/BillDetails
│ │ Discount (11%)           −₹50  │ │
│ │ Delivery fee (1.2 km)     ₹25  │ │
│ │ Platform fee               ₹5  │ │
│ │ To pay                   ₹560  │ │
│ └────────────────────────────────┘ │
│ ┌ 💵 Cash on delivery ───────────┐ │
│ │ Pay the rider when food arrives│ │
│ └────────────────────────────────┘ │
├────────────────────────────────────┤
│ ⓘ Set your delivery location       │  blocker line (only when disabled)
│ ₹560 · View bill   [ Place order ] │  StickyActionBar
└────────────────────────────────────┘
```

**The approach: move the JSX, not the logic.** Everything above the `return` in `Checkout.tsx` stays in `Checkout.tsx`, byte for byte: state, effects, `effectivePricing`, `offerCart`, `openConfirm`, `handlePlaceOrder`, the coupon handlers and the error-prefix mapping. There is one exception: the `canPlace` expression moves **verbatim** into `canPlaceOrder()` in `lib/checkoutGate.ts`, so it can be tested side by side with the footer's blocker (below). Only the JSX is split into the section components, which take props and call the same handlers. The one logic-adjacent change is D7 (default address), in its own commit.

**Sections**

- **Order of sections:** items → instructions → coupon → address → bill → payment.
- **Address stays inline, not in a sheet.** That avoids a modal (`LocationConfirmModal`) on top of a sheet and a keyboard inside a sheet. The radio-group semantics, the "Add a new address" GPS button, the textarea, the pinned and out-of-area notices and the retry for failed restaurant geo all keep today's conditions.
- **Bill lines** come from `billLinesFromPricing(effectivePricing, labels)`.
  - The labels are computed exactly as today: `discountLabel`, `deliveryLabel` with the distance, the free-delivery coupon line, the surge label, "· FREE" only when the fee is 0.
  - While `deliveryKnown` is false, the fee line renders a skeleton and the total renders "—". It is **never ₹0** (Principle 1).
  - `ConfirmOrderModal`'s summary renders the same component.
- **Hint line** (`buildHint`) and the "Couldn't load delivery pricing · Try again" notice are unchanged.
- **Payment** is a static row: "Cash on delivery: pay the rider when your food arrives." It is true and not interactive.

**Sticky footer**

- It shows the total (or "—") with "View bill", which scrolls to the bill, and the primary button.
- The labels are today's, in sentence case: "Place order · ₹X", "Loading pricing…" or "Checking your coupon…".
- Pressing it opens `ConfirmOrderModal`, which stays the safety net: default focus on "Go back", re-pricing at tap time, errors shown inside the modal.

**Blocker line.** `checkoutBlocker()` returns the first failing condition, in this order. The copy is a draft:

| Condition (same inputs as `canPlace`) | Footer message |
|---|---|
| `cart.items.length === 0` | "Your cart is empty" (the screen shows the empty state instead of a footer; the row exists so the parity test holds) |
| `!restaurantGeo && !geoLoadFailed` | "Loading delivery details…" |
| `geoLoadFailed` | "Couldn't load delivery details. Try again above." |
| `!effectivePricing.deliveryKnown` | "Loading delivery pricing…", or "Couldn't load delivery pricing. Try again above." when the config fetch failed (`deliveryConfigError`; it chooses the copy only) |
| `needsDeliveryPin` | "Set your delivery location to continue" |
| `deliveryOutOfArea` | "This address is outside {restaurant}'s delivery area" |
| `address.trim().length <= 10` | "Add your full address (house no., street, landmark)" |
| `checkingCoupon` | "Checking your coupon…" |
| `placing` | "Placing your order…" |

A unit test enumerates the input combinations and asserts that `checkoutBlocker(x) === null` exactly when `canPlaceOrder(x)`. `canPlaceOrder` is today's expression moved verbatim into `lib/checkoutGate.ts`.

**Overlays.** `CouponSheet` moves onto `Sheet`; `ConfirmOrderModal` onto `Dialog`; `LocationConfirmModal` is restyled with the OSM attribution kept. Their content and props are unchanged.

**States**

- Empty cart: `EmptyState`, "Your cart is empty", with "Explore restaurants".
- The pricing-pending and pricing-failed notices, coupon notices and RPC error copy are today's strings, rendered through `InlineNotice` or inside the dialog.

**Must not change.** §15.4 items 1–8, especially:

- `place_order` arguments (the coupon keys are sent only when a coupon is in use);
- the error prefixes `COUPON_INVALID:`, `DELIVERY_TOO_FAR:`, `DELIVERY_PIN_REQUIRED:` and `PRICING_MISMATCH:`;
- re-pricing at tap time;
- saving the address only after the order succeeds;
- the coupon re-check when the confirm dialog opens.

**Acceptance**

- `pricing.test.ts`, `coupons.test.ts` and `CouponSheet.test.tsx` pass unchanged.
- The new bill-line and gate tests pass.
- The manual matrix in §15.2 (rows 8–13) passes: a coupon applied, locked or beaten by the festival discount; surge on; out of area; no pin; a pricing error with retry; `PRICING_MISMATCH` with reload.

### 8.5 Order tracking (`/orders/:id`)

```
┌────────────────────────────────────┐
│ ←  Order #280630B5          Help   │  Help = WhatsApp, prefilled with the order id
│ ┌────────────────────────────────┐ │
│ │ Preparing your food            │ │  Orders/StatusHero (aria-live="polite")
│ │ Arriving in 25–35 min · ~7:45  │ │  computeEtaWindow (unchanged)
│ │ Sharma Bhojnalaya              │ │
│ └────────────────────────────────┘ │
│  ● Order placed          7:02 PM   │  Orders/Tracker
│  ● Confirmed             7:04 PM   │  times only where stored
│  ◉ Preparing                       │  live step: green, soft pulse
│  ○ On the way                      │
│  ○ Delivered                       │
│ [ Turn on notifications ]          │  native push pre-prompt (unchanged)
│ ┌ Order details ─────────────────┐ │
│ │ items · bill · address · notes │ │  BillDetails from the order snapshot
│ └────────────────────────────────┘ │
│ [ Cancel order ]                   │  pending only
└────────────────────────────────────┘
```

**Labels** (presentation only; the `STATUS_MESSAGES` sentences stay as the body text):

| Status | Tracker step | Hero title | Badge tone |
|---|---|---|---|
| `pending` | Order placed | "Waiting for the restaurant" | warning |
| `accepted` | Confirmed | "Order confirmed" | success |
| `preparing` | Preparing | "Preparing your food" | success |
| `out_for_delivery` | On the way | "On the way" | success |
| `completed` | Delivered | "Delivered" | success |
| `declined` | (tracker hidden) | "Declined by the restaurant" plus the reason | danger |
| `expired` | (tracker hidden) | "The restaurant didn't respond in time" | danger |
| `cancelled` | (tracker hidden) | "You cancelled this order" | neutral (not the red error treatment, as today) |

**Behaviour**

- **Unchanged:** the Realtime channel `order-${id}` (UPDATE, merged into the joined row); the ETA rules (shown for accepted, preparing and on the way only; hidden for pre-014 orders; counts down, then "arriving", then gentle overdue copy); cancel through the `cancel_order` RPC, with the lost-race notice and refetch; the modal auto-dismissing when the status leaves `pending`; the contextual push prompt; the review CTA for completed orders only; the apology card for declined and expired orders.
- **New (D13):** refetch the order on `visibilitychange` → visible, on Capacitor `App` resume (`appStateChange`) and on any `SUBSCRIBED` status after the first. This mirrors the owner dashboard's reconnect refetch and doesn't add a channel.
- **Neutral fallbacks (§18 F1):** a null `restaurants` join shows "Your restaurant" in the header; a null `menu_items` join shows "Item" with **no veg mark**, never the non-veg mark.
- **The receipt** comes from `billLinesFromOrder(order)`, which keeps today's ordering (`receiptDiscountLine` and its `afterDelivery` placement) and the item-total identity (`total + discount − delivery − platform − surge`).

**Acceptance**

- An owner status change shows up within a few seconds.
- After 5 minutes with the app backgrounded and a status change in between, resuming shows the new status with no manual refresh.
- Cancel works, and so does the lost-race path.
- A closed restaurant's order never shows a non-veg mark.

### 8.6 Orders (`/orders`)

- **Two sections:** "In progress" (pending, accepted, preparing, out for delivery), then "Past orders".
- **Each `Orders/Card` shows:**
  - restaurant name (with the F1 fallback), date and time, status `Badge` (label from `orderStatus.ts`) and total;
  - "Rate your order" or "You rated this — Edit" for completed orders;
  - the collapsed breakdown (today's `<details>`, rendered with `BillDetails`).
- **Optional item summary:** "2 × Dal Baati, 1 × Lassi". It needs `order_items(quantity, menu_items(name))` added to the select, with the F1 fallback.
- **Logged out (D5):** a `SignInPanel`, "Log in to see your orders".
- **Empty:** "No orders yet", with "Explore restaurants" → `/`.
- **Loading:** 4 order-card skeletons.
- **Optional pagination:** `.range()` pages of 20 with "Load more". Today's query fetches everything, which is fine at current volumes.

### 8.7 Offers (`/coupons`)

Every behaviour stays; the screen gets a clearer structure:

1. **Pending-code banner** (`?apply=` / `couponStorage`): unchanged logic, restyled.
2. **"Have a code?"** checker: unchanged. Logged out → sign-in prompt; non-customer → note; customer → `preview_coupon`.
3. **"Always on" cards (new, real data):**
   - the festival discount when `isLive` ("11% off on ₹200+, up to ₹50 — applied automatically");
   - the free-delivery rule from `delivery_config`.
   - Both hide when not live or not loaded.
4. **`ReferralCard`:** unchanged; hidden while the programme is off.
5. **"Your coupons" and "Offers for everyone":** `CouponTicket` rows with today's aside logic (Use, a lock label, Expired).
6. **Empty:** "No offers right now — check back around festivals." (today's copy).

**Acceptance:** "Use" still stores the pending code and routes to checkout (with items) or Home (without); checkout still validates it with `preview_coupon` before applying.

### 8.8 Profile (`/profile`) and Saved addresses (`/profile/addresses`)

```
┌────────────────────────────────────┐
│ Profile                            │
│ ┌────────────────────────────────┐ │
│ │ (A) Ankit Khatkar        Edit  │ │  Profile/Header
│ │     +91 98765 43210 ✓ Verified │ │
│ └────────────────────────────────┘ │
│  ▤ Your orders                  ›  │  ListRow
│  ⌂ Saved addresses              ›  │  → /profile/addresses (D11)
│  % Coupons & offers             ›  │
│  ☏ Help & support               ›  │  WhatsApp + email
│  ⓘ About RedLotus               ›  │
│  § Terms · Privacy              ›  │
│  ⏻ Log out                         │  signOut() → "/"
│  Delete account (customers only)   │  danger zone, as today
│  Version 1.0.14                    │
└────────────────────────────────────┘
```

- **The edit form** (name and phone) keeps today's `handleSave` logic. Changing the phone resets verification and routes to `/verify-phone`. It lives behind "Edit" in an expandable card.
- **Setup mode** (`?setup=true`, the Google gate) shows the form expanded with today's banner. The rows and danger zone stay hidden.
- **OTP plan §8.8** will make the phone read-only with "Change" (`PhoneOtpForm`). The header is designed so that swap needs no layout change.
- **Log out** is now also on the page (it calls the existing `signOut`).
- **Delete account** must stay reachable in-app (Google Play policy). It keeps `DeleteAccountModal`, now on `Dialog`, and the `/delete-account` link.
- **Saved addresses (D11):** `listAddresses()`. Each row shows the label icon, label, address text, pin status and a "Default" badge. Actions: "Set as default" (`setDefaultAddress`) and "Delete" (`deleteAddress`, behind a `Dialog`). Adding stays in checkout for v1, with a note: "New addresses are saved when you place an order."
- **Logged out (D5):** a `SignInPanel`, plus the rows that don't need an account (Help, About, Terms, Privacy).

### 8.9 Auth screens: the boundary with the OTP plan

`/login`, `/signup`, `/verify-phone`, `/auth/callback` and `/reset-password` are **not** redesigned here. The OTP plan rewrites them (§8 there).

- **If the OTP plan ships first:** this plan's tokens and primitives are adopted when those screens are next touched.
- **If this plan ships first:** the OTP plan builds `PhoneOtpForm` and the new `/login` on `Button`, `SearchField`-style inputs and the tokens.

Neither plan changes the other's logic. `SignInPanel` links to `/login`, and adds `?next=` once that parameter exists.

### 8.10 Owner surfaces: guardrails only

- The owner dashboard, menu manager and reviews manager keep `Navbar` and their own CSS. No owner file is edited.
- Owners never see the bottom nav (§7.3), and `/` still redirects them to `/dashboard`.
- The new-order chime, Realtime, push and the `useNewOrderAlert` singletons are untouched.
- **Regression check:** owner login → dashboard renders → a test order arrives → accept and progress → the customer's tracker updates (§15.2).

---

## 9. Loading, empty, error and offline states

Rules:

- **Never a blank screen.** Skeletons match the layout they replace.
- **Error copy is always humanised.** Supabase errors pass through `humaniseSupabaseError`. `couponsApi` and `reviews.ts`'s submit path already wrap errors before throwing. `reviews.ts`'s read helpers throw raw errors, which today's callers swallow; keep it that way, or wrap them before any screen renders one. `EmptyState` takes a string, never an `Error`.
- **Every state names the next action.**

| State | Where | Title / body (draft; existing copy kept where it exists) | Actions |
|---|---|---|---|
| Location: unsupported · denied · unavailable · timeout · inaccurate | Home, Search | Today's `LOCATION_STATE_CONFIG` copy | Retry and override where today allows; WhatsApp |
| No restaurants deliver here | Home, Search | Today's `NONE_IN_RANGE_CONFIG` | "Show restaurants anyway", WhatsApp |
| All kitchens closed | Home | Today's `NO_RESTAURANTS_CONFIG` | WhatsApp |
| Couldn't load restaurants | Home | "Couldn't load restaurants" + the humanised error | Try again, WhatsApp |
| No search results / empty category | Search | Today's `noMatchConfig` / `noCategoryConfig` | Category suggestions, WhatsApp |
| Restaurant unavailable | Restaurant | "This kitchen isn't taking orders right now" | "See open restaurants" |
| Menu being updated | Restaurant | Today's copy | Back |
| Empty cart | Checkout | "Your cart is empty" / "Find something delicious nearby." | "Explore restaurants" |
| Delivery pricing / restaurant geo failed | Checkout | Today's notices | Try again |
| No orders | Orders | "No orders yet" | "Explore restaurants" |
| Order not found / failed to load | Order detail | "We couldn't load this order" + the humanised error | Try again, back to Orders |
| No offers | Offers | Today's copy | "Explore restaurants" |
| No saved addresses | Saved addresses | "No saved addresses yet" | "Order now: we'll save it at checkout" |
| Logged out on a tab | Orders, Profile | "Log in to see your orders" / "Log in to manage your account" | "Log in" |
| Offline (native) | Everywhere | Today's `NativeBridge` banner, above the bottom bars | none (it clears on reconnect) |
| Offline (web, optional) | Everywhere | The same banner from `navigator.onLine` events | none |
| Render crash | Anywhere | `ErrorBoundary`, restyled; the contact number comes from `lib/contact.ts` | Reload, WhatsApp |

---

## 10. Motion

| Interaction | Animation | Duration / easing | Reduced motion |
|---|---|---|---|
| ADD → stepper | Crossfade plus a width change | 200 ms standard | Instant |
| Quantity change | The number slides 4 px | 120 ms | Instant |
| Item added | The cart bar scales 1 → 1.04 → 1 and the count updates (`aria-live`) | 200 ms | Count update only |
| Sheet open / close | translateY 100 % → 0 and backdrop fade | 320 ms decelerate / 200 ms accelerate | Fade only |
| Dialog | Scale 0.96 → 1 and fade | 200 ms | Fade only |
| Stack navigation | React Router `viewTransition` (View Transitions API; RR 8.3 exposes `viewTransition`): fade plus 8 px slide | 200 ms | None |
| Skeleton | One shared `rl-shimmer` gradient | 1.2 s loop | Static |
| Live tracker step | `rl-pulse` ring | 1.6 s loop | Static |
| Press feedback | Opacity 0.72, as in today's `index.css` | Immediate | Same |
| Header turns solid on scroll | Background and shadow | 200 ms | Instant |

**Not allowed:** a flying image into the cart, parallax, Lottie, any JavaScript animation library, and animating `width`, `height` or `top` on long lists. Only `transform` and `opacity` animate (plus the stepper's width change).

---

## 11. Accessibility

- **Contrast:** every text token in §5.2 reaches AA (4.5:1) against the backgrounds it is used on; UI component boundaries reach 3:1.
- **Not colour alone:** veg marks are shape-coded (D9); status badges carry text; errors carry an icon.
- **Targets:** at least 44 × 44 px (48 for navigation). Carousel dots get a 24 px hit area (WCAG 2.2 target size).
- **Focus:** a visible `:focus-visible` ring (2 px brand outline, 2 px offset) on every interactive element. Overlays trap focus and restore it.
- **Semantics:**
  - one `<main>` per screen;
  - `<nav aria-label="Main">` for the bottom nav, with `aria-current="page"`;
  - a heading order of h1 per screen, then h2 per section;
  - lists as `<ul>`;
  - a real `<button>` or `<a>`, never a clickable `div`.
- **Live regions:** the cart bar count ("2 items, ₹310"), the order status hero, and coupon and checkout notices (`role="status"`, or `role="alert"` for danger).
- **Labels:**
  - icon-only buttons have `aria-label` (enforced by type);
  - the veg mark has "Vegetarian" or "Non-vegetarian";
  - the rating reads "Rated 4.3 out of 5 from 128 ratings" (today's pattern);
  - images use `alt` = the restaurant or dish name, or `alt=""` when the name is already adjacent text.
- **Text scaling:** layouts hold at 130 % system font (Android) and 200 % browser zoom (web).
- **Language:** `<html lang="en">` stays. Devanagari names fall back to the system font: Plus Jakarta Sans has no Devanagari glyphs.

---

## 12. Performance

### 12.1 Baseline

Taken from `npm run build` on 2026-10-05, `main` @ `76e4a1f`. Gzip figures are measured with `gzip -c` (level 6).

| Chunk | Raw | Gzip |
|---|---|---|
| `index` JS (storefront, router, contexts) | 390.6 kB | ~124 kB |
| `supabaseClient` JS | 196.3 kB | ~50 kB |
| `jsx-runtime` JS | 28.1 kB | ~10.5 kB |
| `Checkout` JS | 29.6 kB | ~8.2 kB |
| `OrderStatus` JS | 11.9 kB | |
| `CouponsPage` JS | 9.0 kB | |
| `RestaurantMenu` JS | 8.1 kB | |
| `Profile` JS | 6.0 kB | |
| `OrderHistory` JS | 4.2 kB | |
| `index` CSS | 32.1 kB | ~6.3 kB |

### 12.2 Budgets

- The `index` JS gzip grows by **at most 15 kB**: shell, tokens and primitives together.
- Each route chunk stays at or under 30 kB gzip. The new `SearchPage` stays at or under 12 kB gzip.
- Total customer-route CSS doesn't grow. Shared primitives should shrink it as screens migrate.
- **No new runtime UI dependencies.** No framer-motion, no component library, no Tailwind. `lucide-react` stays per-icon.
- Fonts (D10): only the latin subset and only the weights in use (400 / 500 / 600 / 700 sans, 400 serif). Preload the two most-used files. Measure the total and record it in Phase 1.
- The customer path never downloads the owner chunk (CLAUDE.md invariant).

### 12.3 Practices

- **Images**
  - Give every image `width` and `height` or an aspect-ratio box (no layout shift), `loading="lazy"` and `decoding="async"`.
  - Only the first card's lead image is eager, with `fetchpriority="high"`.
  - Supabase image transformations would cut bytes but are a paid add-on. Off by default; §18 F8.
- **Lists.** At current scale (about 16 restaurants, menus up to about 150 dishes) no virtualisation is needed. `content-visibility: auto` on the menu's full list and on reviews is allowed.
- **Search.** A 200 ms debounce; memoise normalised haystacks per dataset; the dish fetch stays lazy and scoped.
- **Data.**
  - `BrowseProvider` removes the restaurant refetch on every Home visit.
  - **No new Realtime channels.** D13 adds refetches, not subscriptions.
  - A bottom-nav "active order" badge would need a query or subscription on every screen, so it is deferred.
- **Rendering.** Memoise the derived lists (nearby, featured, top rated, results); keep context values stable; components read only the context slice they need.
- **Measure** at the end of each wave: the build sizes table above, Lighthouse mobile on a Vercel preview for `/` and `/restaurants/:id`, and Vercel Speed Insights field data after release.

---

## 13. Figma workflow (MCP)

### 13.1 Account and limits

Checked 2026-10-05 with `whoami` and Figma's documentation (sources in §21):

| Fact | Value | Consequence |
|---|---|---|
| Plan · seat | Starter · Full (team admin) | MCP access with per-day limits |
| MCP limits (Starter, Full seat) | Up to **200 calls a day, 10 a minute**. Exempt: `whoami`, `create_new_file`, `add_code_connect_map`. | Assume every `use_figma` and `get_*` call counts. §13.8 budgets them. |
| Files and pages (Starter) | **3 design files with at most 3 pages each**; 3 FigJam files; one project | One design file with exactly 3 pages, plus one FigJam file |
| Variable modes | At least 1 per collection (Starter allows a few) | The design needs one mode, "Light" |
| Code Connect | **Organization / Enterprise only** | No Code Connect. Map by naming convention (§13.6). |
| Team libraries | Publishing needs a paid plan | Components stay local to the one file, which is fine with a single file |

### 13.2 Files and pages

- **Design file "RedLotus — Customer App"**, in Ankit's team project:
  1. **Foundations:** a cover frame (status, owner, a link to this doc, last sync date), the brand (logo-mark, wordmark, do and don't), colour, type, space, radius and elevation specimens, and the icon rules.
  2. **Components:** sections Primitives, Overlays, Shell, Restaurant, Menu, Checkout, Orders, Offers, Profile.
  3. **Screens:** sections `00 Baseline (current app)`, `01 Home`, `02 Search`, `03 Restaurant`, `04 Checkout`, `05 Order tracking`, `06 Orders`, `07 Offers`, `08 Profile`, `09 States`, `10 Tablet & desktop`, `11 Prototype: critical flow`.
- **FigJam file "RedLotus — App IA & Flows":** the IA map, the critical flow (§15.2), the back-button rules (§7.5) and the data-source map (§3). Built with `generate_diagram`.
- **Frame naming:** `Home — Default — 360`, `Home — Loading — 360`, `Home — Location denied — 360`, and so on.
- **Approval marker:** each section carries a status label: `Draft`, `In review` or `Approved (date)`.

### 13.3 Build order in Figma

1. **Variables**
   - A `Primitives` collection (hidden; scopes `[]`) with the raw palette and spacing values.
   - A `Tokens` collection (mode "Light") aliasing them under the §5 paths.
   - Scopes on every variable: backgrounds → `FRAME_FILL, SHAPE_FILL`; text → `TEXT_FILL`; borders → `STROKE_COLOR`; spacing → `GAP`; radii → `CORNER_RADIUS`.
   - WEB code syntax `var(--rl-…)` on every one.
2. **Styles:** the text styles in §5.3 and the effect styles `Elevation/1`, `Elevation/2`, `Elevation/3` and `Elevation/Brand`.
3. **Components** in dependency order: primitives → overlays → shell → domain.
   - Auto layout throughout, with every fill, stroke, padding, gap and radius bound to variables.
   - Icons use `INSTANCE_SWAP`; never one variant per icon.
   - Split any variant matrix larger than 30.
4. **Screens**, built only from component instances and tokens. Every state listed in §8 and §9 gets a frame.
5. **Prototype:** connect the critical-flow frames for Ankit's click-through review.

### 13.4 The screen design loop

1. Claude drafts the screen in Figma from §8 with components, loading `figma-use` and `figma-generate-design` first.
2. Claude takes a screenshot and self-checks for clipping, truncation, contrast and overflow at 360 px.
3. Ankit reviews in Figma (comments) or in chat.
4. Claude iterates; only the frames that changed are touched.
5. Ankit marks the section **Approved**. Coding that screen starts only after this.

### 13.5 From design to code

For each approved frame or component:

1. Load the `figma-design-to-code` skill, then call `get_design_context` on the node with a screenshot. Use `get_variable_defs` to confirm the token bindings.
2. **Adapt, don't paste.** The tool returns React plus Tailwind-flavoured reference code. Translate it into this repo's conventions: plain co-located CSS, `var(--rl-…)` tokens, the `src/components/ui` primitives, real data from the existing hooks, and no absolute positioning unless it is genuinely fixed.
3. Download any static asset the design uses through the tool's asset flow. Data imagery (restaurant and dish photos) stays dynamic.
4. Render the screen (`npm run dev` at 360 px, or a preview build) and compare it with the Figma screenshot. Fix the differences in scope and note anything pre-existing that is out of scope.
5. If the code reveals a constraint the design missed (for example, real names longer than expected), update the Figma frame in the same session. Figma remains the visual source of truth; this doc remains the source of truth for behaviour and data.

### 13.6 Mapping without Code Connect

- **Names match:** the Figma component name equals the React component name (§6 tables).
- **Props match:** Figma variant property names equal the React prop names (`variant=primary`, `size=md`). Figma-only properties (`state=pressed`) are marked as such in the component description.
- **Every component description** carries its code path and props, for example `React: src/components/ui/Button.tsx · props: variant, size, loading, fullWidth, iconStart, iconEnd`.
- **Every token** has WEB code syntax, so generated code references `var(--rl-…)`.
- If the plan is ever upgraded to Organization, these descriptions become the Code Connect source.

### 13.7 Real content in Figma

- **Restaurants and menus:** the public catalogue: real names, cuisines, prices, descriptions, images and ratings, the same data any visitor sees through the anon API. Real long names are used to test truncation.
- **Orders and receipts:** one of Ankit's own test orders, or seed data on a preview branch, labelled as such. No other customer's personal data goes into Figma.
- **Missing data stays missing.** No rating means "New"; no image means no image; no promotions means the carousel is absent.
- **The baseline section** holds screenshots of today's screens for before-and-after comparison.

### 13.8 Call budget

| Activity | Calls (estimate) |
|---|---|
| Setup (`whoami`, `create_new_file` × 2) | 0 counted (exempt) |
| Foundations (variables, styles, specimens, review screenshots) | 15–25 |
| Primitives and overlays (~20 components with variants) | 50–80 |
| Shell and domain components (~20) | 50–80 |
| Screens (9 screens × default + 3–6 states at 360 px) | 90–140 |
| Tablet and desktop reference frames | 10–20 |
| Review iterations (about +30 %) | 60–100 |
| Design → code reads (`get_design_context`, `get_screenshot`, `get_variable_defs`) | 80–120 |
| **Total** | **about 350–550**: 3–4 days' allowance, spread over the phases |

Rules:

- `use_figma` calls run one at a time, never in parallel (a skill rule).
- Batch related operations into one safe-to-retry script.
- Take one review screenshot per composition phase.
- Keep the run ledger (node IDs) in a git-ignored `.figma/` folder. Add it to `.gitignore` in Phase 0. The stable registry (file keys, page IDs, key component IDs) lives in Appendix B of this doc.
- To resume in a new chat: "Continuing the RedLotus design system build, run ID {id}. Load figma-use and figma-generate-library and resume from the last completed step."

### 13.9 Keeping Figma and code in sync

- A token change happens in `tokens.css` and the Figma variable together, and is recorded in the Appendix B changelog.
- A component API change (a new prop or variant) is made in both places and its description is updated.
- **Before each wave ships:** `get_variable_defs` on the approved screens is compared with `tokens.css` (the drift check), and any difference is fixed or recorded.

---

## 14. Implementation phases

Each phase goes Figma first, then code, then tests. Work stays on the integration branch `feat/app-redesign`; per the standing rule, nothing is pushed, opened as a PR, merged, deployed or uploaded to OTA without Ankit's review (§16).

| Phase | Goal | Figma | Code | Tests and checks | Exit criteria | Wave |
|---|---|---|---|---|---|---|
| **0 · Prep** | Decisions and baseline | Create the design file and FigJam file; IA and critical-flow diagrams; import baseline screenshots | Add `.figma/` to `.gitignore`. Nothing else. | Record build sizes (done, §12.1), test count (312) and Lighthouse for `/` and `/restaurants/:id` on a preview | D1–D17 answered; Appendix C run; Figma files exist | — |
| **1 · Foundations** | One token set in both places | Variables, text and effect styles, the Foundations page | `src/styles/{tokens,base,motion}.css`; fonts self-hosted (D10); `formatRupees` and `formatDistance` in `format.ts` with parity tests; `lib/contact.ts` | `npm test`, lint, build; screenshots of every customer screen show no unintended change | Tokens match (drift check passes) | A |
| **2 · Primitives and overlays** | Reusable building blocks | Components page: primitives and overlays | `src/components/ui/*`; `lib/backStack.ts`; `NativeBridge` back-stack hook-in | Render tests: Sheet and Dialog (focus trap, ESC, back handler, busy), `AddToCartControl` states, `VegMark` labels; `backStack` unit tests | Primitives approved in Figma and matching in code | A |
| **3 · Shell and navigation** | One navigation system | Shell components; tab-screen frames | `CustomerShell`, `BottomNav`, `AppHeader`, `CartBar`, `StickyActionBar`, `ScrollManager`; route restructure; back rules (§7.5); system-bar colours; keyboard attribute. Tab screens not yet redesigned get the `title` header and a token pass instead of `Navbar`, so no screen shows two navigations. | `navVisibility` tests; manual back-button matrix on a device | Every customer screen has exactly one navigation system | A |
| **4 · Home and Search** | Discovery | Home and Search screens with all states | `BrowseProvider` (pure move, then `decideFix` with tests); Home recomposed; `SearchPage`; `recentSearches` | `browseOrigin` and `recentSearches` tests; search parity check against today's results; the location state walkthrough (all 5 states + override + disclosure) | §8.1 and §8.2 acceptance | A |
| **5 · Restaurant and dish cards** | Menu | Restaurant screen and states; dish rows | `RestaurantHero`, `OfferStrip`, `MenuToolbar`, `DishRow`; D4 public route; the unavailable state | Cart behaviour walkthrough; replace-cart; logged-out menu | §8.3 acceptance → **Wave A release candidate** | A |
| **6 · Cart and Checkout** | Transaction | Checkout and all its states; dialogs and sheets | JSX split into sections; `billLines.ts`; `checkoutGate.ts`; sticky footer; D7 in its own commit | Bill-line and gate tests; `pricing`, `coupons` and `CouponSheet` tests unchanged; §15.2 rows 8–13 | §8.4 acceptance | B |
| **7 · Orders and tracking** | After the order | Tracking, history and states | `OrderStatusHero`, `OrderStatusTracker`, `OrderCard`, `orderStatus.ts`; D13 refetch; F1 fallbacks | `orderStatus` tests; Realtime and resume test with the owner dashboard | §8.5 and §8.6 acceptance | B |
| **8 · Offers and Profile** | Account and offers | Offers, Profile and Saved addresses | Restyled `CouponsPage`; `Profile`; `SavedAddresses` (D11) | Coupon flows unchanged; delete account reachable; set-default and delete | §8.7 and §8.8 acceptance → **Wave B release candidate** | B |
| **9 · States, motion, a11y, performance** | Polish | The states section; prototype review | Missing skeletons and empty states; motion; a11y fixes; performance tuning | §15.5 and §15.6 | Budgets met; TalkBack pass | A + B |
| **10 · Verify and release** | Confidence | Final drift check | Regression fixes; docs sync (§19) | The full §15 matrix; `npm test`, `npm run lint`, `npm run build`, `npm run build:cap` | Ankit's sign-off → release (§16) | A, then B |

---

## 15. Testing and verification

### 15.1 Automated (Vitest; the CLAUDE.md scope stays pure-logic-first)

| New test file | What it pins |
|---|---|
| `lib/format.test.ts` (extend) | `formatRupees` / `formatDistance` give the same output as today's helpers for 0, 50, 180, 180.5, 1234.25 and for 0.35 km and 1.2 km |
| `lib/billLines.test.ts` | Checkout lines for every `discountSource` and waiver case; receipt lines for pre-022, 022 and 027 orders; `afterDelivery` ordering; null fee → a pending marker, never 0 |
| `lib/checkoutGate.test.ts` | `checkoutBlocker(x) === null` exactly when `canPlaceOrder(x)`, across the input space; blocker precedence |
| `lib/browseOrigin.test.ts` | `decideFix` for every row of the location-resilience edge-case table |
| `lib/navVisibility.test.ts` | §7.3 matrix |
| `lib/backStack.test.ts` | LIFO order, unregister, the busy handler returning false |
| `lib/recentSearches.test.ts` | Dedupe, cap of 8, clear, corrupt storage |
| `lib/orderStatus.test.ts` | A label and tone for every enum value (the test fails if a new status is added without one) |
| `components/ui/Sheet.test.tsx`, `Dialog.test.tsx` | Focus moves in and is trapped and restored; ESC; backdrop; the back handler; busy blocks closing |
| `components/ui/AddToCartControl.test.tsx` | 0 → ADD; n → stepper; decrementing at 1 removes |
| `components/ui/VegMark.test.tsx` | Accessible names; renders nothing for unknown |

The existing 312 tests must pass unchanged, especially `pricing.test.ts`, `coupons.test.ts`, `CartContext.test.tsx`, `CouponSheet.test.tsx` and `locationCache.test.ts`. No mocked Supabase (CLAUDE.md).

### 15.2 The critical flow (the brief's §26, adapted to RedLotus)

Run it per wave on every platform in §15.3. **Pay** becomes **place the order (cash on delivery)**.

| # | Step | How | Pass when |
|---|---|---|---|
| 1 | Open the app | Native cold start; web `/` | The splash hides; Home renders from cache with no spinner for a returning user; no layout jump |
| 2 | Select a location | Header → sheet: GPS / saved / "Browse all of Gudha Gorji"; first native run | The label updates and the list re-filters by each restaurant's radius; the disclosure precedes the OS prompt |
| 3 | Search a restaurant or dish | Search tab, a query, a category chip, recent searches | Results stay inside the radius; the veg filter works; results match today's |
| 4 | Open a restaurant | Tap a card while logged out (D4) | The menu loads with no login; distance shows |
| 5 | View the menu | Scroll; in-menu search; veg toggle | The toolbar sticks; filters are client-side; Top rated shows only above its threshold |
| 6 | Add food | ADD on a dish; then a dish from another restaurant | Stepper appears; the replace-cart dialog shows; the cart survives a reload |
| 7 | Change quantity | Stepper up and down to 0 | The line is removed at 0; the cart bar updates and is announced |
| 8 | Apply a coupon | Offers → "Use" (pending code) or checkout → sheet → code | Validated by `preview_coupon`; locked and beaten-by-festival states shown; invalid → message; `COUPON_INVALID:` at placement → dropped, re-priced, confirm again |
| 9 | Open the cart | Cart bar → `/checkout` (log in and verify the phone if needed) | The cart is intact after login |
| 10 | Proceed to checkout | Review the sections | The fee shows "—" or a skeleton until known, never ₹0; the hint and notices are right |
| 11 | Select an address | Saved (D7 pre-select) / GPS pin / typed | Out of area → blocked with the footer reason; no pin → blocked; `DELIVERY_TOO_FAR:` copy if the server refuses |
| 12 | Place the order (COD) | "Place order · ₹X" → confirm dialog → "Yes, place order" | The surge flip and `PRICING_MISMATCH` paths behave as today; no submit at an unseen total |
| 13 | The order is created | `place_order` → `/orders/:id` | The cart and checkout coupon are cleared; an opted-in new address is saved |
| 14 | The status updates | The owner accepts with an ETA, then progresses on the dashboard | The tracker and ETA update within seconds; after the app is backgrounded and resumed, the status is correct (D13) |
| 15 | Order tracking | Watch it through to delivered; cancel a pending order; a declined order | Labels, the ETA window, the lost-race notice, the apology card and the review CTA all work |
| 16 | Order history | `/orders` | The order appears under In progress, then Past; Rate and Edit work |

**Owner regression:** owner login → `/dashboard`, with no customer shell → the new-order chime → accept and progress → the customer side updates → `/` redirects back to `/dashboard`.

### 15.3 Platforms and devices

| Target | Notes |
|---|---|
| Native Android, Ankit's Samsung (Android 16) | A debug build from `npm run build:cap`, then the wave bundle on the Capgo `staging` channel |
| An older or low-end Android (10–13), if one is available | Edge-to-edge differences, WebView performance |
| Android Chrome (web / PWA) | Gesture back, `100dvh`, keyboard |
| iPhone Safari (web / PWA) | Safe-area insets, 16 px inputs (no zoom), the Share → A2HS hint |
| Desktop Chrome at 1280 and 1440 | The desktop header and the checkout's right column |
| Viewports | 320 (no sideways scroll), 360 × 800, 393 × 873, 412 × 915, 768 × 1024, 1280 × 800 |
| Stress | Android system font set to Large; 200 % browser zoom; DevTools "Slow 4G" + 4× CPU slowdown |

### 15.4 Business-logic invariants to re-verify

1. Pricing is computed only by `computeCartPricing`. With no delivery config, every fee field is null, the UI shows a skeleton or "—", and placing is blocked (Principle 1).
2. `canPlace` is unchanged, now `canPlaceOrder` in `checkoutGate.ts`, moved verbatim.
3. Re-pricing at tap time; the two-step confirm with default focus on "Go back"; errors shown inside the dialog.
4. The `place_order` arguments: coupon keys only when a coupon is in use; commission never claimed.
5. Error prefixes: `COUPON_INVALID:`, `DELIVERY_TOO_FAR:`, `DELIVERY_PIN_REQUIRED:` and `PRICING_MISMATCH:` (with a config reload and the reload button).
6. The address is saved only after the order succeeds; the delivery pin is required; the geofence uses the ordering restaurant's radius.
7. Coupons: the pending code wins over the saved checkout coupon; `preview_coupon` before any apply; a re-check when the confirm dialog opens; one coupon or the festival discount, never both.
8. The cart: single-restaurant lock; replacing confirms first; persisted in `localStorage`; the item total only before checkout.
9. The geolocation engine invariants (§7.9).
10. Search semantics (token-AND, scoped dish fetch) and category matching.
11. Order status: the Realtime merge, cancel via the RPC with lost-race handling, ETA states, the contextual push prompt, the review CTA for completed orders only, the apology card for declined and expired.
12. Receipts render from the stored snapshot, never live config.
13. Reviews go through `submit_order_review` only.
14. Delete account: customers only; hidden in setup mode; reachable in-app; the public `/delete-account` page.
15. `ProtectedRoute`'s phone-verification gates are unchanged (except D4 and D5, which are deliberate).
16. `NativeBridge`: OAuth return, App Links, push taps, Capgo health signal and splash timing are unchanged.
17. Owners never see the customer shell; `/` redirects them.
18. Copy: never "app", "download" or "install" (`InstallPrompt` excepted); "Place order", never "Pay".

### 15.5 Accessibility checks

- A TalkBack walkthrough of §15.2 on the native app.
- A keyboard-only walkthrough on desktop (focus order, traps, ESC).
- Token contrast re-checked with a contrast tool.
- Optionally, axe in the browser on each screen. It is a manual run, not a dependency.

### 15.6 Performance checks

- The §12.1 table is re-measured; the §12.2 budgets are met or the overrun is explained to Ankit.
- Lighthouse mobile on the preview for `/` and `/restaurants/:id` is no worse than the Phase 0 baseline.
- No new long tasks while scrolling the menu (Chrome Performance panel at 4× CPU slowdown).

---

## 16. Release and rollback

### 16.1 Rules

- **Ankit reviews before anything leaves this machine.** Work stops at the local branch. Pushing, opening a PR (which also creates a Supabase preview branch, harmless here since there are no migrations), merging, deploying and OTA uploads each happen only on his go (a standing rule).
- **Never deploy during the peak hours** of 12–2 PM and 7–9:30 PM IST. Check the time with PowerShell's `Get-Date`, not Git Bash.
- **There are no database changes**, so there is no `db push` and no database rollback.

### 16.2 Per wave

1. `npm test`, `npm run lint`, `npm run build` and `npm run build:cap` are all green, and the §15 matrix has passed on a debug build.
2. On Ankit's go: push the branch and open a PR; the Vercel preview serves web testing.
3. **Native staging:** upload the bundle to the Capgo `staging` channel and point Ankit's device at `staging`. He tests the real OTA path on his phone.
4. Merge with a `package.json` version bump. The CI `ota` lane uploads to `production`; Vercel deploys the web build.
5. Watch Sentry, Vercel Analytics and Speed Insights for 48 hours.

**Rollback:** a Vercel instant rollback to the previous deployment, plus `npx @capgo/cli@latest channel set production in.redlotusfoods.app --bundle <previous version>`.

### 16.3 What would need a store build (optional, not planned)

| Item | Why it's native |
|---|---|
| `Keyboard.resizeOnFullScreen: true`, if the keyboard covers inputs under edge-to-edge (§7.7) | Plugin config lives in `android/app/src/main/assets/capacitor.config.json`, which OTA doesn't carry |
| Haptic feedback (`@capacitor/haptics`) | A new plugin |
| A new splash screen or launcher icon to match the redesign | `android/app/src/main/res/**` |

The redesign itself needs none of these. If any is wanted, it ships in the next tagged AAB, following CLAUDE.md's native rules.

---

## 17. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The geolocation engine regresses during the `BrowseProvider` move | A pure-move commit first; `decideFix` unit tests; a manual walkthrough of all location states, the override, the disclosure and cache hydration |
| R2 | A checkout pricing or placement regression | No logic edits (§8.4); the logic block is diffed in review; existing tests unchanged; new gate and bill-line tests; manual §15.2 rows 8–13 |
| R3 | Back-button changes confuse users | Explicit rules (§7.5), device-tested; the web is unchanged |
| R4 | Sticky bars collide with the keyboard or insets on Android 15 and 16 | The keyboard attribute hides them; device tests; the §16.3 fallback |
| R5 | Bundle growth | Budgets (§12.2) measured per wave; no new dependencies |
| R6 | Users see a mixed old and new app | Two waves (D14); tab screens get the header and token pass in Wave A (Phase 3) |
| R7 | The Figma Starter limits (200 calls a day, 3 pages) | §13.8 budget; batched scripts; the 3-page structure; upgrade path (D15) |
| R8 | A collision with the OTP plan (`/login`, `ProtectedRoute`, Profile's phone row) | §8.9 boundary; whichever lands second rebases; shared primitives |
| R9 | Play policy regressions | `LocationDisclosure` before any prompt and delete account reachable in-app are both in §15.4; the store screenshots are refreshed after release (§19) |
| R10 | Owners exposed to the customer shell | The role check in `shouldShowBottomNav`; the redirect kept; owner regression in §15.2 |
| R11 | Rails look empty or misleading with sparse data | Thresholds (D12); the hide-when-empty rules carried over from today |
| R12 | A text-scaling or low-end performance surprise | §15.3 stress row; no fixed text heights; CSS-only motion |
| R13 | The ScrollManager or View Transitions misbehave in the WebView | Feature-detect View Transitions (no-op where unsupported); the scroll manager is tested on the device |

---

## 18. Adjacent findings (not fixed by this plan)

Found while auditing. Each needs its own small plan or migration and Ankit's go.

| # | Finding | Impact | Suggested fix |
|---|---|---|---|
| **F1** | Customers can read only **open** restaurants and their **available** dishes (`restaurants_customer_select` and `menu_items_customer_select`, 002). Order history and order status join `restaurants(name)` and `menu_items(name, is_veg)`, so after closing time those joins come back null. | History shows "Restaurant"; the order page shows a blank restaurant name and "Item" for every dish, and renders the **non-veg** mark for a veg dish (`oi.menu_items?.is_veg` is falsy). This plan adds neutral fallbacks (§8.5). | Snapshot `restaurant_name` on `orders` and `item_name` / `is_veg` on `order_items` in `place_order`, or a SECURITY DEFINER order-detail RPC |
| **F2** | `authenticated` holds a **table-level** SELECT on `restaurants` (restated in 023). Only `anon` got the 016 column grant. | Any signed-in customer can read `restaurants.phone` and `owner_id` of open restaurants through the REST API, against CLAUDE.md's "never expose to customers" rule. The UI never selects them. | Revoke the table grant and add a column grant for `authenticated` (the 016 doctrine), after checking which columns the owner dashboard reads |
| F3 | Two WhatsApp numbers are in use (D17 / OTP plan D10) | Inconsistent support channel | Answer D17; `lib/contact.ts` makes the switch a one-line change |
| F4 | `Navbar` links admins to `/admin` and `/admin/orders`, which don't exist | Dead links for the admin | Remove them, or point them to `/` |
| F5 | Dead weight: `public/icons.svg` (a Vite template leftover, unreferenced); the `styled-components`, `@types/styled-components`, `babel-plugin-styled-components` and `react-router-dom` dependencies (none imported) | Housekeeping | A separate dependency PR. It changes the lockfile, so follow CLAUDE.md's `npm ci` / `--legacy-peer-deps` rule. |
| F6 | The Play Store graphics use a bold sans "RedLotus" wordmark; the app uses DM Serif Display | Brand inconsistency | Decide on one wordmark when the store screenshots are refreshed |
| F7 | The `promotions` 1:1 wording in `models.ts` and migration 017 doesn't match the 16:9 carousel | Admins may upload the wrong shape | Fix the comments and the admin guidance (doc-only) |
| F8 | No image resizing: full-size images are served to 112 px slots | Bandwidth on slow networks | Supabase image transformations (paid) or resized uploads; decide after Phase 9 measurements |
| F9 | CLAUDE.md still says "Website only — no app" | Stale guidance | Reword to the copy rule that remains: no "app/download/install" language in the UI |

---

## 19. Docs to sync after implementation

- **This file:** status, the decisions as answered, the phase log, and the Figma registry and changelog (Appendix B).
- **`CLAUDE.md` and `GEMINI.md`**, in lockstep:
  - the routes table (`/search`, `/profile/addresses`, the public `/restaurants/:id`, tabs and the shell);
  - the file map (`src/styles`, `components/ui`, `components/shell`, the new libs and pages, `BrowseContext`);
  - replace "Design tokens: defined locally per component" with the token system;
  - fonts (self-hosted) in the PWA section;
  - the `NativeBridge` back rules, system bars and keyboard;
  - the testing scope additions.
- **`design.md`:** mark it superseded by §5, or rewrite it as a pointer to the tokens and the Figma file.
- **`customer_ui_revamp_plan.md`:** a header note that its layout sections are superseded by this plan; its data contract still stands.
- **`capacitor_native_apps_plan.md`:** the hardware-back rules and the system-bar colour handling.
- **`v2_deferred_issues.md`:** menu sections, delivery-time estimates, popularity, per-step timestamps, the notification inbox, reorder and the "active order" nav badge. Mark the saved-address management UI as shipped (D11).
- **`store-listing/`:** retake the screenshots from the redesigned UI; Play requires screenshots to represent the app.

---

## 20. File checklist

**New**

- `src/styles/tokens.css`, `base.css`, `motion.css`
- `src/components/ui/`: `Button`, `IconButton`, `Chip`, `Badge`, `VegMark`, `RatingPill`, `AddToCartControl`, `SearchField`, `Sheet`, `Dialog`, `Skeleton`, `EmptyState`, `InlineNotice`, `SectionHeader`, `ListRow`, `SegmentedControl`, `Avatar`, `Card` (each with `.css`, and tests where §15.1 lists them)
- `src/components/shell/`: `CustomerShell`, `BottomNav`, `AppHeader`, `CartBar`, `StickyActionBar`, `ScrollManager`
- `src/components/restaurant/`: `RestaurantCard`, `RestaurantCardSkeleton`, `RestaurantHero`, `OfferStrip`
- `src/components/menu/`: `DishRow`, `DishRowSkeleton`, `MenuToolbar`
- `src/components/checkout/`: `BillDetails`, `CouponRow`, `AddressSection`
- `src/components/orders/`: `OrderStatusHero`, `OrderStatusTracker`, `OrderCard`
- `src/components/SignInPanel.tsx`
- `src/context/BrowseContext.tsx`
- `src/lib/`: `orderStatus.ts`, `contact.ts`, `billLines.ts`, `checkoutGate.ts`, `navVisibility.ts`, `backStack.ts`, `recentSearches.ts`, `browseOrigin.ts` (+ tests)
- `src/pages/search/SearchPage.tsx` (+ `.css`), `src/pages/profile/SavedAddresses.tsx` (+ `.css`)
- Self-hosted font files (location decided in Phase 1)

**Modified**

- `src/App.tsx` (shell layout route, the new routes, D4 and D5), `src/main.tsx` (style imports), `index.html` (fonts)
- `src/components/NativeBridge.tsx`: additive only (back stack, tab-root rules, system bars, keyboard)
- `src/context/AuthContext.tsx`: one additive line (`signOut` also clears recent searches)
- Customer pages: `DiscoveryPage`, `RestaurantMenu`, `Checkout`, `ConfirmOrderModal`, `CouponSheet`, `LocationConfirmModal`, `OrderStatus`, `CancelOrderModal`, `OrderHistory`, `OrderReview`, `CouponsPage`, `ReferralCard`, `Profile`, `DeleteAccountModal`
- Shared components: `AddressPickerSheet`, `PromoCarousel`, `CategoryRail`, `FeaturedRail` (renders the new card's `rail` variant), `RestaurantCardSlideshow` (styles), `CouponTicket` (styles), `StarRating` (tokens), `LocationDisclosure` (restyle), `ErrorBoundary` (restyle, contact constant), `PageLoader` (restyle)
- `src/lib/format.ts`; `vite.config.ts` (drop the Google Fonts runtime caching if D10)

**Retired, once nothing uses them**

- `AppTopBar` (replaced by `AppHeader`)
- `src/pages/restaurants/RestaurantList.css` (styles move into the components)
- Duplicated `formatPrice` and `formatDistance` helpers
- Per-file spinner and fade keyframes

**Not touched:** `src/pages/dashboard/**`; `src/pages/home/**` and the other marketing pages; `src/pages/login-signup/**` and `src/pages/auth/**`; every `src/lib` logic module not named above; `supabase/**`; `android/**`.

---

## 21. Sources (checked 2026-10-05)

- Figma MCP server access and rate limits: <https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/>
- Figma Code Connect, who can use it: <https://help.figma.com/hc/en-us/articles/23920389749655-Code-Connect>
- Figma plans and features (Starter file and page limits): <https://help.figma.com/hc/articles/360040328273>
- Figma MCP skills read from the server: `figma-generate-library`, `figma-design-to-code` (the skill index at `skill://index.json`)
- Repo facts: the files linked throughout; the baseline build and test runs on `main` @ `76e4a1f`

---

## Appendix A: `tokens.css` draft

```css
/* src/styles/tokens.css — RedLotus design tokens.
   Source of truth for code. Mirrored 1:1 by Figma variables whose WEB code
   syntax is var(--rl-…). Change both together (Appendix B changelog). */
:root {
  /* ── Colour · brand ─────────────────────────────────────── */
  --rl-color-brand-primary: #d63031;
  --rl-color-brand-pressed: #b71c1c;
  --rl-color-brand-soft: #fdecea;
  --rl-color-brand-border: #f5c2c2;

  /* ── Colour · text ──────────────────────────────────────── */
  --rl-color-text-primary: #1a1a1a;
  --rl-color-text-secondary: #4a4a4a;
  --rl-color-text-tertiary: #6f665e;
  --rl-color-text-disabled: #9a9189;
  --rl-color-text-on-brand: #ffffff;

  /* ── Colour · surfaces & borders ────────────────────────── */
  --rl-color-bg-page: #fdf8f6;
  --rl-color-bg-surface: #ffffff;
  --rl-color-bg-sunken: #f1ece7;
  --rl-color-bg-scrim: rgba(26, 26, 26, 0.4);
  --rl-color-border-default: #e8e2dc;
  --rl-color-border-subtle: #f0ebe5;
  --rl-color-border-strong: #8a8178;

  /* ── Colour · status ────────────────────────────────────── */
  --rl-color-success: #1f7a3a;
  --rl-color-success-soft: #eafce8;
  --rl-color-warning: #8a5a00;
  --rl-color-warning-soft: #fff8ee;
  --rl-color-warning-border: #f3d68a;
  --rl-color-danger: #c0392b;
  --rl-color-danger-soft: #fef2f2;
  --rl-color-danger-border: #fecaca;
  --rl-color-neutral-soft: #f5f0ed;

  /* ── Colour · food & ratings ────────────────────────────── */
  --rl-color-veg: #1f7a3a;
  --rl-color-nonveg: #8b4513;
  --rl-color-star: #f5a623;

  /* ── Type ───────────────────────────────────────────────── */
  --rl-font-sans: "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --rl-font-display: "DM Serif Display", Georgia, serif;
  --rl-font-weight-regular: 400;
  --rl-font-weight-medium: 500;
  --rl-font-weight-semibold: 600;
  --rl-font-weight-bold: 700;
  --rl-font-size-micro: 11px;   --rl-line-height-micro: 14px;
  --rl-font-size-caption: 12px; --rl-line-height-caption: 16px;
  --rl-font-size-body-sm: 13px; --rl-line-height-body-sm: 18px;
  --rl-font-size-body-md: 14px; --rl-line-height-body-md: 20px;
  --rl-font-size-body-lg: 16px; --rl-line-height-body-lg: 24px;
  --rl-font-size-title-sm: 16px; --rl-line-height-title-sm: 22px;
  --rl-font-size-title-md: 18px; --rl-line-height-title-md: 24px;
  --rl-font-size-title-lg: 22px; --rl-line-height-title-lg: 28px;
  --rl-font-size-display: 28px;  --rl-line-height-display: 34px;

  /* ── Space & layout ─────────────────────────────────────── */
  --rl-space-0-5: 2px;  --rl-space-1: 4px;   --rl-space-2: 8px;
  --rl-space-3: 12px;   --rl-space-4: 16px;  --rl-space-5: 20px;
  --rl-space-6: 24px;   --rl-space-8: 32px;  --rl-space-10: 40px;
  --rl-space-12: 48px;  --rl-space-16: 64px;
  --rl-gutter: 16px;
  --rl-content-max: 1200px;
  --rl-reading-max: 720px;
  --rl-header-height: 56px;
  --rl-bottomnav-height: 56px;
  --rl-cartbar-height: 56px;
  --rl-sticky-cta-height: 72px;
  --rl-touch-min: 44px;
  --rl-touch-nav: 48px;

  /* ── Radius & elevation ─────────────────────────────────── */
  --rl-radius-xs: 6px;  --rl-radius-sm: 8px;  --rl-radius-md: 12px;
  --rl-radius-lg: 16px; --rl-radius-xl: 24px; --rl-radius-full: 999px;
  --rl-shadow-1: 0 1px 2px rgba(26, 26, 26, 0.06), 0 1px 3px rgba(26, 26, 26, 0.04);
  --rl-shadow-2: 0 4px 12px rgba(26, 26, 26, 0.08);
  --rl-shadow-3: 0 12px 32px rgba(26, 26, 26, 0.16);
  --rl-shadow-brand: 0 6px 16px rgba(214, 48, 49, 0.28);

  /* ── Motion ─────────────────────────────────────────────── */
  --rl-duration-fast: 120ms;
  --rl-duration-base: 200ms;
  --rl-duration-slow: 320ms;
  --rl-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --rl-ease-decelerate: cubic-bezier(0, 0, 0, 1);
  --rl-ease-accelerate: cubic-bezier(0.3, 0, 1, 1);

  /* ── Layers ─────────────────────────────────────────────── */
  --rl-z-sticky: 20;
  --rl-z-cartbar: 30;
  --rl-z-bottomnav: 40;
  --rl-z-header: 50;
  --rl-z-overlay: 100;
  --rl-z-toast: 200;
  --rl-z-offline: 300;
}

@media (min-width: 768px) {
  :root { --rl-gutter: 24px; }
}
@media (min-width: 1024px) {
  :root { --rl-gutter: 32px; }
}
@media (prefers-reduced-motion: reduce) {
  :root {
    --rl-duration-fast: 0ms;
    --rl-duration-base: 0ms;
    --rl-duration-slow: 0ms;
  }
}
```

## Appendix B: Figma registry and token changelog (fill in during the work)

| Item | Value |
|---|---|
| Design file | *URL / file key: set in Phase 0* |
| FigJam file | *URL / file key: set in Phase 0* |
| Page IDs | Foundations: … · Components: … · Screens: … |
| Variable collections | Primitives: … · Tokens: … |
| Key component-set IDs | Button: … · DishRow: … · RestaurantCard: … · BottomNav: … |
| Run ledger | `.figma/` (git-ignored) |

| Date | Token / component | Change | Code PR / commit |
|---|---|---|---|
| | | | |

## Appendix C: Data audit SQL (read-only, run in the SQL Editor)

Sizes the rails, thresholds and layouts with real data before any design work. It reads catalogue tables only; no customer data. Run each query on its own: the editor shows only the last statement's result.

```sql
-- C1. Restaurants: how many, imagery, ratings, longest strings
SELECT
  count(*) FILTER (WHERE is_active)                      AS active,
  count(*) FILTER (WHERE is_active AND is_open)          AS open_now,
  count(*) FILTER (WHERE cardinality(image_urls) > 0)    AS with_slideshow,
  count(*) FILTER (WHERE image_url IS NOT NULL)          AS with_lead_image,
  count(*) FILTER (WHERE is_featured)                    AS featured,
  count(*) FILTER (WHERE rating_count >= 5)              AS rated_5_plus,
  max(length(name))                                      AS longest_name,
  max(length(cuisine_type))                              AS longest_cuisine,
  max(length(address))                                   AS longest_address
FROM public.restaurants;

-- C2. Dishes: imagery, descriptions, ratings, string lengths
SELECT
  count(*)                                                        AS available_items,
  count(*) FILTER (WHERE image_url IS NOT NULL)                   AS with_image,
  count(*) FILTER (WHERE coalesce(description, '') <> '')         AS with_description,
  count(*) FILTER (WHERE rating_count >= 3)                       AS rated_3_plus,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY length(name))       AS median_name_len,
  max(length(name))                                               AS max_name_len,
  max(length(description))                                        AS max_desc_len,
  min(price) AS min_price, max(price) AS max_price
FROM public.menu_items
WHERE is_available;

-- C3. Menu size per restaurant (drives the in-menu search / jump-list need)
SELECT r.name, count(m.id) AS items
FROM public.restaurants r
LEFT JOIN public.menu_items m ON m.restaurant_id = r.id AND m.is_available
WHERE r.is_active
GROUP BY r.name
ORDER BY items DESC;

-- C4. Discovery content
SELECT count(*) AS live_promotions FROM public.promotions
WHERE active AND (starts_at IS NULL OR now() >= starts_at)
             AND (ends_at   IS NULL OR now() <  ends_at);
SELECT slug, label, image_url IS NOT NULL AS has_image
FROM public.menu_categories WHERE active ORDER BY display_order;
```

## Appendix D: Completion report template (from the brief)

Fill this in at the end of each wave and keep it in this file.

1. **Screens redesigned**
2. **Components created or modified**
3. **Existing functionality preserved:** §15.4 checklist results
4. **Performance:** the §12.1 table, before and after
5. **Issues that could not be safely changed**
6. **Build and test results:** `npm test`, lint, `build`, `build:cap`, device matrix
7. **Recommended next UI improvements**
