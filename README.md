# Customer Search — Feature Design & Implementation Doc

## 1. Context & Goal

Customers open `/restaurants` and see a distance-sorted grid of nearby kitchens, but there is
**no way to search**. To find a specific dish ("biryani", "paneer") a customer must open each
restaurant's menu one at a time. In a food app people think in terms of *food*, not the names
of local kitchens they don't know yet — so the most valuable missing capability is: *type what
you want, and see which nearby kitchen makes it.*

**Goal:** add a search box on `/restaurants` that filters **restaurants** (name/cuisine) **and
dishes** (name/description) in a single view, **strictly confined to the customer's delivery
radius**, with a **veg / non-veg** toggle on dish results.

### Scale & multi-city (the constraints that shape the design)
- Production today: **~15 restaurants, ~300–400 dishes** (the repo's `supabase/seed.sql` 5
  restaurants / 40 dishes is **local dummy data only**).
- The business is **expanding to other cities**.
- **Hard requirement:** restaurants and dishes from **other cities must never appear** in search
  results, and — because the dish table will grow large across cities — the **dishes table must
  never be fetched globally** to the browser.

**How the design satisfies this:** search is bounded by the **same 4 km delivery radius**
(`RADIUS_KM`) the grid already uses. Radius-from-GPS naturally isolates a customer to their own
locality (a user in City A is never within 4 km of City B). Dishes are fetched **only for the
restaurants already inside that radius** (`.in('restaurant_id', nearbyIds)`), so other cities'
dishes are neither shown nor downloaded. Text + veg matching then runs in the browser over that
small, radius-bounded set.

This remains a **frontend-only** change: no DB migration, no RPC, no new route, no navbar change.

---

## 2. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Search scope | Restaurants **+** dishes | Highest discovery value |
| Placement | Inline on `/restaurants` (no new route) | Reuses GPS/radius flow; least infra |
| Data strategy | **Nearby-scoped fetch + client-side match** | Dishes fetched only for in-radius restaurants; instant matching; no migration |
| Search radius | **Same 4 km delivery radius** (`RADIUS_KM`) | Only orderable results; auto-excludes other cities |
| Multi-city isolation | Radius-from-GPS + scoped dish fetch | Other cities never shown **or** fetched (dishes) |
| Restaurant match fields | `name` + `cuisine_type` | Both customer-meaningful |
| Dish match fields | `name` + `description` | Ingredient terms work (e.g. "aloo") |
| Match algorithm | Token-AND substring, case-insensitive | Predictable; "paneer pizza" → "Paneer Makhani Pizza" |
| Veg filter | **All / Veg / Non-veg** chips on dish results | Only dishes carry `is_veg` |
| Dish tap | Open restaurant menu (`/restaurants/:id`) | Simplest; no `RestaurantMenu` change |

---

## 3. Where this lives in the code

Single host: **`src/pages/restaurants/RestaurantList.tsx`** (+ its CSS). It already owns the
restaurants fetch, the GPS→cache→radius pipeline, the `visible` list (within-radius,
distance-sorted), `EmptyState`, and the card markup. **The existing location/grid flow is left
untouched** — search layers on top of `visible`, so restaurant results inherit radius +
open/active gating for free, and the dish fetch is keyed off the same `visible` set.

New pure module: **`src/lib/search.ts`** (+ `src/lib/search.test.ts`) — match logic only,
no React, following the repo's "tested pure logic in `src/lib`" convention (`geo.ts`,
`pricing.ts`, `eta.ts`).

---

## 4. Data layer (`RestaurantList.tsx`)

### 4.1 What stays the same
The existing mount effect that fetches restaurants and the geolocation pipeline are **unchanged**.
`visible` (within-radius, distance-sorted `{ r, distance }[]`) remains the source of truth for the
grid and for restaurant search results.

> Note: the restaurants fetch is still global (then haversine-filtered client-side). Restaurants
> are a small table relative to dishes (~1:25), so this is acceptable near-term; geo-scoping it
> (bounding box) is listed as a future optimisation in §14.

### 4.2 Dishes — fetched **scoped to the in-radius restaurants**, lazily
```ts
type DishRow = Pick<MenuItem, "id" | "restaurant_id" | "name" | "description" | "price" | "is_veg">;

const [menuItems, setMenuItems] = useState<DishRow[]>([]);
const [dishesStatus, setDishesStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
const [searchFocused, setSearchFocused] = useState(false); // set true on first input focus
const fetchedKeyRef = useRef<string>("");                   // visibleIds set we last fetched for
```

Stable key for the current nearby set:
```ts
const visibleIdsKey = useMemo(
  () => visible.map((v) => v.r.id).sort().join(","),
  [visible],
);
```

Fetch effect — runs the first time the user engages search (focus **or** typing) and refetches
only if the nearby set changed (e.g. the customer moved and a restaurant entered/left the radius):
```ts
useEffect(() => {
  const engaged = searchFocused || normalize(query) !== "";
  if (!engaged || visibleIdsKey === "") return;
  if (visibleIdsKey === fetchedKeyRef.current) return; // already have this nearby set

  const ids = visibleIdsKey.split(",");
  let cancelled = false;
  setDishesStatus("loading");
  (async () => {
    const { data, error: mErr } = await supabase
      .from("menu_items")
      .select("id, restaurant_id, name, description, price, is_veg")
      .in("restaurant_id", ids);
    if (cancelled) return;
    if (mErr) {
      setDishesStatus("error");           // NON-FATAL: restaurants stay searchable
      return;
    }
    setMenuItems((data ?? []) as DishRow[]);
    fetchedKeyRef.current = visibleIdsKey;
    setDishesStatus("loaded");
  })();
  return () => { cancelled = true; };
}, [searchFocused, query, visibleIdsKey]);
```

Rules & guarantees:
- **Radius/city isolation:** the request carries `restaurant_id=in.(<nearby ids>)`, so only dishes
  from restaurants already inside the 4 km radius are fetched. Other cities' dishes never leave the
  DB. (RLS `menu_items_customer_select` additionally enforces `is_available` + visible restaurants.)
- **Lazy:** browse-only sessions never fetch dishes. Prefetch on **focus** means dishes are
  usually ready before the first keystroke completes.
- **Bounded payload:** the result set is whatever is within 4 km (tens of restaurants → a few
  hundred dish rows worst case), regardless of total catalogue size or number of cities.
- **Non-fatal:** on error, dishes stay empty and `dishesStatus="error"`; restaurant search + grid
  keep working.
- `price` may arrive as a string (`numeric`) — coerce with `Number(...)` at format time.
  `is_veg` is `boolean NOT NULL` — no null handling.

---

## 5. Search logic module — `src/lib/search.ts`

Pure functions, fully unit-tested.

```ts
/** lowercase, trim, collapse internal whitespace; null/undefined → "" */
export function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * True iff EVERY whitespace-separated token of `query` is a substring of `haystack`.
 * Empty/whitespace query → false (callers treat empty query as "not searching").
 */
export function matchesAllTokens(haystack: string, query: string): boolean {
  const h = normalize(haystack);
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((t) => h.includes(t));
}

export function restaurantMatches(
  r: { name: string; cuisine_type: string | null },
  query: string,
): boolean {
  return matchesAllTokens(`${r.name} ${r.cuisine_type ?? ""}`, query);
}

export function dishMatches(
  d: { name: string; description: string | null },
  query: string,
): boolean {
  return matchesAllTokens(`${d.name} ${d.description ?? ""}`, query);
}
```

**Semantics & examples**
- Case-insensitive: `"PANEER"` matches "Paneer Tikka".
- Token-AND, non-contiguous: `"veg rice"` matches "Veg Fried Rice".
- Single token = plain substring: `"bir"` matches "Chicken Biryani".
- Description matching: `"chinese"` matches "Hot & Sour Soup" (desc "…Indo-Chinese soup…").
- Out of scope: diacritic folding, fuzzy/typo tolerance, ranking.

---

## 6. Component logic (`RestaurantList.tsx`)

### 6.1 Derived values (`useMemo`)
```ts
const searching = useMemo(() => normalize(query) !== "", [query]);
const canSearch = !error && !locationError && visible.length > 0;

// id → { name, distance } for dish-row enrichment + a defensive radius guard.
const restaurantById = useMemo(
  () => new Map(visible.map((v) => [v.r.id, { name: v.r.name, distance: v.distance }])),
  [visible],
);

const restaurantResults = useMemo(
  () => (searching ? visible.filter(({ r }) => restaurantMatches(r, query)) : []),
  [searching, visible, query],
);

// Dishes are already nearby-scoped by the fetch; the .has() guard drops any row whose
// restaurant just left the radius before a refetch, and supplies name/distance.
const dishCandidates = useMemo(() => {
  if (!searching) return [];
  return menuItems
    .filter((d) => restaurantById.has(d.restaurant_id) && dishMatches(d, query))
    .map((d) => {
      const meta = restaurantById.get(d.restaurant_id)!;
      return { dish: d, restaurantName: meta.name, distance: meta.distance };
    })
    .sort((a, b) => a.distance - b.distance || a.dish.name.localeCompare(b.dish.name));
}, [searching, menuItems, restaurantById, query]);

const dishResults = useMemo(() => {
  if (vegFilter === "all") return dishCandidates;
  const wantVeg = vegFilter === "veg";
  return dishCandidates.filter(({ dish }) => dish.is_veg === wantVeg);
}, [dishCandidates, vegFilter]);

const dishesPending = searching && dishesStatus === "loading";
const noTextMatches =
  searching && !dishesPending && restaurantResults.length === 0 && dishCandidates.length === 0;
```

### 6.2 Render tree (inside `.rlist__container`)
Order: `header` → **search bar** → `offer strip` → **results | grid | existing empty states**.

- **Header:** unchanged; hide the "N nearby" count pill when `searching`.
- **Search bar:** render when `canSearch`. Anatomy: leading `Search` lucide icon, text input
  (`onFocus` → `setSearchFocused(true)`), trailing clear `X` (shown when `query !== ""`).
- **Offer strip:** existing block + `&& !searching`.
- **Body:**
  - `!canSearch` → existing branches verbatim (skeleton, fetch error, location error,
    `NO_RESTAURANTS_CONFIG`, `NONE_IN_RANGE_CONFIG`).
  - `canSearch && !searching` → existing grid.
  - `canSearch && searching` → **results view**:
    - `restaurantResults.length > 0` → **Restaurants** section (title + count). Reuse the existing
      card by extracting the current `<Link className="rlist__card">…` block into a local
      `renderCard(entry, idx)` used by both grid and this section (keep `getCardImages`,
      `RestaurantCardSlideshow`, distance badge, `animationDelay`/`staggerMs`).
    - **Dishes** area:
      - `dishesPending && dishCandidates.length === 0` → Dishes header + a small "Searching
        dishes…" loader (so we never flash "no results" while the fetch is in flight).
      - else if `dishCandidates.length > 0` → **Dishes** section: header row = title + count
        (`dishResults`) + **veg chips** (`All`/`Veg`/`Non-veg`, bound to `vegFilter`); body =
        dish rows (§7), or an inline `No {Veg|Non-veg} dishes match "{query}"` when the toggle
        empties a non-empty list.
      - else → nothing (omit Dishes section).
    - `noTextMatches` → `EmptyState` with `noMatchConfig(query)` (replaces empty sections).
    - `dishesStatus === "error"` (and no dishes) → optional subtle inline note "Couldn't load
      dishes — restaurant results still shown."

### 6.3 Interactions
- Clear `X` and **Escape** → `setQuery("")`.
- No debounce (matching ~hundreds of rows is instant). No autofocus (don't pop the mobile keyboard).

---

## 7. Dish row markup & styling

Each dish result is a full-row `<Link to={'/restaurants/' + d.restaurant_id}>`:
```
[veg dot]  Dish Name                         ₹Price
           Restaurant Name · 0.4 km
```
- Veg dot: square FSSAI marker — green `#2ECC71` (veg) / red `#E74C3C` (non-veg), matching the
  `rmenu__veg` treatment in `RestaurantMenu`. `aria-label="Vegetarian" | "Non-vegetarian"`.
- Price: local `formatPrice(Number(d.price))` (mirror `RestaurantMenu.tsx`; integers → no decimals).
- Distance: reuse existing `formatDistance(distance)`.

---

## 8. CSS additions (`RestaurantList.css`, `rlist__` prefix)

Match existing tokens (brand `#D63031`, border `#E8E2DC`, warm bg):
- `rlist__search`, `rlist__search-input`, `rlist__search-icon`, `rlist__search-clear`.
- `rlist__results`, `rlist__section`, `rlist__section-head`, `rlist__section-title`,
  `rlist__section-count`.
- `rlist__vegfilter`, `rlist__vegchip`, `rlist__vegchip--active`.
- `rlist__dishes`, `rlist__dish`, `rlist__dish-veg`, `rlist__dish-name`, `rlist__dish-price`,
  `rlist__dish-sub`.
- `rlist__results-empty` (veg-filtered note), `rlist__dishes-loading` (in-flight loader).

Responsive: chips wrap under the title `<480px`; reuse `.rlist__grid` for the restaurant section.

**Exact copy strings**
- Input placeholder & `aria-label`: `Search food or restaurants`
- Clear `aria-label`: `Clear search`
- Section titles: `Restaurants`, `Dishes`
- Veg chips: `All`, `Veg`, `Non-veg`
- Dishes loader: `Searching dishes…`
- No-match (`noMatchConfig(query)`): title `No results for "{query}"`; body
  `Try a shorter or different word — a dish like "biryani" or a place like "Punjab". Still stuck? Chat with us.`;
  `waMessage`: `Hi RedLotus, I searched for "{query}" but couldn't find it. Can you help me order?`
  (build dynamically, same pattern as `FETCH_ERROR_CONFIG` spread + `body`).
- Veg-filtered empty: `No {Veg|Non-veg} dishes match "{query}"`

---

## 9. Edge cases & expected behavior

| Situation | Behavior |
|---|---|
| Restaurant/dish in another city (outside radius) | Never fetched (dishes) / never shown (restaurants) — excluded by the 4 km gate |
| Location resolving / errored / no GPS | No search bar (`canSearch` false); existing states unchanged |
| `noneInRange` (located, 0 within 4 km) | No search bar; existing `NONE_IN_RANGE_CONFIG` |
| User searches before dishes load | "Searching dishes…" loader; no premature "no results" |
| Dish fetch fails | Dishes empty + optional inline note; restaurants + grid still work |
| Customer moves, nearby set changes | `visibleIdsKey` changes → dishes refetched for the new set; stale rows dropped by `.has()` guard |
| Query matches restaurants only / dishes only | Show only the relevant section |
| Veg toggle empties a non-empty dish list | Keep Dishes header + chips + inline "No … dishes match" |
| Same dish name at 2 restaurants | Two rows, disambiguated by the restaurant-name subline |
| Whitespace-only query | `searching === false` → grid (not a no-match state) |
| Open/close & availability changes mid-session | Not reflected until reload — same as today's grid (Realtime out of scope) |

---

## 10. Testing

### 10.1 Unit — `src/lib/search.test.ts` (Vitest)
Cover `normalize`, `matchesAllTokens`, `restaurantMatches`, `dishMatches`:
- empty / whitespace-only query → `false`
- case-insensitivity (`"PANEER"` vs "Paneer Tikka")
- partial token (`"bir"` → "Chicken Biryani")
- multi-token non-contiguous (`"veg rice"` → "Veg Fried Rice")
- token-AND negative (`"paneer naan"` → "Paneer Tikka Masala" = false)
- cuisine-only hit (`"chinese"` → Dragon House via `cuisine_type`)
- description-only hit (`"chinese"` → "Hot & Sour Soup" via description)
- `null` cuisine / `null` description don't throw and don't match

### 10.2 Manual QA (`npm run dev`, customer login)
> Local dev uses the **seed** dataset (`supabase/seed.sql`: 5 restaurants / 40 dishes, single
> village) — production is larger, but behavior is identical. Seed restaurants sit at
> ~`28.034, 75.789`, outside the `VILLAGE_CENTRE` override; use **Chrome DevTools → Sensors →
> Location** set to ~`28.035, 75.789` so the 4 km filter yields results, then test.

- **Scoped fetch (the multi-city guarantee):** open the **Network** tab, focus the search box,
  confirm the `menu_items` request URL contains `restaurant_id=in.(…)` listing only the nearby
  restaurant ids — i.e. dishes are **not** fetched globally. (Optional: insert one far-away
  restaurant + dish in a scratch DB and confirm it never appears and is never fetched.)
- `paneer` → Restaurants 0 (hidden); Dishes 3: Paneer Tikka Masala (Punjab Dhaba), Chilli Paneer
  (Dragon House), Paneer Makhani Pizza (Pizza Junction). All veg.
- `paneer` + **Non-veg** → 0 → inline note; **Veg** → 3.
- `punjab` → Restaurants 1 (Punjab Dhaba); Dishes hidden.
- `biryani` → Dishes 1 (Chicken Biryani, Punjab Dhaba).
- `chinese` → Restaurants 1 (Dragon House); Dishes 2 (Hot & Sour Soup, Chicken 65 — via desc).
- `zzz` → no-match EmptyState. Clear (`X`/Esc) → grid returns; tap a dish → its restaurant menu.

### 10.3 Gates
`npm test` (new + existing green) · `npm run lint` · `npm run build` (tsc clean).

---

## 11. Performance

- Dish fetch is bounded by the 4 km radius (independent of total catalogue / city count).
- Client-side matching over a few-hundred-row nearby set is sub-millisecond; all derived values
  memoised. No debounce / virtualization needed.
- Lazy fetch (on focus) means browse-only sessions cost zero extra queries.

---

## 12. Docs to update (structural change — keep mirrors in sync)

- **New:** `src/docs/customer_search_plan.md` (this document).
- **`CLAUDE.md`:**
  - `/restaurants` routes-table row → note the inline search (restaurants + dishes, **nearby-scoped
    dish fetch**, 4 km radius, client-side match, veg/non-veg toggle).
  - `lib/` file map → add `search.ts  matchesAllTokens()/restaurantMatches()/dishMatches() — customer search filtering`.
  - Testing scope line → add `src/lib/search.ts`.
- **`GEMINI.md`:** mirror the same edits.

---

## 13. Files touched

| Action | Path |
|---|---|
| New | `src/lib/search.ts`, `src/lib/search.test.ts`, `src/docs/customer_search_plan.md` |
| Edit | `src/pages/restaurants/RestaurantList.tsx`, `src/pages/restaurants/RestaurantList.css` |
| Edit | `CLAUDE.md`, `GEMINI.md` |

No migration · no RPC · no new route · no navbar change · no `RestaurantMenu` change.

---

## 14. Out of scope (possible follow-ups)

- **Server-side search RPC** — only if a single 4 km radius ever holds many thousands of dishes.
- **Geo-scope the restaurant fetch** (lat/lng bounding box) when cross-city restaurant counts grow
  large; pairs naturally with the scoped dish fetch.
- **Per-city / configurable radius** instead of the fixed 4 km `RADIUS_KM`.
- Deep-link + scroll/highlight to the tapped dish; typo tolerance / synonyms; recent searches;
  search analytics; live (Realtime) availability in results.
