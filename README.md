# Phone-OTP Login for Customers — Build Plan v1

> **Status:** Draft for review. Product decisions D1–D4 were locked by Ankit on 2026-09-25; D5–D10 are recommendations awaiting a yes/no (§0).
> **Author:** Ankit (drafted with Claude)
> **Revision:** v1 — 2026-09-25
> **Depends on:** 002 (`handle_new_user`, `users` RLS), 005 (phone-verified guard trigger), 016 / 019 / 023 (column-grant doctrine), and the MSG91 account + Airtel-DLT OTP template that `send-otp` already uses (MSG91 template id `69f2350acf9869ba19066fc2`, header `RDLOTS` — `phone_verification_plan.md` §3.1).
> **Supersedes:** customer sign-up and log-in in `phase1_customer_mvp_plan.md` (email + password, Google, `/profile?setup=true`) and the customer half of `phone_verification_plan.md` (`send-otp` / `verify-otp` retire in Phase 5). Takes "OTP-based login" off the v2-deferred list.
> **Migrations:** `024_column_write_grants.sql` (security hotfix, ships first and on its own, §2) · `025_orders_write_grants.sql` (orders audit fix, §2.5) · `026_owner_self_review_guard.sql` (§2.7) · `027_phone_otp_login.sql` (§4) · `028_phone_otp_cleanup.sql` (after the transition window, §10).

## At a glance

- Customers log in with **mobile number → 6-digit SMS code → name (first time only)**, then land back where they were. No email, no password, no Google.
- **Supabase Auth owns the OTP.** It generates the code, stores it hashed, checks it, rate-limits it and issues the session. **MSG91 only delivers it**, through the same DLT-approved template. The link between them is Supabase's *Send SMS hook*, which calls a new Edge Function, `auth-send-sms`.
- **Restaurant partners and admin keep email + password**, on a new `/partner/login` page.
- **Existing customers keep their accounts.** Before launch, every verified phone gets attached to its existing auth user. Typing that number then opens the same account, with its orders, reviews and saved addresses.
- **Found while planning, fix first:** any signed-in customer can currently make themselves an admin (§2). This was confirmed on production on 2026-09-25. Migration 024 closes it and doesn't depend on anything else in this plan.

---

## 0. What this plan needs from Ankit

| # | Decision | Status | Why it matters |
|---|---|---|---|
| **D1** | Who logs in with OTP | **Locked: customers only.** Partners and admin keep email + password at `/partner/login`. | Partners are onboarded by hand and stay signed in, and they aren't the ones getting stuck. Keeps partner accounts out of the migration. |
| **D2** | Google + email/password for customers | **Locked: removed.** | Existing customers reach their old account by typing their verified number (§7). This deletes email confirmation, forgot-password and the native Google browser trip. |
| **D3** | What a new customer fills in after the OTP | **Locked: name only, required.** | `place_order` already refuses an empty name (022, step (a)). New customers give no email. |
| **D4** | SMS auto-read | **Locked: not in v1.** | Reuses today's template. Auto-read needs a new DLT template and a store build (§13). |
| **D5** | Ship the **024 security hotfix** now, on its own | **✅ Shipped 2026-09-25, 16:25 IST** (PR #58). Verified on production (§2.6). | Any signed-in customer could become admin (§2). |
| **D6** | Make restaurant menus public (remove the login wall on `/restaurants/:id`) | **Recommend: yes, in the same launch.** | CLAUDE.md and migration 016 already say logged-out visitors can browse menus. The route guard contradicts that: it sends visitors to login on their first restaurant tap (§8.1). |
| **D7** | SMS limits | **Recommend:** 60 SMS/hour project-wide, 10 per number per 24 h, 20 per IP per hour, 30 s between resends. | Caps the cost of abuse at about ₹12/hour in the worst case (§9). The Supabase limits are Dashboard settings. The per-number and per-IP caps are Edge Function env vars. |
| **D8** | Play reviewer login | **Recommend:** a SIM that RedLotus owns, registered in Supabase as a test number with a fixed OTP. | Reviewers can't receive our SMS. Putting a fixed code on someone else's real number would give that person's account to anyone who knows the code. |
| **D9** | How long to wait before switching off Google and the old OTP functions | **Recommend: at least 30 days, and until 95%+ of active app installs run the new bundle** (Capgo stats). | Installed apps show the old login screen until the OTA lands, so the old paths must keep working until then (§10). |
| **D10** | WhatsApp help number on the login screen | **Assumed: keep `919460049608`** (what Login/Signup show today). CLAUDE.md lists `916378939472`. Confirm which is right. | The new screen keeps the "Can't log in?" link. |

---

## 1. Why this change

### 1.1 What a new customer goes through today

Traced from `Signup.tsx`, `Login.tsx`, `AuthCallback.tsx`, `Profile.tsx` and `VerifyPhone.tsx`:

| Path | Steps today | What goes wrong for our customers |
|---|---|---|
| **Email** | `/signup`: name + email + password → "Check your inbox" → leave the app, find the email, tap the link → `/auth/callback` → `/verify-phone`: type number → SMS → type a 4-digit OTP | They need an email inbox they actually check, and a password to invent and remember. The flow also leaves the app halfway through. |
| **Google (web)** | Continue with Google → account picker → `/auth/callback` → `/profile?setup=true`: type number → `/verify-phone` → OTP | They need a Google account signed in on the phone, plus two extra screens. |
| **Google (Android app)** | A browser opens over the app → Google → return via the `in.redlotusfoods.app://` scheme → `/profile?setup=true` → `/verify-phone` → OTP | The browser trip is the most fragile step. It has its own failure copy (`describeOAuthReturnError`) because it fails in several ways. |
| **Returning, signed out** | Email + password, or Google | A forgotten password means an email reset link. |

Two things make every path worse:

- **They all end on the storefront, not where the customer was.** `ProtectedRoute` redirects to `/login` without a return path. The post-login gates then send customers to `/restaurants` (which redirects to `/`).
- **The login wall comes earlier than intended.** The storefront's cards and the featured rail link to `/restaurants/:id`, and that route is wrapped in `ProtectedRoute` (`App.tsx`). A logged-out visitor therefore hits login on their **first restaurant tap**, not at checkout. After login they come back to the storefront, not to the restaurant they tapped. This happens even though 016 made menus readable to anonymous visitors.

### 1.2 What it becomes

```
Tap "Log in", or reach checkout
  → /login?next=/checkout
     1. Mobile number    [+91 | 98765 43210]              [Get OTP]
     2. 6-digit code     [______]  (checks itself on the 6th digit)   Resend in 0:30
     3. Your name        (first login only)                [Continue]
  → back to /checkout
```

Returning customers skip step 3. A restaurant partner taps **"Restaurant partner? Log in with email"** and goes to `/partner/login`.

### 1.3 Why phone OTP fits RedLotus

- **The phone number is already the account that matters.** Ordering requires a verified phone, the rider calls it, and payment is cash on delivery. Today it is verified as a *fourth* step; this plan makes it the only step.
- **The SMS setup is already live.** The MSG91 wallet, the Airtel DLT header `RDLOTS` and the approved OTP template are in production and delivering today.
- **Supabase has phone-OTP login built in.** MSG91 isn't one of its built-in SMS providers, but the Send SMS hook plugs it in (§3).
- **It removes code.** Gone: `Signup.tsx`, `googleAuth.ts`, the native OAuth return path in `NativeBridge`, forgot-password for customers, the Google setup gate and, after cleanup, two Edge Functions.
- **Every customer is phone-verified by construction.** `phone_verified` stops being a separate hurdle.
- **iOS gets easier.** App Store Guideline 4.8 says an app offering Google sign-in must also offer an equivalent privacy-focused login, which in practice means Sign in with Apple. It doesn't apply to an app's own phone login.
- **It ships to the Android app by OTA.** No new plugin, no new permission and no store build are needed (§8.10).

### 1.4 What does not change

- Logged-out browsing. With D6 this extends to menus. Login is triggered by checkout, orders, profile and reviews.
- Checkout still needs a name and a verified phone. Every OTP customer has a verified phone by construction.
- Partners use the same email + password accounts and the same dashboard.
- Sessions: Supabase keeps people signed in until they sign out. The session lives in localStorage on the web and in the Android Keystore in the app. `supabaseClient.ts` doesn't change: `verifyOtp` returns a session directly under both the web (implicit) and native (PKCE) flow types.
- COD, pricing, orders, push, the owner dashboard: untouched.

---

## 2. Phase 0 — security hotfix (migration 024, ship first)

### 2.1 The hole

`users_self_update` (002) limits a customer to **their own row**, but not to **particular columns**. `authenticated` also holds a table-level `UPDATE` grant on `public.users`: production's legacy default, restated by 023. Nothing guards `role`. The only trigger on `users` is the 005 phone trigger, which fires on `phone` / `phone_verified` changes only.

So a signed-in customer can send a PATCH that sets their own `role` to `admin`. From then on `get_user_role()` returns `admin`, and every admin `FOR ALL` policy applies to them. That covers every user's name, phone and email, every order, every saved address and pin (015), restaurants, menus, promotions, reviews and device tokens.

**Confirmed on production on 2026-09-25** with a read-only privilege query. It read no rows and attempted nothing:

| Check | Production result |
|---|---|
| `authenticated` holds table-level UPDATE on `users` | `true` |
| `authenticated` can UPDATE `users.role` | **`true`** |
| Triggers on `users` | `reset_phone_verified_trg` only |
| `users_self_update` WITH CHECK | `(auth.uid() = id)` — row only |
| `authenticated` can UPDATE `restaurants.is_featured` | `true` |
| `authenticated` can UPDATE `menu_items.rating_avg` | `true` |

The last two rows are the same kind of hole, with lower stakes because owners are known partners:

- An owner can set `is_featured`, `featured_rank`, `rating_avg` / `rating_count`, `delivery_radius_km` and `is_active` on **their own restaurant**. The cause is `restaurants_owner_update` plus the table-level grant.
- An owner can set `rating_avg` / `rating_count` on **their own dishes**. The cause is the `menu_items_owner_*` policies plus the table-level grants. Those two columns are aggregates that are supposed to be trigger-maintained (019).

### 2.2 The fix: column grants

Postgres lets a role be granted UPDATE on specific columns only. A table-level grant overrides column-level ones, so the migration must revoke the table grant first. This is the same pattern 016, 019 and 023 used.

```sql
-- ============================================================
-- 024_column_write_grants.sql
-- Security hotfix: replace table-level write grants for `authenticated`
-- with column grants that match exactly what the app writes.
--
-- users_self_update / restaurants_owner_update / menu_items_owner_*
-- scope the ROW (ownership) but not the COLUMNS, and `authenticated`
-- held table-level UPDATE on all three. Confirmed on production
-- 2026-09-25: a customer could set their own users.role = 'admin'.
-- Doctrine (016/019/023): REVOKE the table privilege, then GRANT columns.
-- ============================================================

-- users — Profile.tsx writes full_name, phone and phone_verified (to false
-- only; the 005 trigger blocks true). phone / phone_verified drop out in
-- 028 once no installed bundle writes them (phone_otp_login_plan.md §10).
REVOKE UPDATE ON public.users FROM authenticated;
GRANT  UPDATE (full_name, phone, phone_verified) ON public.users TO authenticated;

-- restaurants — owners toggle is_open from the dashboard. No client writes
-- any other column; admin edits go through the Supabase Dashboard.
REVOKE UPDATE ON public.restaurants FROM authenticated;
GRANT  UPDATE (is_open) ON public.restaurants TO authenticated;

-- menu_items — MenuManager (menuApi.ts) inserts and edits these columns.
-- rating_avg / rating_count are trigger-maintained (019).
REVOKE INSERT, UPDATE ON public.menu_items FROM authenticated;
GRANT  INSERT (restaurant_id, name, description, price, is_veg, is_available, image_url)
  ON public.menu_items TO authenticated;
GRANT  UPDATE (name, description, price, is_veg, is_available, image_url)
  ON public.menu_items TO authenticated;
```

### 2.3 Why this won't break the app

Every client-side write in `src/`, checked on 2026-09-25:

| Client write | Columns | Still allowed after 024 |
|---|---|---|
| `Profile.tsx` → `users` | `full_name`, `phone`, `phone_verified` (to false) | ✅ |
| `OwnerDashboard.tsx` → `restaurants` | `is_open` | ✅ |
| `menuApi.ts` insert → `menu_items` | `restaurant_id`, `name`, `description`, `price`, `is_veg`, `is_available`, `image_url` | ✅ |
| `menuApi.ts` update / availability / image → `menu_items` | `name`, `description`, `price`, `is_veg`, `is_available`, `image_url` | ✅ |
| `place_order`, `cancel_order`, `submit_order_review`, `register_device_token` | — | ✅ SECURITY DEFINER; grants don't apply |
| `.update(...).select(...)` read-backs | — | ✅ Table-level SELECT is untouched |

`023_verify.sql` stays green. Its `has_table_privilege(..., 'INSERT,UPDATE,DELETE')` check is true if *any* listed privilege is held, and DELETE is still held.

### 2.4 Verify and roll back

`supabase/ops/024_verify.sql` is a single `UNION ALL` query, because `supabase db query` only returns the last statement's rows. Run it on the branch, then on production:

```sql
SELECT 'no table-level UPDATE on users' AS check,
       NOT has_table_privilege('authenticated','public.users','UPDATE') AS ok
UNION ALL SELECT 'customers cannot write role / email / auth_provider',
       NOT (has_column_privilege('authenticated','public.users','role','UPDATE')
         OR has_column_privilege('authenticated','public.users','email','UPDATE')
         OR has_column_privilege('authenticated','public.users','auth_provider','UPDATE'))
UNION ALL SELECT 'customers can still write full_name / phone',
       has_column_privilege('authenticated','public.users','full_name','UPDATE')
       AND has_column_privilege('authenticated','public.users','phone','UPDATE')
UNION ALL SELECT 'owners write restaurants.is_open only',
       has_column_privilege('authenticated','public.restaurants','is_open','UPDATE')
       AND NOT has_column_privilege('authenticated','public.restaurants','is_featured','UPDATE')
       AND NOT has_column_privilege('authenticated','public.restaurants','delivery_radius_km','UPDATE')
       AND NOT has_column_privilege('authenticated','public.restaurants','is_active','UPDATE')
UNION ALL SELECT 'owners cannot write dish ratings',
       NOT has_column_privilege('authenticated','public.menu_items','rating_avg','UPDATE')
       AND NOT has_column_privilege('authenticated','public.menu_items','rating_avg','INSERT')
UNION ALL SELECT 'MenuManager columns still writable',
       has_column_privilege('authenticated','public.menu_items','price','UPDATE')
       AND has_column_privilege('authenticated','public.menu_items','image_url','UPDATE')
       AND has_column_privilege('authenticated','public.menu_items','restaurant_id','INSERT');
```

Then check that the app still works:

- Save a name on `/profile`.
- Toggle open/closed on the owner dashboard.
- Add a dish, edit it and replace its image in `/dashboard/menu`.
- From a customer session, try `supabase.from('users').update({ role: 'admin' }).eq('id', <self>)`. It must fail with `42501`. Only try this after the fix is applied.

**Rollback** means re-granting the table privilege, which reopens the hole. If a write breaks, the better fix is to add the missing column to the grant.

### 2.5 Orders audit (done 2026-09-25 → migration 025)

The audit read the migrations and the production catalog: privileges, policies, triggers, and how each function on the order path runs. The fix is `025_orders_write_grants.sql`.

**What production allowed before 025:**

| | Finding |
|---|---|
| Privileges | `authenticated` held table-level INSERT / UPDATE / DELETE on `orders` and `order_items`. `anon` did too (the legacy default ACL; RLS blocked it). |
| Policies | `orders_customer_insert` (own order, `phone_verified`) and `order_items_customer_insert` (own order) allowed **direct inserts**. `orders_owner_update` checks restaurant ownership only (no WITH CHECK, so USING is reused). |
| Triggers | `check_order_placement` (INSERT: restaurant open), `check_order_item` (INSERT: dish `is_available`, nothing else), `check_status_transition` + `stamp_order_accept` (**UPDATE only**). |
| Functions | `place_order`, `cancel_order` and `submit_order_review` run as **SECURITY DEFINER** (owner `postgres`). `recalculate_order_total` runs as **SECURITY INVOKER**. |

**Hole 1: customers could create orders without `place_order`.** A direct INSERT skips every rule `place_order` enforces:

- **Status:** any status, because the transition trigger only fires on UPDATE. An order could be *born* `completed`.
- **Money:** any total, discount or fee. `recalculate_order_total` runs as the caller, and RLS gives customers no UPDATE on `orders`, so the total was never recomputed.
- **Items:** any `unit_price`, and dishes from any restaurant.
- **Delivery and bookkeeping:** no pin, no radius check, no `order_commissions` row, no config version.

`submit_order_review` treats "own order + status `completed` + dish in `order_items`" as proof of purchase, and every part of that could be forged. So a phone-verified customer could post "verified" reviews for any restaurant or dish without ordering. The forged orders would also sit in the settlement views as completed orders.

**Hole 2: owners could rewrite any column of their restaurant's orders.** Only `status`, `eta_minutes` and `accepted_at` were guarded. The worst case is review tampering:

1. The owner sets `customer_id` to their own id.
2. They call `submit_order_review`. Its `ON CONFLICT (order_id)` upsert replaces the existing review's rating and comment, but **keeps the real customer's name** on it.
3. They set `customer_id` back.

Owners could also change `total_amount` and the fee columns (what the rider collects and what settlement reads), the customer's name and phone, the delivery address and pin, `expires_at` and `created_at`.

**The fix (025):**

| | Change |
|---|---|
| Creating orders | No client role may INSERT into `orders` or `order_items`. Both customer INSERT policies are dropped too, so a stray re-grant can't reopen the path; RLS would still deny it. |
| Owner edits | Owners may UPDATE only `status`, `eta_minutes` and `decline_reason`, exactly what `OwnerDashboard.tsx` sends for accept, progress and decline. |
| `anon` | No write privilege on either table. |
| Unaffected | `place_order`, `cancel_order` and `submit_order_review` (SECURITY DEFINER), and every service_role path (cron, `send-push`, `delete-account`, the Dashboard). |

**Shipped 2026-09-25, 17:04 IST (PR #59).**

- **Preview branch:** `025_verify` passed 10/10, and the end-to-end REST test passed 25/25:
  - Still works: `place_order`, `cancel_order`, accept → preparing → out for delivery → completed, decline, and a review on the completed order.
  - Refused at the grant layer: forged INSERTs, and 12 owner column rewrites.
- **Production:** `db push` applied 025 only. `025_verify` now passes 10/10 (6 failed before); `024_verify` 11/11 and `023_verify` 14/14 still pass.
- **Forensics on production** (read-only; 931 orders, 95 restaurant reviews, 155 dish reviews):
  - **No forged orders.** Zero orders with a total that doesn't match their items, missing items, a missing commission row or config version, progress without an accept, a missing contact snapshot, or an extended expiry.
  - **One order was reassigned:** `e1f45262-cf6e-49ae-b6d1-8bbd53b1cb79`, Marudhar Family Restaurant.
    - Placed 20 Sep 17:18 IST by the account whose name and phone are on the order. That same account reviewed it 5★ (restaurant + 4 dishes) at 18:51 IST.
    - It now belongs to a *different* customer account, created 16 minutes after the order was placed.
    - The order row was last updated **21 Sep 12:23 IST**, after completion, which no app flow does.
    - The review was **never edited** (`updated_at = created_at`).
  - **Actor unknown:** either Marudhar's owner (a PATCH was possible before 025) or a Dashboard edit. The API gateway logs for that minute show which; retention is about 7 days.

**Still possible after 025 (follow-ups, not holes in the permissions):**

- **Owners completing orders themselves.** An owner can still move a real order to `completed` without a delivery: the status flow is theirs by design. Paired with a second account that places orders, that allows self-reviews. The control is reconciling completed orders against the riders' cash. **Review side done in 026 (§2.7).**
- **Owners expiring orders by hand.** An owner can move `pending → expired` themselves (a transition the cron also uses), which avoids writing a decline reason.
- **`anon` write grants on other tables.** `anon` still holds table-level write grants on `users`, `restaurants`, `menu_items`, `delivery_addresses`, `device_tokens`, `discount_config`, `promotions` and `menu_categories` (legacy defaults). RLS blocks every one today. Revoking them is hygiene only.

### 2.6 Shipped — 2026-09-25

- **Preview branch** (PR #58):
  - `024_verify.sql` passed 11/11; `023_verify.sql` still passes 14/14.
  - Signed in as the seed owner over the REST API, 17/17 checks passed:
    - Profile save, the `is_open` toggle, and dish insert / edit / availability / image still work.
    - Writes to `role` / `email` / `auth_provider`, `is_featured` / `delivery_radius_km` / `rating_avg` / `is_active`, dish ratings and dish re-parenting are all refused with `42501`.
- **Production:**
  - `db push` applied `024_column_write_grants.sql` at 16:25 IST. The dry run had shown it was the only pending migration.
  - `024_verify.sql` now passes 11/11 (before the fix, 7 of the security checks failed).
  - `023_verify.sql` still passes 14/14.
- **Post-fix audit on production** (read-only, counts only):
  - **0 admin accounts** in `public.users`, so nobody used the hole to become admin.
  - **0 rating mismatches**: every stored `rating_avg` / `rating_count` equals the trigger's `COUNT` / `ROUND(AVG, 1)` across 18 restaurants and 1,290 dishes.
  - **2 owner-role accounts with no restaurant.** These could be onboarding in progress, or customers who self-promoted to `owner` before the fix. `owner` without a restaurant only reaches `OnboardingIncomplete`. **To review.**
  - 15/18 restaurants are featured and 16/18 have a non-default radius. The data can't show whether Ankit or the owners set them. **To review.**

### 2.7 Owner self-review guard (migration 026)

**Why it's needed.** After 025, a review needs a genuine, completed `place_order` order. But restaurants complete their own orders, and `place_order` doesn't check who is ordering. Three abuse paths remained:
- An owner orders from their own restaurant on their owner account, completes the order and rates it 5★.
- An owner orders from a rival and leaves 1★ once the rival completes it.
- An owner or their staff does either of those from a customer account on the owner's or the restaurant's own phone number.

**The fix.** `submit_order_review` now refuses, with the existing `REVIEW_NOT_ELIGIBLE:` prefix (no app change), before writing anything, when:
- the caller isn't role `customer`;
- the caller owns the order's restaurant;
- the caller's phone (last 10 digits) equals the restaurant's phone line or its owner's phone.

This also applies to edits. The function's `search_path` is pinned to `''`.

**Not covered.** A second account on a *different* number: nothing in the data identifies it.

**Shipped 2026-09-25, 17:31 IST (PR #60).**
- **Preview branch:** `026_verify` passed 4/4, and 025 / 024 / 023 were still all green. The end-to-end test passed 13/13, using real `place_order` orders completed through the owner flow:
  - Accepted: a genuine customer's review and edit, and a review of a *different* restaurant by an account on another restaurant's line.
  - Refused: an owner reviewing their own restaurant, an owner reviewing a rival, a customer on the owner's phone, and a customer on the restaurant's line.
  - Refused attempts wrote no rows.
- **Production:** `db push` applied 026 only. `026_verify` passes 4/4, and 025 / 024 / 023 still pass.

**Existing reviews that break the rule** (production, 2026-09-25, 9 of 95 restaurant reviews). They were left in place for Ankit to decide:

| Restaurant | Reviews | Why flagged | Order ids |
|---|---|---|---|
| Sharma Bhojnalaya (seed) | 7 × 3–4★, 20 Jul – 17 Sep, 2 dish reviews each | Reviewer's phone = the restaurant's line (looks like testing) | `280630b5…`, `0dfdd1f5…`, `0bfc428a…`, `11bde4fa…`, `99ba486e…`, `bf8ba467…`, `5f21db91…` |
| Hotel Aayat | 1 × 5★, 2 Sep | Reviewer's phone = the owner's phone | `cf2f2a0d-ffca-497b-9174-5987a4208b7a` |
| Tirupati Family Restaurant | 1 × 5★, 24 Aug, 1 dish review | Reviewer has role `owner` but no restaurant | `d1fc99f7-9c67-4823-be14-91002b6166aa` |

---

## 3. Target design

### 3.1 Architecture

```
 Browser / Android WebView           Supabase Auth (GoTrue)                  Edge Function             MSG91
 ─────────────────────────           ──────────────────────                  ─────────────             ─────
 signInWithOtp({ phone:'+91…' }) ──▶ POST /auth/v1/otp
                                     • new number → creates auth user
                                       (phone NOT yet confirmed)
                                     • per-user 30 s resend window
                                     • project-wide SMS cap (60/h)
                                     • generates 6-digit code, stores hash
                                     • Send SMS hook ───────────────────────▶ auth-send-sms
                                                                              • check webhook signature
                                                                              • Indian mobiles only
                                                                              • per-number / per-IP caps
                                                                              • POST /api/v5/otp?otp=… ──▶ SMS via the
                                     ◀─────────────────────────── 200 {} ─────┘                           DLT template
 verifyOtp({ phone, token,       ──▶ POST /auth/v1/verify
            type:'sms' })            • checks code + expiry (300 s)
                                     • confirms phone ──▶ trigger mirrors it
                                                          into public.users
                                     ◀── session (access + refresh token)
```

### 3.2 Why this shape

- **Only Supabase Auth can issue a real session.** That means an access token, a rotating refresh token, sign-out and RLS identity. An Edge Function that checks an OTP can't sign someone in without a fragile workaround.
- **`send-otp` / `verify-otp` can't be stretched to do login.** They need a signed-in user (a JWT) and verify a phone for an account that already exists. Signing in is exactly what they can't do.
- **We keep MSG91.** Supabase's built-in SMS providers are Twilio, Twilio Verify, MessageBird, Vonage and Textlocal. Our DLT header and approved template live on MSG91 through Airtel, and switching would mean a new DLT mapping. The hook keeps MSG91 as the delivery pipe.
- **No "Before User Created" hook is needed.** For a new number, Supabase creates the auth user and sends the SMS in the same database transaction. If our hook refuses (for example, a non-Indian number), that user is rolled back. This is test B4 in §11.2.

### 3.3 Platform facts this plan relies on

Verified on 2026-09-25 against the Supabase docs and the auth server source (§16):

| Fact | Consequence here |
|---|---|
| The hook payload is `{ metadata, user, sms }`. `sms.otp` is the code, and `sms.phone` is the **number to text** (the *new* number during a phone change). `metadata.ip_address` is the client IP. | The function texts `sms.phone`. The IP drives the per-IP cap. The public docs only list `sms.otp`, so the function refuses (rather than guesses) if `sms.phone` is ever missing while a phone change is pending (§5.2). |
| `user.phone` is stored as digits without `+` (`919876543210`). | `public.mobile10()` strips it to the 10-digit form the app already uses everywhere. |
| Hook success is HTTP 200 with an empty body or `{}`. An error is HTTP 400+ with `{"error":{"http_code":…,"message":"…"}}`, and **the message reaches the client verbatim.** | Hook refusals carry stable prefixes (`PHONE_NOT_SUPPORTED:`, `OTP_LIMIT_REACHED:`, `SMS_SEND_FAILED:`), the same convention as `PRICING_MISMATCH:`. |
| HTTP hooks have a **5 s total budget**. Auth **retries 429 and 503** up to 3 times with a 2 s backoff *inside* that budget. | **Never return 429/503** from the hook. A retried refusal turns into `hook_timeout_after_retry`, and our message is lost. Refusals return 400; provider failures return 502. |
| The OTP length is 6–10 digits (default 6). The per-user resend window defaults to 60 s. The project-wide SMS cap defaults to **30/hour**. Verification is limited to 30 per 5 min per IP. | Set explicitly (§6). The OTP goes from today's 4 digits to 6, which the template's `{#var#}` accepts. |
| Test phone numbers **skip SMS delivery** (the hook isn't called) and accept only their mapped code. They can carry a "valid until" date. | Used for the Play reviewer (D8) and preview branches. |
| `verifyOtp` returns `otp_expired` for both a **wrong** and an **expired** code. | The copy can't tell them apart (§8.4). |
| The admin API `updateUserById(id, { phone, phone_confirm: true })` sets and confirms the phone and **creates the `phone` identity**. It does *not* check for duplicates. The customer-facing `updateUser({ phone })` does, and returns `phone_exists`. | This is how existing customers are backfilled (§7). Production has `CREATE UNIQUE INDEX users_phone_key ON auth.users (phone)` (checked 2026-09-25), so a duplicate backfill fails loudly instead of creating two accounts with one number. Duplicates must still be settled first. |
| The Send SMS hook and Before User Created hook are available on Free and Pro. | No plan dependency. |
| On a merge to production, the GitHub integration applies **migrations, functions and storage only. `[auth]` in `config.toml` is ignored.** Preview branches *do* apply `[auth]`. | `config.toml` can safely carry branch-only test numbers. Production phone auth is configured in the Dashboard (§6). |

### 3.4 ⚠ "Enable phone confirmations" must be ON

This is the setting that makes or breaks the design. The CLI config default is **off** (`auth.sms.enable_confirmations = false`, i.e. "autoconfirm"), and the production project's current value is unknown, so set it explicitly. With it off, the auth server source shows three things:

1. **A new number is marked confirmed the moment an OTP is *requested*.** `signup.go` calls `ConfirmPhone` at sign-up, before any code is checked. Our sync trigger (§4) would then write `phone_verified = true` for a number nobody has proven they own. That user still can't sign in without the code, but the data would be wrong.
2. **The project-wide SMS cap is skipped entirely.** `phone.go` only applies the SMS limiter when autoconfirm is off, so the main defence against wallet-draining (§9) would silently do nothing.
3. **Changing a number needs no code at all.** In `user.go`, `updateUser({ phone })` under autoconfirm switches the number immediately. With confirmations ON, it texts the new number and waits for `verifyOtp(type 'phone_change')`. The Profile change flow and `/verify-phone` (§8.7, §8.8) depend on this.

**Set it ON** in the Dashboard (Auth → Providers → Phone) and in `config.toml` for branches. Test B1 (§11.2) proves it: after an OTP request for a new number, `auth.users.phone_confirmed_at` must be `NULL`, and there must be **no** `public.users` row until the code is verified.

### 3.5 The flows

| Flow | What happens |
|---|---|
| **New customer** | `signInWithOtp` creates an unconfirmed auth user and texts a code. `verifyOtp(type 'sms')` confirms the phone, and the trigger creates the `public.users` row (`phone_verified = true`, `auth_provider = 'phone'`, empty name). The name step saves `full_name`, then the customer goes to `next`. |
| **Returning customer** | The number is found and a code is texted. `verifyOtp` returns the session for the **same user id**, so there's no name step. |
| **Existing (pre-launch) customer** | Same as returning. The backfill (§7) attached their verified number to their existing auth user beforehand. |
| **Change number** (Profile) | `updateUser({ phone: new })` texts the **new** number. `verifyOtp(type 'phone_change')` swaps the number in `auth.users`, and the trigger mirrors it. From then on, the old number opens a new, empty account. |
| **Legacy session with no verified number** (signed in with email/Google before launch, never verified) | `/verify-phone` becomes "Add your mobile number". It uses the same `updateUser` + `phone_change` flow, which attaches the number to *this* account. |
| **Partner / admin** | `/partner/login` uses email + password (`signInWithPassword`), exactly as today. |
| **Delete account** | `delete-account` deletes the auth user (unchanged), which frees the number. Logging in with it later creates a fresh, empty account. |

---

## 4. Database — migration 027

### 4.1 Identity model

| Field | Source of truth | Written by |
|---|---|---|
| `auth.users.phone`, `phone_confirmed_at` | **Supabase Auth** (the OTP proved it) | GoTrue only: OTP verify, phone change, the admin API |
| `public.users.phone` | Mirror: the 10-digit form of the confirmed auth phone | The trigger for OTP customers. Partners' phones stay admin-set, as today. |
| `public.users.phone_verified` | Mirror: `true` once the auth phone is confirmed | The trigger, plus the legacy `verify-otp` until Phase 5 |
| `public.users.full_name` | The customer | The name step and Profile (the only customer-writable column after 028) |
| `public.users.email` | Legacy / partners | Empty string for new customers, whose `auth.users.email` is NULL |
| `public.users.auth_provider` | Informational | Gains `'phone'` |

### 4.2 The SQL

```sql
-- ============================================================
-- 027_phone_otp_login.sql
-- Phone-OTP login for customers (src/docs/phone_otp_login_plan.md).
-- auth.users.phone becomes the customer identity; public.users.phone /
-- phone_verified become a trigger-maintained mirror of it.
-- ============================================================

-- ── 1. 10-digit form of an Indian mobile ('919876543210' → '9876543210')
CREATE OR REPLACE FUNCTION public.mobile10(p_phone text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN d ~ '^91[6-9][0-9]{9}$' THEN substr(d, 3)
           WHEN d ~ '^[6-9][0-9]{9}$'   THEN d
         END
  FROM (SELECT regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') AS d) s;
$$;

-- ── 2. handle_new_user v2 — defer phone sign-ups until confirmation
-- GoTrue inserts the auth user when the code is REQUESTED (phone not yet
-- confirmed, because "Enable phone confirmations" is ON — plan §3.4). A
-- number nobody has proven gets no profile; sync_user_phone_from_auth()
-- creates it at confirmation. Email / Google / Dashboard-created users
-- behave exactly as before.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.phone IS NOT NULL
     AND NEW.phone_confirmed_at IS NULL
     AND coalesce(NEW.email, '') = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.users (id, email, full_name, phone, phone_verified, auth_provider)
  VALUES (
    NEW.id,
    coalesce(NEW.email, ''),
    coalesce(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    coalesce(public.mobile10(NEW.phone), NEW.raw_user_meta_data->>'phone', ''),
    NEW.phone_confirmed_at IS NOT NULL AND public.mobile10(NEW.phone) IS NOT NULL,
    CASE NEW.raw_app_meta_data->>'provider'
      WHEN 'google' THEN 'google'
      WHEN 'phone'  THEN 'phone'
      ELSE 'email'
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ── 3. Mirror a confirmed auth phone into public.users
CREATE OR REPLACE FUNCTION public.sync_user_phone_from_auth()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mobile text := public.mobile10(NEW.phone);
BEGIN
  IF NEW.phone_confirmed_at IS NULL OR v_mobile IS NULL THEN
    RETURN NEW;
  END IF;

  -- This write carries its own proof (GoTrue just confirmed an OTP), so it
  -- is exempt from the 005 client guard. Transaction-local; a client can't
  -- set it (PostgREST runs no arbitrary SET / set_config).
  PERFORM set_config('redlotus.phone_sync', 'on', true);

  INSERT INTO public.users (id, email, full_name, phone, phone_verified, auth_provider)
  VALUES (NEW.id, coalesce(NEW.email, ''), '', v_mobile, true, 'phone')
  ON CONFLICT (id) DO UPDATE
    SET phone          = EXCLUDED.phone,
        phone_verified = true;

  PERFORM set_config('redlotus.phone_sync', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_phone_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_phone_confirmed
  AFTER UPDATE OF phone, phone_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (NEW.phone_confirmed_at IS NOT NULL
        AND (OLD.phone IS DISTINCT FROM NEW.phone
             OR OLD.phone_confirmed_at IS NULL))
  EXECUTE FUNCTION public.sync_user_phone_from_auth();

-- ── 4. 005 guard — honour the sync flag; client rules unchanged
CREATE OR REPLACE FUNCTION public.reset_phone_verified()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('redlotus.phone_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.phone IS DISTINCT FROM OLD.phone THEN
    NEW.phone_verified := false;
  END IF;

  IF NEW.phone_verified IS DISTINCT FROM OLD.phone_verified
     AND NEW.phone_verified = true
     AND auth.role() <> 'service_role'
  THEN
    RAISE EXCEPTION
      'phone_verified can only be set to true by the verify-otp Edge Function';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 5. OTP send log + limiter for the auth-send-sms hook
CREATE TABLE public.sms_otp_log (
  id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),   -- uuid, not identity: no
                                          -- sequence to grant on restricted-default branches (023)
  phone   text        NOT NULL,          -- 10-digit; pruned after 48 h
  ip      text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_otp_log_phone_idx ON public.sms_otp_log (phone, sent_at);
CREATE INDEX sms_otp_log_ip_idx    ON public.sms_otp_log (ip, sent_at);
CREATE INDEX sms_otp_log_sent_idx  ON public.sms_otp_log (sent_at);

ALTER TABLE public.sms_otp_log ENABLE ROW LEVEL SECURITY;   -- zero policies
REVOKE ALL ON public.sms_otp_log FROM anon, authenticated;
GRANT  SELECT, INSERT, DELETE ON public.sms_otp_log TO service_role;

-- NULL = allowed (and recorded); otherwise the refusal reason.
CREATE OR REPLACE FUNCTION public.claim_sms_otp_slot(
  p_phone             text,
  p_ip                text,
  p_max_per_phone_day int DEFAULT 10,
  p_max_per_ip_hour   int DEFAULT 20
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sms_otp:' || p_phone));

  DELETE FROM public.sms_otp_log WHERE sent_at < now() - interval '48 hours';

  IF (SELECT count(*) FROM public.sms_otp_log
       WHERE phone = p_phone AND sent_at > now() - interval '24 hours')
     >= p_max_per_phone_day THEN
    RETURN 'phone_daily_limit';
  END IF;

  IF p_ip IS NOT NULL AND
     (SELECT count(*) FROM public.sms_otp_log
       WHERE ip = p_ip AND sent_at > now() - interval '1 hour')
     >= p_max_per_ip_hour THEN
    RETURN 'ip_hourly_limit';
  END IF;

  INSERT INTO public.sms_otp_log (phone, ip) VALUES (p_phone, p_ip);
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_sms_otp_slot(text, text, int, int)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_sms_otp_slot(text, text, int, int)
  TO service_role;

-- ── 6. Server-side "verified phone" check for every order (recommended)
-- place_order is SECURITY DEFINER, so orders_customer_insert's
-- phone_verified check never runs on the real order path — today only
-- ProtectedRoute enforces it. A BEFORE INSERT trigger fires on every path.
CREATE OR REPLACE FUNCTION public.require_verified_customer_phone()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users
                  WHERE id = NEW.customer_id AND phone_verified) THEN
    RAISE EXCEPTION 'PHONE_NOT_VERIFIED: add your mobile number to place an order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_require_verified_phone ON public.orders;
CREATE TRIGGER orders_require_verified_phone
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.require_verified_customer_phone();
```

### 4.3 Why each piece is shaped this way

- **Profile creation waits for confirmation (step 2).** Every number someone types creates an auth user, verified or not. Creating the profile only on confirmation keeps `public.users` limited to people who proved they own a number. It also means there's nothing to clean up when someone gives up halfway. `public.users` has no foreign key to `auth.users` (CLAUDE.md), so orphaned profile rows would never go away on their own.
- **The trigger's WHEN clause (step 3)** fires on a first confirmation (`OLD.phone_confirmed_at IS NULL`) and on a number change. It doesn't fire on routine returning logins. The admin backfill writes `phone` and `phone_confirmed_at` in two separate UPDATEs; the second one fires it.
- **Why the bypass flag is safe (step 4).** Without the flag, the 005 rule "phone changed ⇒ `phone_verified := false`" would undo the sync's own write. The flag is a custom, transaction-local setting (`set_config(..., true)`). PostgREST gives clients no way to run `SET` or `set_config` in the same transaction as their UPDATE. Also, after 024 and 028 customers can't write `phone` or `phone_verified` at all.
- **What the limiter protects (step 5).** It's a guard against SMS bombing and wallet-draining, not a correctness rule, so the hook **fails open** if the database call errors (the project-wide cap still applies). The advisory lock makes the per-number check exact. Phones are kept for 48 h at most, and `sms_otp_log` is readable only by service_role.
- **The order trigger (step 6)** changes nothing for honest clients: every customer who reaches checkout is already verified. It closes the gap for pre-launch sessions that never verified a number. Checkout maps `PHONE_NOT_VERIFIED:` to a redirect to `/verify-phone` (§8.4).
- **Hygiene.** `claim_sms_otp_slot` is `SECURITY INVOKER` and executable only by service_role, following the Supabase guidance on public-schema functions. Trigger functions can't be called over RPC, and `handle_new_user`'s existing permissions aren't touched.

### 4.4 Verify and roll back

- `supabase/ops/027_verify.sql` is a single `UNION ALL` query that checks:
  - `on_auth_user_phone_confirmed` and `orders_require_verified_phone` exist.
  - `pg_get_functiondef` of `handle_new_user` contains `phone_confirmed_at`, and that of `reset_phone_verified` contains `redlotus.phone_sync`.
  - RLS is on for `sms_otp_log`, and `anon` / `authenticated` have no privilege on it.
  - `anon` / `authenticated` can't EXECUTE `claim_sms_otp_slot`.
  - `mobile10('+91 98765-43210') = '9876543210'` and `mobile10('447700900123') IS NULL`.
- `supabase/ops/027_rollback.sql` does the following:
  - Restores the 002 `handle_new_user` and the 005 `reset_phone_verified` bodies verbatim.
  - Drops both new triggers and their functions, `claim_sms_otp_slot` and `sms_otp_log`.
  - Drops `mobile10` last.

---

## 5. Edge Function `auth-send-sms`

### 5.1 Contract

| | |
|---|---|
| Caller | Supabase Auth only. It's declared `verify_jwt = false` in `config.toml`, and every request must pass the Standard Webhooks signature check. |
| Input | `{ metadata: { ip_address, … }, user: { phone, new_phone?, … }, sms: { otp, phone? } }` |
| Success | `200` with body `{}` |
| Refusal | `400` `{ "error": { "http_code": 400, "message": "PHONE_NOT_SUPPORTED: …" / "OTP_LIMIT_REACHED: …" } }` |
| Provider failure | `502` `{ "error": { "http_code": 502, "message": "SMS_SEND_FAILED: …" } }` |
| Never | `429` or `503`, because Auth retries those inside the 5 s budget and our message is lost (§3.3) |

### 5.2 Logic

```ts
// ============================================================
// auth-send-sms — Supabase Auth "Send SMS" hook → MSG91.
//
// Supabase Auth generates, stores (hashed) and verifies the OTP and issues
// the session; this function only DELIVERS it, through the SendOTP template
// the old send-otp used (DLT text says "Valid for 5 minutes" → keep Auth's
// SMS OTP expiry at 300 s). Auth calls it, never a browser: verify_jwt =
// false in config.toml, and nothing is trusted before the webhook
// signature checks out. Hook budget is 5 s TOTAL and Auth retries 429/503
// inside it — refusals are 400, provider failures 502, never 429/503.
//
// Env: SEND_SMS_HOOK_SECRET ("v1,whsec_…"), MSG91_AUTH_KEY,
//      MSG91_TEMPLATE_ID, OTP_MAX_PER_PHONE_DAY (10), OTP_MAX_PER_IP_HOUR (20)
//      + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-populated).
// ============================================================
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

Deno.serve(async (req) => {
  // 1. Signature — everything below trusts the payload only after this.
  const payload = verifyOrNull(await req.text(), req.headers); // wh.verify(...)
  if (!payload) return hookError(401, "SMS_SEND_FAILED: Please try again.");

  // 2. Destination. sms.phone is authoritative (the NEW number on a phone
  //    change). Fall back to user.phone only when no change is pending —
  //    never guess between two numbers.
  const raw = payload.sms?.phone ?? (payload.user?.new_phone ? null : payload.user?.phone);
  const to = normaliseIndian(raw);                    // "91XXXXXXXXXX" or null
  if (!to) return hookError(400, "PHONE_NOT_SUPPORTED: RedLotus works with Indian mobile numbers only.");

  const otp = payload.sms?.otp ?? "";
  if (!/^\d{6}$/.test(otp)) return hookError(502, "SMS_SEND_FAILED: Please try again.");

  // 3. Per-number / per-IP caps. Fail OPEN on a DB error (logged) — the
  //    project-wide SMS cap still holds.
  const refusal = await claimSlot(to.slice(2), payload.metadata?.ip_address ?? null);
  if (refusal) {
    return hookError(400, "OTP_LIMIT_REACHED: Too many codes requested for this number. Please try again later.");
  }

  // 4. Deliver through MSG91 with OUR code (≈3 s timeout, inside the 5 s budget).
  const ok = await sendViaMsg91(to, otp);
  if (!ok) return hookError(502, "SMS_SEND_FAILED: We couldn't send the SMS right now. Please try again.");

  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
});
```

`sendViaMsg91` is the call `send-otp` makes today, with one addition, `otp`:

```
POST https://control.msg91.com/api/v5/otp?template_id=<MSG91_TEMPLATE_ID>&mobile=91XXXXXXXXXX&otp=<6 digits>
authkey: <MSG91_AUTH_KEY>
→ success when the JSON body has type === "success"
```

MSG91's SendOTP API takes an optional `otp` parameter ("OTP you want to send"). Without it MSG91 generates its own code, which is today's behaviour. We never call MSG91's verify endpoint again.

### 5.3 MSG91 smoke test (before writing the function)

Run this the same way `phone_verification_plan.md` Step 1 did, from a terminal, with a real SIM in hand:

```bash
curl -X POST "https://control.msg91.com/api/v5/otp?template_id=69f2350acf9869ba19066fc2&mobile=91<YOUR_10_DIGITS>&otp=482913" \
  -H "authkey: $MSG91_AUTH_KEY" -H "Content-Type: application/json" -d '{}'
```

Pass only if all three hold:

1. The SMS arrives and shows **`482913`** (six digits, the code we chose).
2. The text still matches the DLT template.
3. A **second** send with a different code **30 s later** also arrives.

If MSG91 throttles the 30 s resend (`send-otp`'s comments assume a per-number limit of about 30 s), raise the resend window to 45–60 s in §6 and in `RESEND_SECONDS`.

### 5.4 Deploy, config and secrets

- `supabase/config.toml` gets a `[functions.auth-send-sms]` block with `verify_jwt = false` and a comment. A merge then deploys the function to production (the GitHub integration deploys declared functions), and nobody has to remember `--no-verify-jwt` (the `send-push` lesson).
- Secrets: `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID` already exist. Add `SEND_SMS_HOOK_SECRET`: copy it from Dashboard → Auth → Hooks when you create the hook, and set it with `supabase secrets set`, not through a PowerShell pipe (the BOM trap). The two cap values are optional env vars with defaults.
- The hook itself (Dashboard → Authentication → Hooks → Send SMS → HTTPS → `https://umsqskeqmwbmvrfvyrbl.supabase.co/functions/v1/auth-send-sms`) is **configured by hand in production**. `config.toml`'s `[auth.hook.*]` is ignored there.

### 5.5 What it logs

One structured line per call: outcome, the phone masked to its last 3 digits, the IP, MSG91's `type` / `request_id` and the time taken. **The OTP is never logged.** Refusals and provider failures are `console.error`, so they show up in Edge Function logs.

---

## 6. Supabase Auth configuration

### 6.1 Production (Dashboard), in this order

Change these **before** enabling the Phone provider. The moment it's on, `/auth/v1/otp` is public (§10, Phase 1).

| # | Where | Setting | Value | Why |
|---|---|---|---|---|
| 1 | Auth → Rate Limits | SMS messages per hour (project-wide) | **60** (default 30) | D7. 30/hour could block real logins at a dinner-rush spike. 60 caps abuse at about ₹12/hour. |
| 2 | Auth → Rate Limits / Phone | Per-user resend window (`max_frequency`) | **30 s** | Matches today's UI and MSG91 (§5.3). |
| 3 | Auth → Rate Limits | Token verifications | keep **30 per 5 min per IP** | Enough for honest retries; blocks code guessing. |
| 4 | Auth → Providers → Phone | Enable phone confirmations | **ON** | **§3.4 — required.** |
| 5 | Auth → Providers → Phone | SMS OTP expiry | **300 s** | The approved DLT text says "Valid for 5 minutes". |
| 6 | Auth → Providers → Phone | SMS OTP length | **6** | Supabase's minimum. The template's `{#var#}` accepts it. |
| 7 | Auth → Providers → Phone | Test phone numbers + OTPs | the D8 reviewer SIM → fixed 6-digit code, valid until +12 months | Play review (§9.3). Calendar the expiry. |
| 8 | Auth → Hooks | Send SMS (HTTPS) | the `auth-send-sms` URL + a generated secret | §5.4 |
| 9 | Auth → Providers → Phone | **Enable Phone provider** | **ON — last** | Opens `/auth/v1/otp`. |
| — | Auth → Providers → Email | unchanged (ON) | | Partners and admin still use it. |
| — | Auth → Providers → Google | stays ON until Phase 5 | | Installed bundles still offer it (D9). |
| — | Auth → Sign In / Up | Allow new users to sign up | must stay ON | It's global. Turning it off blocks phone sign-ups too. |
| — | Auth → Attack Protection | CAPTCHA | **off** in v1 | An emergency switch (§9.1). A challenge in the login flow costs exactly the customers this plan is for. |

### 6.2 Preview branches (`config.toml`)

Production ignores these on merge (§3.3). Branches apply them.

```toml
[functions.auth-send-sms]
# Supabase Auth "Send SMS" hook (phone-OTP login → MSG91). Called by Auth
# with a Standard Webhooks signature, never with a user JWT.
verify_jwt = false

# ── Auth — applied to PREVIEW BRANCHES only. The GitHub integration
# ignores [auth] on the production merge; production phone auth lives in
# the Dashboard (phone_otp_login_plan.md §6.1).
[auth.sms]
enable_signup = true
enable_confirmations = true   # REQUIRED — false confirms the phone before the OTP is checked (plan §3.4)
max_frequency = "30s"

[auth.sms.test_otp]
919999900001 = "123456"   # branch test customer
919999900002 = "123456"   # branch phone-change target
```

On branches, test numbers skip the hook, so no secrets and no MSG91 are needed there. To test real SMS on a branch, configure the hook in that branch's Dashboard and set its three secrets (branches don't inherit secrets). After the first push, check the branch's Auth settings once to confirm nothing else in `[auth]` changed.

---

## 7. Existing accounts

### 7.1 Who is affected and how

| Account today | After launch |
|---|---|
| Customer, **verified phone** (every customer who has ordered) | Backfilled. Typing the number opens the **same account**: same user id, orders, reviews and addresses. Their existing session also keeps working. |
| Customer, **never verified** (signed up, never ordered) | Can't reach the old account by OTP; there's no number to match. They log in with their number and get a new account. **Nothing is lost**, because ordering always required a verified phone. |
| Customer whose verified number is also on **another** account (duplicate) | Not backfilled automatically. Resolved by hand (§7.4). |
| Customer still **signed in** on a device | Keeps working. If unverified, checkout sends them to `/verify-phone`, which now attaches a number to this account (§8.7). |
| Partner / admin | No change. Email + password at `/partner/login`. |
| Play reviewer account (email) | Replaced by the D8 test number (§9.3). |

### 7.2 Sizing (counts only, no personal data)

`supabase/ops/027_sizing.sql` works before and after 027 and is safe on production:

```sql
WITH c AS (
  SELECT u.id, u.phone_verified, u.auth_provider,
         CASE
           WHEN regexp_replace(u.phone, '\D', '', 'g') ~ '^91[6-9][0-9]{9}$'
             THEN substr(regexp_replace(u.phone, '\D', '', 'g'), 3)
           WHEN regexp_replace(u.phone, '\D', '', 'g') ~ '^[6-9][0-9]{9}$'
             THEN regexp_replace(u.phone, '\D', '', 'g')
         END AS m
  FROM public.users u
  WHERE u.role = 'customer'
)
SELECT
  count(*)                                             AS customers,
  count(*) FILTER (WHERE phone_verified)               AS verified,
  count(*) FILTER (WHERE NOT phone_verified)           AS unverified,
  count(*) FILTER (WHERE auth_provider = 'google')     AS via_google,
  count(*) FILTER (WHERE auth_provider = 'email')      AS via_email,
  count(*) FILTER (WHERE phone_verified AND m IS NULL) AS verified_unparseable,
  (SELECT count(*) FROM (SELECT m FROM c WHERE phone_verified AND m IS NOT NULL
                          GROUP BY m HAVING count(*) > 1) d)          AS numbers_on_2plus_accounts,
  (SELECT count(*) FROM c WHERE NOT phone_verified
     AND EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id)) AS unverified_with_orders,
  (SELECT count(*) FROM auth.users a WHERE a.phone IS NOT NULL)          AS auth_users_with_phone
FROM c;
```

`unverified_with_orders` should be 0. Run it at the start of Phase 2 and paste the numbers into this section.

### 7.3 The backfill

`supabase/ops/027_backfill_customer_phones.mjs` is a Node script run by Ankit. It is a dry run by default; `--live` writes.

1. Read `public.users` where `role = 'customer' AND phone_verified`, using the service-role key. Pass it as a shell env var only (`$env:SUPABASE_SERVICE_ROLE_KEY = '…'`), never in a file, never committed.
2. Normalise each number with the same rule as `mobile10()`. Count and skip anything that doesn't parse.
3. Group by number. **Any number held by 2+ accounts is a conflict**; skip the whole group and list it.
4. List auth users (`auth.admin.listUsers`, paginated):
   - Skip anyone whose auth phone already equals the target (makes the script safe to re-run).
   - Count a conflict if the target number is already another auth user's phone.
   - Skip profiles with no auth user.
5. `--live`: call `auth.admin.updateUserById(id, { phone: '91' + m, phone_confirm: true })` one user at a time, about 100 ms apart. This creates the `phone` identity and confirms it (§3.3). The 027 trigger re-mirrors the same number with no change.
6. Print totals (eligible / attached / skipped / conflicts / failed). Save the conflict list to a scratch file, with numbers masked to the last 3 digits plus user ids.

Use the Admin API, never SQL on `auth.users`: the API creates the identity row that GoTrue expects.

### 7.4 Numbers on two or more accounts

For each group, attach the number to the account with the **most recent order**. If none has orders, use the most recently created account. Use `--attach <user_id>` or the Dashboard's user editor. The other accounts keep working only in sessions already open. Their order rows stay intact for settlement and remain visible to support. If a customer asks, merging order history is a manual support task (§13). Expect 0–3 cases at current scale; the sizing query tells us.

### 7.5 Stragglers during the transition

Until Phase 5, installed apps can still verify phones through the **old** `verify-otp`. Without a change, those customers would be verified in `public.users` but have no auth phone, so their next OTP login would create a **second** account. So in Phase 1, `verify-otp` gets a **dual write**: after flipping `phone_verified`, it also calls `updateUserById(user.id, { phone: '91' + phone, phone_confirm: true })`. If that fails because the number is on another auth user, it logs `[verify-otp] number already attached elsewhere` and carries on, since today's behaviour must not regress. Re-running the backfill weekly until Phase 5 catches anything that slipped through.

---

## 8. Frontend

### 8.1 Routes

| Route | Today | After |
|---|---|---|
| `/login` | Email + password + Google (`Login.tsx`) | **Customer phone OTP** (rewritten `Login.tsx`) |
| `/partner/login` | — | **New**: email + password for partners and admin (`PartnerLogin.tsx`; today's form without Google or sign-up) |
| `/signup` | `Signup.tsx` | `<Navigate to="/login" replace />` so old links keep working. The component and CSS are deleted. |
| `/auth/callback` | Recovery + Google + email-confirm routing | Kept for **partner password recovery**. The Google `/profile?setup=true` gate is removed. |
| `/reset-password` | Customers + partners | Partners only (the link lives on `/partner/login`) |
| `/verify-phone` | MSG91 `send-otp` / `verify-otp` | **"Add your mobile number"**: `updateUser` + `phone_change` (§8.7), for legacy sessions only |
| `/restaurants/:id` | `<ProtectedRoute>` | **Public (D6)**. `RestaurantMenu` makes no auth-dependent calls, and `restaurants` / `menu_items` are anon-readable (016). |
| `/checkout`, `/orders*`, `/profile` | `<ProtectedRoute>` → `/login` with no return path | `<ProtectedRoute>` → `/login?next=<path>` (§8.5) |
| `/dashboard*` | `<ProtectedRoute role="owner">` → `/login` | → `/partner/login?next=<path>` |

### 8.2 `/login` — the customer screen

Three steps in one component: `phone → otp → name`.

- **Phone step**
  - Title "Log in or sign up". Subtitle "Enter your mobile number. We'll text you a 6-digit code."
  - A fixed `+91` prefix and a 10-digit field (`type="tel"`, `inputMode="numeric"`, `autoComplete="tel-national"`).
  - Pasting `+91 98765-43210`, `09876543210` or `919876543210` is normalised.
  - Button: **Get OTP**. Consent line: "By continuing you agree to our Terms and Privacy Policy." Links: WhatsApp help (D10), and "Restaurant partner? Log in with email" → `/partner/login`.
  - Calls `supabase.auth.signInWithOtp({ phone: '+91' + n, options: { shouldCreateUser: true, channel: 'sms' } })`.
- **Code step**
  - "Enter the 6-digit code sent to **+91 98765 43210** · Change".
  - One field (`inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength={6}`). Not six boxes: one field pastes cleanly and works with screen readers. It **submits itself on the 6th digit**.
  - "Didn't get it? Resend in 0:30", then "Resend OTP" (repeats `signInWithOtp`). After a resend, show "Use the newest code — older ones stop working."
  - Calls `supabase.auth.verifyOtp({ phone: '+91' + n, token, type: 'sms' })`.
- **Name step** (only if the profile's `full_name` is empty)
  - "What's your name?" / "The restaurant and rider see this on your order."
  - Required; trim; 2–60 characters; must contain a letter in any script (`/\p{L}/u`), so Devanagari names work.
  - Saves `supabase.from('users').update({ full_name }).eq('id', userId)`.
- **Done.** Go to `safeNextPath(next)`. As a fallback: owner → `/dashboard`, admin → `/`.

Implementation notes:

- **Right after `verifyOtp`, read the profile row using the returned `data.user.id`.** Don't use `refreshProfile()`: `AuthContext` sets its session in the async `onAuthStateChange`, so at that moment `refreshProfile` may still see no session. The trigger created the row inside the verify transaction, so it's already there. Call `refreshProfile()` after saving the name.
- **Save the pending step** in `localStorage["redlotus_otp_pending"] = { phone, sentAt }`, with a 10-minute lifetime, wrapped in try/catch. Restore it on mount. This matters because Capgo's `directUpdate: true` can reload the WebView when the customer comes back from reading the SMS; without this they'd land on step 1 again and waste an SMS. Clear it on success, on "Change", and in `AuthContext.signOut` (shared phones).
- Block double-submits while a call is in flight. On a wrong code, clear the field and refocus it.

### 8.3 Shared pieces

- **`src/components/auth/PhoneOtpForm.tsx`** is the one OTP UI (phone field, code field, resend timer, error area), used in three modes:
  - `login`: `signInWithOtp` + `verifyOtp('sms')`.
  - `link`: `updateUser({ phone })` + `verifyOtp('phone_change')`.
  - `change`: same as `link`, but refuses the current number ("That's already your number").
- **`src/lib/phoneAuth.ts`** holds pure functions, tested (§11.1):
  - `normaliseIndianMobile(input) → string | null`
  - `toE164(m) → '+91' + m`
  - `formatMobile(m) → '+91 98765 43210'`
  - `otpDigits(input)` keeps digits only, at most 6
  - `safeNextPath(raw)` (§8.5)
  - `describePhoneAuthError(err) → { kind, message, retryAfterSeconds? }` (§8.4)
  - `OTP_LENGTH = 6`, `RESEND_SECONDS = 30`

### 8.4 Error copy

Match hook messages by their prefix first: hook errors may arrive without an error `code`, but the message always comes through verbatim (§3.3). Then match on `AuthApiError.code`.

| Signal | Meaning | Copy |
|---|---|---|
| `over_sms_send_rate_limit` + "after N seconds" | Asked again too soon | "Please wait N seconds before asking for a new code." Also restart the countdown at N. |
| `over_sms_send_rate_limit` (no seconds) | Project-wide SMS cap reached | "We're sending a lot of codes right now. Please try again in a few minutes." |
| `OTP_LIMIT_REACHED:` | Per-number / per-IP cap (hook) | "Too many codes for this number today. Message us on WhatsApp and we'll help you log in." |
| `PHONE_NOT_SUPPORTED:`, `validation_failed` | Not an Indian mobile | "Enter a valid 10-digit Indian mobile number." |
| `otp_expired` | Wrong **or** expired code (Supabase uses one code for both) | "That code didn't work. Check it, or tap Resend for a new one." |
| `SMS_SEND_FAILED:`, `sms_send_failed`, `hook_timeout`, `hook_timeout_after_retry` | Delivery failed | "We couldn't send the SMS right now. Please try again in a minute." |
| `phone_exists` | Number is on another account (link / change) | "This number already has a RedLotus account. Log out, then log in with this number." (with a **Log out** button) |
| `over_request_rate_limit` | Too many code checks from this network | "Too many attempts. Please wait a few minutes and try again." |
| `PHONE_NOT_VERIFIED:` (from `place_order`) | Legacy unverified session at checkout | Redirect to `/verify-phone?next=/checkout` |
| Network failure | Offline | "Connection problem — check your internet and try again." |
| Anything else | | Generic copy, and log via `console.error("[phone-auth]", err)` |

### 8.5 Returning to where the customer was

- `ProtectedRoute` redirects to `/login?next=${encodeURIComponent(pathname + search)}`. For `role="owner"` it uses `/partner/login?next=…`. When a phone check fails, it uses `/verify-phone?next=…`.
- `AppTopBar`'s and `Navbar`'s "Log in" links pass the current path as `next`.
- `safeNextPath(raw)` guards against redirects to other sites. It accepts only strings that start with `/`, not `//` or `/\`, and aren't `/login`, `/partner/login`, `/verify-phone` or `/auth/…`, up to 512 characters. Anything else falls back to `/`.
- The cart already survives the login redirect (`localStorage["redlotus_cart"]`, CartContext), so `next=/checkout` brings the customer back to a full cart.

### 8.6 `/partner/login`

This is today's `Login.tsx` form (`signInWithPassword`), minus:

- the Google button and hint;
- the "Create an account" link;
- the email probe (`.from("users").select("auth_provider").eq("email", …)`). It could never have worked: RLS lets an anonymous visitor read no `users` rows at all.

It keeps "Forgot password?" → `/reset-password`. Title: "Restaurant partner login". After sign-in: owner → `/dashboard`, admin → `/`, anyone else → `safeNextPath(next)`. It links back with "Ordering food? Log in with your mobile number" → `/login`. The partner onboarding checklist (`capacitor_native_apps_plan.md` §11.4) gains "Log in at **Restaurant partner login**".

### 8.7 `/verify-phone` — "Add your mobile number"

This is for legacy sessions only; new customers never see it. It uses `PhoneOtpForm` in `link` mode. Copy: "Add your mobile number — we'll use it to log you in next time and to call you about deliveries." On success it calls `refreshProfile()` and goes to `safeNextPath(next)`. It replaces the MSG91 calls in today's `VerifyPhone.tsx`. Keep the route until the analytics show no legacy sessions left, then delete it.

### 8.8 Profile

- **Customers**
  - Name is editable.
  - The number is shown **read-only** with a **Change** button, which opens `PhoneOtpForm` in `change` mode. On success, `refreshProfile()` and show "Number updated".
  - Email: show it read-only only if it isn't empty (legacy accounts); hide it otherwise.
  - Remove the `?setup=true` Google banner.
  - `handleSave` writes `full_name` only.
- **Partners / admin**
  - Name is editable.
  - Phone is read-only with "Contact RedLotus to change your number". Partner numbers are managed by Ankit (D1).

### 8.9 Edits and deletions

- **Delete:**
  - `src/pages/login-signup/Signup.tsx` and `Signup.css`.
  - `src/lib/googleAuth.ts`.
  - `NativeBridge`'s custom-scheme OAuth return: the `NATIVE_OAUTH_REDIRECT` handling in `getLaunchUrl` / `appUrlOpen`, and `routeToLoginWithError`.

  The `in.redlotusfoods.app://auth/callback` intent filter in `AndroidManifest.xml` stays until the next store build; it's harmless.
- **`AuthCallback.tsx`:** keep recovery routing (`/reset-password?mode=update`) and role routing. Drop the Google phone gate.
- **`Navbar.tsx` / `FooterCTA.tsx`:** remove "Sign up". "Log in" goes to `/login?next=…`.
- **`AuthContext.tsx`:** `auth_provider` gains `'phone'`, `email` may be `''`, and `signOut` also clears `redlotus_otp_pending`.
- **`src/types/database.ts`:** regenerate for `sms_otp_log` / `claim_sms_otp_slot` / `mobile10`. Use `npx supabase gen types typescript --linked`, since Docker isn't installed for `--local`. On Windows, redirect with `Out-File -Encoding utf8` or use Git Bash, because PowerShell 5.1's `>` writes UTF-16.

### 8.10 Android app specifics

- **Ships by OTA:** web code only. No plugin, permission or `android/` change is needed (Capgo's safe harbour, plan §5.4).
- **Leaving to read the SMS and coming back** keeps React state. The saved pending step (§8.2) covers a Capgo reload on the way back.
- **Hardware back on the code step** goes to the phone step, not away from the screen (NativeBridge's back handler follows history, so push the step to history, or handle it in the component).
- The on-screen keyboard is numeric on both steps. The code field keeps focus after a failed attempt.
- Nothing changes in `supabaseClient.ts`. The native Keystore session storage and PKCE setting keep working, because `verifyOtp` returns the session directly.

### 8.11 Copy and accessibility rules

- Short, plain English with no jargon. Say "code" in body text and "OTP" only on buttons, since customers know both.
- Hindi labels are §13.
- Every field has a real `<label>`. Errors sit in an `aria-live="polite"` region. Tap targets are at least 48 px. The countdown is announced politely, not every second.
- Never say "app", "download" or "install" (CLAUDE.md product rule).

---

## 9. Abuse, security and privacy

### 9.1 Threats and controls

| Threat | Control |
|---|---|
| **Wallet-draining** (a script requesting codes for thousands of random numbers) | Project-wide cap of 60/hour, which only works with confirmations ON (§3.4). Per-IP cap of 20/hour (hook). MSG91 wallet balance and alerts. **Emergency switch:** turn on Turnstile CAPTCHA (Auth → Attack Protection) and pass `captchaToken` in `signInWithOtp`. Or lower the cap. |
| **SMS bombing** (flooding one victim's phone through our endpoint, a common abuse of public OTP forms in India) | Per-number cap of 10 per 24 h (hook) plus the 30 s per-user resend window |
| **Code guessing** | 6 digits (a million possibilities), 5-minute expiry, a new code replaces the old one, and verification is limited to 30 per 5 min per IP |
| **Fake hook calls** | Standard Webhooks signature check with `SEND_SMS_HOOK_SECRET`. Unsigned requests are refused before anything is read. |
| **Texting the wrong number** during a phone change | `sms.phone` is the only trusted destination. The fallback to `user.phone` refuses whenever a change is pending (§5.2). |
| **Unverified numbers in the profile table** | Confirmations ON, profile creation only on confirmation (§4.2), and a hook refusal rolls back the sign-up |
| **Customer changing role / verification flags** | 024 column grants now; 028 narrows customer writes to `full_name` only. The 005 trigger still blocks `phone_verified = true`. |
| **Ordering without a verified phone** | Order trigger `PHONE_NOT_VERIFIED:` (§4.2 step 6) |
| **Codes or numbers leaking into logs** | Codes are never logged. Numbers are masked to their last 3 digits. `sms_otp_log` is service-role only and pruned at 48 h. Sentry keeps `sendDefaultPii: false`. |

### 9.2 Accepted risks

- **Recycled numbers.** Indian telcos reassign numbers about 90 days after disconnection. The new owner of a recycled number can log into the old account and see its order history, saved addresses and name. Zomato and Swiggy accept the same risk. There are no stored cards (COD), and a delete-account request frees the number cleanly.
- **SIM swap / SMS interception.** A targeted attack against a food-ordering account yields little. It's accepted for the same reason.
- **One number = one account.** Family members sharing a phone share an account. Before this change, duplicates were possible (`users.phone` has no unique rule, while `auth.users.phone` does), so this change *removes* a source of messy data.
- **An owner who types their personal number into the customer login** gets a separate customer account, because partner accounts aren't phone-linked (D1). The partner link and onboarding cover this.

### 9.3 Legal copy, listing and Play Console

| Where | Change |
|---|---|
| `PrivacyPolicy.tsx` §2, "Account information" | Replace the email/password/Google text with: your mobile number (verified with a one-time code sent by SMS) and your name. Accounts created before the switch may also have an email address. Restaurant partners sign in with email and password, which is never stored in readable form. Fold the separate "Mobile number" bullet into this one. |
| `PrivacyPolicy.tsx` §5 purposes | "…verify your identity and mobile number via OTP, and to send account-related emails such as password resets" → "…sign you in with a one-time code sent to your mobile number, and send password-reset emails to restaurant partners". |
| `PrivacyPolicy.tsx` §7, MSG91 bullet | **Currently: "The OTP itself is generated and checked by MSG91; we never store your OTPs." This becomes false at launch.** New text: "MSG91 delivers the sign-in code by SMS. The code is generated and checked by Supabase, stored only in scrambled (hashed) form until it is used or expires." |
| `PrivacyPolicy.tsx` §7, Google bullet | Drop "only if you choose Google sign-in, for authentication". Keep the Google Maps part. |
| `PrivacyPolicy.tsx` retention | Add: "Records of sign-in code requests (mobile number, network address, time) are kept for 48 hours to prevent abuse." |
| `TermsOfService.tsx` (around line 158) | "create an account (using email and password, or Google sign-in) and verify your mobile number via … OTP" → "create an account by verifying your mobile number with a one-time password (OTP) sent by SMS". |
| `store-listing/listing.md` App access | Replace the email/password test account with the D8 number and fixed code, marked "(fixed test code — no SMS is sent)". |
| `store-listing/listing.md` native features | "Google sign-in via Custom Tabs" → "mobile-number sign-in with a one-time SMS code". |
| Play Console → Data safety | Email address stays declared, since partners and legacy accounts still have one, but **mark it optional**. Phone number stays required. |
| Play Console → App access | Update to the test number **at launch**. After launch, the old email test account can only sign in through the partner page. |

---

## 10. Rollout

No deploys between 12–2 PM or 7–9:30 PM IST. Check the time with PowerShell `Get-Date`: on this machine Git Bash's `TZ=Asia/Kolkata date` prints UTC mislabelled as IST.

| Phase | What ships | Gate to move on | Rollback |
|---|---|---|---|
| **0 — Hotfix** ✅ 2026-09-25 | 024 + `ops/024_verify.sql`. PR → preview branch → verify + functional checks (§2.4) → `db push` → confirm on production with `db query --linked` → merge. | Done: every verify row is `true` on production (§2.6). | Re-grant (§2.4) |
| **1 — Backend dark launch** (no UI change) | MSG91 smoke test (§5.3) → 027 on the branch + branch tests B1–B3 with test numbers → merge (deploys `auth-send-sms`) → 027 on production → secrets → Dashboard settings in §6.1 order, **Phone provider last** → `verify-otp` dual write (§7.5) → production checks P1–P6 (§11.3) with Ankit's phone. | P1–P6 pass. MSG91 shows a 6-digit code delivered. A refused number leaves no `auth.users` row. | Turn off the Phone provider and hook (instant). `027_rollback.sql`. |
| **2 — Backfill** | Sizing (§7.2) → dry run → settle conflicts (§7.4) → `--live` → re-run sizing. | Every eligible verified customer has an auth phone. Conflicts decided. | Backfilled phones are harmless if unused. They can be cleared through the admin API. |
| **3 — Launch** (web + OTA) | Frontend PR (§8) → Vercel preview on the branch → device matrix (§11.4) → update Play App access (§9.3) → merge off-peak → bump `package.json` version (the OTA gate). | Funnel healthy for 48 h (§12). No login-failure spike in Sentry or the Supabase auth logs. | Vercel instant rollback + Capgo previous bundle. The old flows still work, because Google, email and the legacy functions are all still live. |
| **4 — Transition** (D9, ≥30 days) | Nothing new. Watch the funnel and Capgo adoption. Re-run the backfill weekly. | 95%+ of active installs on the new bundle, and no customer logins via Google in the last 14 days (auth logs). | — |
| **5 — Cleanup** | Turn off the Google provider → remove `send-otp` / `verify-otp` from `config.toml` and delete them → **028** (`REVOKE UPDATE ON public.users FROM authenticated; GRANT UPDATE (full_name) ON public.users TO authenticated;`) → docs (§15) → next store build drops the custom-scheme intent filter. | — | Re-enable Google. Re-grant `phone` / `phone_verified`. |

---

## 11. Testing

### 11.1 Unit tests (Vitest, pure logic — CLAUDE.md scope)

`src/lib/phoneAuth.test.ts`:

- **Normalising.** `98765 43210`, `+91 98765-43210`, `09876543210` and `919876543210` all become `9876543210`. `5876543210`, `+44 7700 900123`, `98765` and `''` become `null`.
- **Formatting.** `formatMobile` and `toE164`.
- **`otpDigits`.** Strips non-digits and caps at 6.
- **`safeNextPath`.** `/checkout` passes. `//evil.com`, `/\evil.com`, `https://x`, `/login`, `/partner/login`, `/auth/callback`, a 600-character path, `null` and `''` all become `/`.
- **`describePhoneAuthError`.** One case per row of §8.4, including extracting `retryAfterSeconds` from "after 17 seconds", matching prefixes on messages with no `code`, and the network case.

### 11.2 Preview branch (test numbers from §6.2)

| # | Case | Expect |
|---|---|---|
| B1 | **New number.** Request the OTP, then query the DB. | An `auth.users` row with `phone_confirmed_at IS NULL`; **no** `public.users` row. This proves confirmations are ON and profile creation waits. |
| B2 | …then verify with the code | `public.users` row: `phone` has 10 digits, `phone_verified = true`, `auth_provider = 'phone'`, `full_name = ''`. Name step → saved → checkout → order placed, and `orders.customer_phone` has 10 digits. |
| B3 | Log in again with the same number | Same user id, no name step, order history visible |
| B4 | Non-Indian number through the API (real hook only; run it in P3) | Hook returns 400 `PHONE_NOT_SUPPORTED:`; **no** `auth.users` row created (rolled back) |
| B5 | Wrong code; resend before 30 s; resend after | `otp_expired` copy; countdown from the server's N; the old code is rejected after a resend |
| B6 | Profile → change to the second test number | The new number is mirrored and verified. The old number now opens a **new** empty account. |
| B7 | Change to a number already on another account | `phone_exists` copy with a Log out button |
| B8 | Legacy email customer, unverified: sign in on `/partner/login` → `/checkout` | Redirect to `/verify-phone?next=/checkout` → link a number → verified → back at checkout |
| B9 | Backfilled legacy customer (run the backfill against the branch) → OTP login | **Same user id**, old orders visible |
| B10 | Seed owner at `/partner/login` → `/dashboard`. Open `/dashboard` while logged out. | Dashboard loads; logged out redirects to `/partner/login?next=%2Fdashboard` |
| B11 | `/login?next=//evil.com` | Lands on `/` |
| B12 | Delete account → log in with the same number | A fresh user id with no history |
| B13 | Customer session: `update({ role: 'admin' })` and `update({ phone_verified: true })` | Both refused (024 grants / 005 trigger) |
| B14 | Unverified legacy session calls `place_order` directly | `PHONE_NOT_VERIFIED:` |
| B15 | Logged out: open a restaurant from the storefront (D6) | The menu loads with no login. Add to cart → checkout → `/login?next=/checkout`. |
| B16 | Abandon at the code step, come back the next day with the same number | A new code is sent, verify works, and there's still exactly one auth user for the number |

### 11.3 Production dark launch (Phase 1, Ankit's phone)

| # | Check |
|---|---|
| P1 | `curl` `POST /auth/v1/otp` `{"phone":"+91<ankit>"}` with the anon key → the SMS arrives with a **6-digit** code in the DLT text |
| P2 | `POST /auth/v1/verify` `{"type":"sms","phone":"+91<ankit>","token":"<code>"}` → session JSON. Then (counts / own row only) confirm the `public.users` mirror. |
| P3 | Same with `+447700900123` → `400 PHONE_NOT_SUPPORTED:`; `auth.users` has no row for it |
| P4 | 11th request for one number within 24 h → `OTP_LIMIT_REACHED:`. Clean up with `DELETE FROM public.sms_otp_log WHERE phone = '<ankit>'`. |
| P5 | Edge Function logs show masked numbers and no codes. The MSG91 wallet shows about ₹0.20 deducted per send. |
| P6 | The D8 test number logs in with its fixed code and **no SMS is sent** (the MSG91 log has no entry) |

### 11.4 Devices

- A low-end Android phone with the app over 4G. Leave to read the SMS and come back; a Capgo update applying on return must restore the code step.
- Chrome on Android (web).
- iPhone Safari: `one-time-code` should offer the code above the keyboard.
- A desktop browser.
- Hindi keyboard input for the name.
- Screen reader smoke test (TalkBack) on the code step.

---

## 12. Monitoring, cost and success

**Weekly funnel** (`supabase/ops/phone_login_funnel.sql`, counts only, last 7 days):

```sql
WITH s AS (          -- phone-only sign-ups started in the window
  SELECT a.id, a.phone_confirmed_at
  FROM auth.users a
  WHERE a.phone IS NOT NULL AND coalesce(a.email, '') = ''
    AND a.created_at > now() - interval '7 days'
)
SELECT
  count(*)                                                    AS started,
  count(*) FILTER (WHERE s.phone_confirmed_at IS NOT NULL)    AS verified,
  count(*) FILTER (WHERE p.full_name <> '')                   AS named,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.orders o
                                 WHERE o.customer_id = s.id)) AS ordered
FROM s LEFT JOIN public.users p ON p.id = s.id;
```

**Success looks like:**

- `verified / started` ≥ 85% after two weeks. If it's lower, check MSG91 delivery logs before touching the UI.
- `ordered / verified` rises compared with the old flow. Take a baseline before launch: count email/Google sign-ups from the last 30 days that reached `phone_verified`, and those that ordered.
- WhatsApp "can't log in" queries fall. Keep a manual tally for a month.

**Also watch:**

- MSG91 → Logs → SMS for `Failed` / `Rejected` (usually a DLT template or header problem).
- `sms_otp_log` volume per day.
- Edge Function error lines.
- Supabase auth logs for `over_sms_send_rate_limit`.

**Cost.** About ₹0.20 per SMS (per the live MSG91 rate).

- Monthly SMS ≈ new customers × ~1.3 (resends) + re-logins (new phone, sign-out, reinstall) + number changes.
- Example: 200 new customers and 100 re-logins a month ≈ 360 SMS ≈ **₹72/month**, against about ₹15/month for phone verification today.
- Worst-case abuse is capped at 60 SMS/hour ≈ ₹12/hour, until someone notices or the wallet runs dry. Set an MSG91 low-balance alert.

---

## 13. Later (not in v1)

- **SMS auto-read (D4).**
  - Web (WebOTP): a new DLT template whose last line is `@www.redlotusfoods.in #<code>`. It has to be `www`, because the bare domain redirects there and WebOTP matches the page's origin.
  - Android app: the SMS User Consent API through a native plugin, which means a store build.
  - Both need Airtel DLT approval of the new template.
- **WhatsApp OTP fallback.** MSG91 WhatsApp authentication templates need Meta business verification. The hook would choose the channel.
- **Voice OTP** for "SMS never came", if MSG91 delivery logs show a real gap.
- **Hindi labels** on the login screen (plus Rajasthani-friendly wording), ideally app-wide.
- **CAPTCHA (Turnstile)** as a permanent control, if §9.1 abuse shows up more than once.
- **Phone OTP for partners**, if partners ask. They'd need their numbers attached, and owner numbers would then be unusable for customer accounts.
- **Merging duplicate accounts** (moving orders, reviews and addresses between user ids) as a support tool.
- **Pruning unconfirmed auth users** (numbers that asked for a code and never verified) with a daily `pg_cron` job. They're harmless: no profile, no session.

---

## 14. Adjacent findings (found while planning; not part of this build)

| Finding | Severity | Suggested fix |
|---|---|---|
| Customers could make themselves **admin**; owners could edit restaurant / dish ratings, featured and radius columns | **Critical** | **Fixed 2026-09-25**: migration 024 (§2.6) |
| Customers could create orders directly, including already-`completed` ones that unlock "verified" reviews; owners could rewrite any column of their restaurant's orders | **High** | Audited 2026-09-25 → migration 025 (§2.5) |
| `delete-account` doesn't clear `orders.customer_name` / `customer_phone`, but the public `/delete-account` page (linked from the Play data-deletion form) says name and phone on past orders are removed | Medium (Play / DPDP) | Add both columns to the orders scrub in `delete-account`. Clear them only on orders in a finished state, so a rider mid-delivery keeps the number. This matters more once the phone number is the login. |
| `/restaurants/:id` requires login despite anonymous menu browsing (016) | UX | D6: in this build if approved |
| WhatsApp help number differs between Login/Signup (`919460049608`) and CLAUDE.md (`916378939472`) | Low | D10 |
| `Login.tsx`'s "this email is linked to Google" probe can't work (RLS blocks anonymous reads of `users`) | Low | Removed in §8.6 |

---

## 15. File checklist

**New**
- `supabase/migrations/024_column_write_grants.sql`, `supabase/ops/024_verify.sql` (shipped)
- `supabase/migrations/025_orders_write_grants.sql`, `supabase/ops/025_verify.sql`, `supabase/ops/025_rollback.sql` (orders audit)
- `supabase/migrations/026_owner_self_review_guard.sql`, `supabase/ops/026_verify.sql`, `supabase/ops/026_rollback.sql` (review guard)
- `supabase/migrations/027_phone_otp_login.sql`, `supabase/ops/027_verify.sql`, `supabase/ops/027_rollback.sql`, `supabase/ops/027_sizing.sql`, `supabase/ops/027_backfill_customer_phones.mjs`, `supabase/ops/phone_login_funnel.sql`
- `supabase/migrations/028_phone_otp_cleanup.sql` (Phase 5)
- `supabase/functions/auth-send-sms/index.ts`
- `src/lib/phoneAuth.ts` + `src/lib/phoneAuth.test.ts`
- `src/components/auth/PhoneOtpForm.tsx` (+ CSS)
- `src/pages/login-signup/PartnerLogin.tsx` (+ CSS, from today's `Login.tsx`)

**Changed**
- `src/pages/login-signup/Login.tsx` (rewritten as the customer OTP screen)
- `src/pages/auth/VerifyPhone.tsx`, `src/pages/auth/AuthCallback.tsx`, `src/pages/profile/Profile.tsx`
- `src/App.tsx` (routes, D6), `src/components/ProtectedRoute.tsx` (`next`, partner redirect)
- `src/components/AppTopBar.tsx`, `src/components/Navbar.tsx`, `src/components/FooterCTA.tsx`, `src/components/NativeBridge.tsx`
- `src/context/AuthContext.tsx`, `src/pages/checkout/Checkout.tsx` (`PHONE_NOT_VERIFIED:` → `/verify-phone`)
- `src/components/PrivacyPolicy.tsx`, `src/components/TermsOfService.tsx`
- `supabase/functions/verify-otp/index.ts` (dual write, Phase 1)
- `supabase/config.toml`
- `src/types/database.ts` (regenerated)
- `store-listing/listing.md`

**Deleted**
- `src/pages/login-signup/Signup.tsx`, `src/pages/login-signup/Signup.css`, `src/lib/googleAuth.ts`
- `supabase/functions/send-otp/`, `supabase/functions/verify-otp/` (Phase 5)

**Docs after launch**
- `CLAUDE.md` + `GEMINI.md`:
  - routes table (`/login`, `/partner/login`, `/signup`, `/verify-phone`, `/restaurants/:id`), the auth gates section, the file map;
  - Critical rules: the phone mirror trigger, "confirmations ON", 024/028 column grants, "hook never returns 429/503";
  - Phone verification section, v2-deferred list (drop OTP login), Hosting & env (the hook secret).
- `src/docs/v2_deferred_issues.md`.
- A status line at the top of `phone_verification_plan.md` pointing here.

---

## 16. Sources (checked 2026-09-25)

- Supabase — Send SMS hook: <https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook>
- Supabase — Auth hooks (plans, 5 s budget, retries, error shape): <https://supabase.com/docs/guides/auth/auth-hooks>
- Supabase — Phone login: <https://supabase.com/docs/guides/auth/phone-login>
- Supabase — Auth rate limits: <https://supabase.com/docs/guides/auth/rate-limits>
- Supabase — Auth error codes: <https://supabase.com/docs/guides/auth/debugging/error-codes>
- Supabase — CLI config (`auth.sms.*`, `auth.rate_limit.*`): <https://supabase.com/docs/guides/local-development/cli/config>
- Supabase — Phone settings (OTP length 6–10, test OTPs skip delivery, valid-until): <https://supabase.com/docs/guides/self-hosting/self-hosted-phone-mfa>
- Supabase — GitHub integration (production merge ignores `[auth]`): <https://supabase.com/docs/guides/deployment/branching/github-integration>
- Supabase Auth server source (`github.com/supabase/auth`, `master`):
  - `internal/api/phone.go`: `sms.phone` passed to the hook; the SMS limiter is skipped under autoconfirm.
  - `internal/api/signup.go`: autoconfirm confirms the phone at sign-up.
  - `internal/api/otp.go`
  - `internal/api/admin.go`: an admin phone update creates the `phone` identity.
  - `internal/hooks/v0hooks/v0hooks.go`: payload incl. `metadata.ip_address`.
  - `internal/hooks/hookshttp/hookshttp.go`: 5 s, 3 retries on 429/503.
  - `internal/hooks/hookserrors`: messages passed through verbatim.
- MSG91 — SendOTP API parameters (optional `otp`: "OTP you want to send"): <https://knowledgebase.msg91.com/how-to-integrate-sendotp-api->
