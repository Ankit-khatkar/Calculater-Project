# Filters and Sorting — Feature Design & Implementation Plan

> **Status:** v2 draft (2026-10-23). **Backend changes are now in scope.** On 2026-10-23 Ankit wrote: "you can update the backend for apply this feature with accuracy like Zomato-style filters and sorting panel". Waiting on Ankit's answers to §0 (FS1–FS16) and the read-only audit in Appendix A. No code and no database object has changed for this feature yet.
> **Author:** Ankit (drafted with Claude)
> **Revision:** v2 — 2026-10-23. v1 (same day) was frontend-only; §2 lists what v2 changes.
> **Baseline:** `main` @ `0d4754b` (plus uncommitted copy changes in the working tree): 463 tests pass in 39 files; lint and `tsc -b` clean.
> **Scope:**
> - a Zomato-style "Filters and sorting" panel and filter bar for Home's "restaurants near you" list (`/`) and the Search results (`/search`, both tabs);
> - **the backend facts it needs:** server-stamped order progress times, per-restaurant menu facts, an admin-verified Pure Veg flag enforced against the menu, delivery-time estimate inputs, popularity scores and a nightly refresh;# Phone-First Login for Customers — Build Plan

> **Status:** Ready to implement (revision 2). Every decision in §0 is made; only D12's **Skip** button awaits Ankit's yes/no. Nothing in §4–§8 is built yet. §2 records the security fixes that shipped first.
> **Author:** Ankit (drafted with Claude)
> **Revision:** v2 — 2026-11-12 (v1: 2026-09-25). What changed:
> - **Ankit's phone-first brief (2026-11-12):** the login screen when a signed-out visitor opens RedLotus, one entry point with **Continue**, a name gate, and Home after login. §17 maps every point of the brief to a section.
> - **D7–D9 locked** (D8 is the support SIM `+91 94600 49608`), and **D11–D14 added** (§0).
> - **Rebased on the customer UI redesign** (live 2026-10-06): menus are already public, Orders and Profile are tabs with `SignInPanel`, and the new screens use the design-system primitives (§8).
> - **Corrections** from re-checking the code, the Supabase docs and the Auth server source:
>   - test numbers need an SMS provider configured (§6.2);
>   - the project-wide SMS cap is spent before the hook runs, and CAPTCHA can't be switched on in an emergency (§9.1);
>   - the admin API confirms a phone before setting it (§3.3, §4.3);
>   - the name step needed a gate (§8.4);
>   - the new order trigger would break two test scripts (§4.3).
> - **Migrations renumbered** to 033/034.
>
> **Depends on:** 002 (`handle_new_user`, `users` RLS), 005 (phone-verified guard trigger), 016 / 019 / 023 (column-grant doctrine), and the MSG91 account + Airtel-DLT OTP template that `send-otp` already uses (MSG91 template id `69f2350acf9869ba19066fc2`, header `RDLOTS` — `phone_verification_plan.md` §3.1).
> **Supersedes:** customer sign-up and log-in in `phase1_customer_mvp_plan.md` (email + password, Google, `/profile?setup=true`) and the customer half of `phone_verification_plan.md` (`send-otp` / `verify-otp` retire in Phase 5). Takes "OTP-based login" off the v2-deferred list.
> **Migrations:** shipped first: `024_column_write_grants.sql` (§2), `025_orders_write_grants.sql` (§2.5), `026_owner_self_review_guard.sql` (§2.7). This build: **`033_phone_otp_login.sql`** (§4) and **`034_phone_otp_cleanup.sql`** (after the transition window, §10). v1 called them 027 and 028; those numbers went to coupons (027–029, [coupons_and_promo_codes_plan.md](coupons_and_promo_codes_plan.md)), and 030–032 went to filters and sorting ([filters_and_sorting_plan.md](filters_and_sorting_plan.md)). If another migration lands first, take the next free numbers and rename the `ops/033_*` scripts with them. Never reuse `ops/027_*` or `ops/028_*`: those files are coupons'.

## At a glance

- Customers sign in with **mobile number → Continue → 6-digit SMS code → name (new customers only)**, on one screen. There's no separate sign-up: the number decides whether it's a new account. No email, no password, no Google.
- **A signed-out visitor who opens RedLotus sees that screen first**, Zomato-style, with **Skip** to browse (D12). Checkout, order pages and reviews still ask for the login when they need it. After login the customer lands on Home, or back on the screen that asked (D14).
- **Supabase Auth owns the OTP.** It generates the code, stores it hashed, checks it, rate-limits it and issues the session. **MSG91 only delivers it**, through the same DLT-approved template. The link between them is Supabase's *Send SMS hook*, which calls a new Edge Function, `auth-send-sms`.
- **Restaurant partners and admin keep email + password**, on a new `/partner/login` page.
- **Existing customers keep their accounts.** Before launch, every verified phone gets attached to its existing auth user. Typing that number then opens the same account, with its orders, reviews and saved addresses.
- **Found while planning, fixed first:** any signed-in customer could make themselves an admin, and orders could be forged (§2). Migrations 024–026 closed both on 2026-09-25, independently of this build.

---

## 0. What this plan needs from Ankit

| # | Decision | Status | Why it matters |
|---|---|---|---|
| **D1** | Who logs in with OTP | **Locked: customers only.** Partners and admin keep email + password at `/partner/login`. | Partners are onboarded by hand and stay signed in, and they aren't the ones getting stuck. Keeps partner accounts out of the migration. |
| **D2** | Google + email/password for customers | **Locked: removed.** | Existing customers reach their old account by typing their verified number (§7). This deletes email confirmation, forgot-password and the native Google browser trip. |
| **D3** | What a new customer fills in after the OTP | **Locked: name only, required.** | `place_order` already refuses an empty name (022, step (a); still true in 027's version). New customers give no email. The name gate (§8.4) makes sure that closing the app mid-step can't skip it. |
| **D4** | SMS auto-read | **Locked: not in v1.** | Reuses today's template. Auto-read needs a new DLT template and a store build (§13). |
| **D5** | Ship the **024 security hotfix** now, on its own | **✅ Shipped 2026-09-25, 16:25 IST** (PR #58). Verified on production (§2.6). | Any signed-in customer could become admin (§2). |
| **D6** | Make restaurant menus public | **✅ Done by the customer UI redesign** (its D4, live 2026-10-06). `/restaurants/:id` has no login wall. | Nothing left to build. B15 stays as a regression test. |
| **D7** | SMS limits | **Locked 2026-11-12:** 60 SMS/hour project-wide, 10 per number per 24 h, 20 per IP per hour, 30 s between resends. | Caps the cost of abuse at about ₹12/hour (§9). The Supabase limits are Dashboard settings; the per-number and per-IP caps are Edge Function env vars. The project-wide cap also bounds how many logins a bot can block (§9.1). |
| **D8** | Play reviewer login | **Locked 2026-11-12: `+91 94600 49608`**, RedLotus's own customer-support SIM, registered in Supabase as a test number with a fixed code. | Reviewers can't receive our SMS. The SIM is RedLotus's, so the fixed code opens no one else's account, as long as the account on that number is a dedicated reviewer account. §7.2 checks that before the number is configured. While it's a test number Supabase never texts it, so Ankit's own logins and checks P1–P5 use a different number. |
| **D9** | How long to wait before switching off Google and the old OTP functions | **Locked 2026-11-12: at least 30 days, and until 95%+ of active app installs run the new bundle** (Capgo stats). | Installed apps show the old login screen until the OTA lands, so the old paths must keep working until then (§10). |
| **D10** | WhatsApp help number on the login screen | **Answered 2026-10-06 (redesign D17): `919460049608`**, the number every customer screen shows. `916378939472` is for partners and owner tools. | The new screen keeps the "Can't log in?" link. |
| **D11** | One number = one account | **Locked 2026-11-12** (Ankit's brief: the phone number is the account's identifier, normalised and unique). | Reverses the v1 rule in `redlotusfoods_documentation.md` §4.7.9 ("`users.phone` is NOT UNIQUE… families share numbers"), which said OTP login would need exactly this. Family members on one SIM now share one account. Uniqueness lives in `auth.users.phone` (§4.3). |
| **D12** | What a signed-out visitor sees on opening RedLotus | **Locked 2026-11-12** (Ankit's brief): the phone login screen first, Zomato-style. **Skip: recommended, awaiting a yes/no.** | The brief asks for the login screen at launch. Without Skip, nobody could look at a menu without handing over a number, and shared restaurant links and `/coupons?apply=` banners would hit a wall, against 016 and the redesign's D4/D5. With Skip it works the way Zomato's app does (§8.2). |
| **D13** | Country code | **Decided 2026-11-12:** `+91` only in v1, shown as a fixed chip. The brief asks for a country selector with India as the default. | The SMS route (MSG91 + Airtel DLT) reaches only Indian numbers and the hook refuses others, so a selector could only offer countries that fail. It becomes a picker when there's an international route (§13). |
| **D14** | Where login lands | **Locked 2026-11-12:** Home (the brief's journey). When a screen sent the customer to log in (checkout, an order, a review), back to that screen instead. | Someone sent to log in from checkout keeps their cart and returns to it, rather than starting again from Home (§8.7). |

---

## 1. Why this change

### 1.1 What a new customer goes through today

Traced from `Signup.tsx`, `Login.tsx`, `AuthCallback.tsx`, `Profile.tsx` and `VerifyPhone.tsx` (re-checked 2026-11-12):

| Path | Steps today | What goes wrong for our customers |
|---|---|---|
| **Email** | `/signup`: name + email + password → "Check your inbox" → leave the app, find the email, tap the link → `/auth/callback` → `/verify-phone`: type number → SMS → type a 4-digit OTP | They need an email inbox they actually check, and a password to invent and remember. The flow also leaves the app halfway through. |
| **Google (web)** | Continue with Google → account picker → `/auth/callback` → `/profile?setup=true`: type number → `/verify-phone` → OTP | They need a Google account signed in on the phone, plus two extra screens. |
| **Google (Android app)** | A browser opens over the app → Google → return via the `in.redlotusfoods.app://` scheme → `/profile?setup=true` → `/verify-phone` → OTP | The browser trip is the most fragile step. It has its own failure copy (`describeOAuthReturnError`) because it fails in several ways. |
| **Returning, signed out** | Email + password, or Google | A forgotten password means an email reset link. |

Two things make every path worse:

- **They all end on the storefront, not where the customer was.** `ProtectedRoute` redirects to `/login` without a return path. The post-login gates then send customers to `/restaurants` (which redirects to `/`).
- **There are two doors.** "Log in" and "Create an account" sit side by side (`Login.tsx`, `SignInPanel.tsx`), and a returning customer who picks the wrong one gets stuck.

v1 listed a third problem: the login wall on the first restaurant tap. The redesign removed it on 2026-10-06. Menus are public, and Orders and Profile show an in-place `SignInPanel`.

### 1.2 What it becomes

```
Open RedLotus while signed out            Or need a login (checkout, an order, a review)
  → the login screen  (Skip → Home)         → /login?next=/checkout
     1. Mobile number   [+91 | 98765 43210]                      [Continue]
     2. 6-digit code    [______]  (checks itself on the 6th digit)   Resend in 0:30
     3. Your name       (new customers only)                     [Continue]
  → Home, or back to the screen that asked (D14)
```

Returning customers skip step 3. A restaurant partner taps **"Restaurant partner? Log in with email"** and goes to `/partner/login`.

### 1.3 Why phone OTP fits RedLotus

- **The phone number is already the account that matters.** Ordering requires a verified phone, the rider calls it, and payment is cash on delivery. Today it is verified as a *fourth* step; this plan makes it the only step.
- **The SMS setup is already live.** The MSG91 wallet, the Airtel DLT header `RDLOTS` and the approved OTP template are in production and delivering today.
- **Supabase has phone-OTP login built in.** MSG91 isn't one of its built-in SMS providers, but the Send SMS hook plugs it in (§3).
- **It removes code.** Gone: `Signup.tsx`, `googleAuth.ts`, the native OAuth return path in `NativeBridge`, forgot-password for customers, the Google setup gate and, after cleanup, two Edge Functions.
- **Every customer is phone-verified by construction.** `phone_verified` stops being a separate hurdle.
- **iOS gets easier.** App Store Guideline 4.8 says an app offering Google sign-in must also offer an equivalent privacy-focused login, which in practice means Sign in with Apple. It doesn't apply to an app's own phone login.
- **It ships to the Android app by OTA.** No new plugin, no new permission and no store build are needed (§8.12).

### 1.4 What does not change

- **Logged-out browsing** (016, redesign D4/D5). The launch screen's **Skip** leads straight to it (D12), and shared links open without it. Login is needed for checkout, order pages, reviews and saved addresses, and for the personal parts of the Orders, Profile and Offers tabs.
- **Location stays optional.** It's asked only when Home needs it, after the login screen (§8.2). No address or other detail is needed to browse.
- Checkout still needs a name and a verified phone. Every OTP customer has a verified phone by construction.
- Partners use the same email + password accounts and the same dashboard.
- Sessions: Supabase keeps people signed in until they sign out. The session lives in localStorage on the web and in the Android Keystore in the app. `supabaseClient.ts` doesn't change: `verifyOtp` returns a session directly under both the web (implicit) and native (PKCE) flow types.
- **RLS policies: none change.** 033 adds triggers and a table only the service role can touch; 034 narrows one column grant (§4, §10).
- COD, pricing, orders, push, the owner dashboard: untouched.

### 1.5 How authentication works today (audit, 2026-11-12)

Checked against the code and migrations on `main` at `3c9bceb`. CLAUDE.md describes the same thing and is accurate.

| Area | Today | Where |
|---|---|---|
| Customer sign-up and log-in | Email + password with email confirmation, or Google. Google is a redirect on the web, and a system-browser trip with a custom-scheme return in the app. | `Signup.tsx`, `Login.tsx`, `lib/googleAuth.ts`, `NativeBridge.tsx` |
| Partners and admin | Email + password on the same `/login`. | `Login.tsx` |
| Phone verification | A separate step after sign-in. `/verify-phone` → `send-otp` (MSG91 SendOTP; MSG91 makes a 4-digit code, `otp_expiry=5`) → `verify-otp` (MSG91 checks the code, then the service role sets `phone_verified`). | `VerifyPhone.tsx`, `supabase/functions/send-otp`, `verify-otp` |
| Supabase providers | Email and Google on. Phone isn't used. | Dashboard |
| Sessions | Web: implicit flow, localStorage. App: PKCE, Android Keystore. They last until sign-out. | `supabaseClient.ts` |
| Profile row | `handle_new_user` (002) inserts `public.users` on every `auth.users` INSERT. The phone comes from sign-up metadata; `auth_provider` is `email` or `google`. There's no foreign key between the two tables. | 002 |
| Guards on `users` | The 005 trigger: a phone change resets `phone_verified`, and only the service role may set it to true. 024's column grants: customers write only `full_name`, `phone` and `phone_verified`. | 005, 024 |
| After sign-in | Google without a phone → `/profile?setup=true`; unverified customer → `/verify-phone`; customer → `/restaurants` (→ `/`); owner → `/dashboard`; admin → `/`. | `Login.tsx`, `AuthCallback.tsx` |
| Route guards | `ProtectedRoute` (role, `requirePhoneVerified`) on checkout, order pages, reviews, saved addresses, `/verify-phone` and the dashboard. It redirects to `/login` with no return path. The Orders and Profile tabs show `SignInPanel` ("Log in" / "Create an account"). | `App.tsx`, `ProtectedRoute.tsx`, `SignInPanel.tsx` |
| Public browsing | Anon reads open restaurants and menus (016). Home, Search, Offers and menus need no login. | 016, redesign D4 |
| Ordering | `place_order` refuses an empty name or phone. **Nothing on the server checks `phone_verified`** (025 dropped `orders_customer_insert`); only coupon use does. | 027 (`place_order` v5) |
| Phone uniqueness | `auth.users.phone` is unique (`users_phone_key`). `public.users.phone` isn't (main docs §4.7.9). | |
| Sign-out | Deletes the push token, signs out, and clears the location cache and recent searches. | `AuthContext.tsx` |
| Account deletion | Anonymises the profile and the order addresses, keeps the name and phone on past orders, and deletes the auth user. | `delete-account` |

### 1.6 Which documents describe authentication

This plan is the authoritative document for the new workflow. The others:

| Document | What it describes | State on 2026-11-12 | What happens to it |
|---|---|---|---|
| `CLAUDE.md` / `GEMINI.md` | Today's routes, gates and rules | Accurate for today. Their v2-deferred lists now say OTP login is planned here. | Rewritten at launch (§15) |
| `phone_verification_plan.md` | The live MSG91 verification (`send-otp` / `verify-otp`) | Accurate. Its status line said "Planning"; it now says live and points here. | Retires in Phase 5 |
| `redlotusfoods_documentation.md` | The v1 spec: email + Google, phone not unique (§4.7.9) | Accurate for today. §4.7.9 now notes D11. | Auth sections updated at launch |
| `phase1_customer_mvp_plan.md`, `phase1_ux_ui_design.md`, `phase4_stabilisation_plan.md` | Historical build plans | Historical | Not edited |
| `capacitor_native_apps_plan.md`, `play_store_launch_runbook.md`, `store-listing/listing.md` | The native Google return and the reviewer account | Accurate for today | Updated at launch (§9.3, §15) |
| `customer_app_ui_redesign_plan.md` §8.9 | The boundary with this plan | Accurate: this plan rebases if it ships second | This revision does that (§8) |
| `coupons_and_promo_codes_plan.md` §5.3 | Coupons keep `orders.customer_phone` after an account is deleted | Accurate | Constrains §14's `delete-account` item |

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
-- 034 once no installed bundle writes them (phone_otp_login_plan.md §10).
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
- **One OTP system, not two.** The existing pieces are reused wherever they can be: the MSG91 account, the DLT header and template, and both secrets. What can't be reused is the code check. MSG91 checks today's codes, and only Supabase Auth can turn a correct code into a session. An Edge Function that checked the code itself could sign the customer in only through a workaround: a made-up email plus a magic link, a throwaway password, or a hand-made JWT with no refresh token. So Supabase Auth generates and checks the code, and MSG91 delivers it. `send-otp` / `verify-otp` keep serving installed bundles until Phase 5, then are deleted.

### 3.3 Platform facts this plan relies on

Verified on 2026-09-25 and re-checked on 2026-11-12 against the Supabase docs and the Auth server source (§16). If months pass before Phase 1, re-check the starred rows:

| Fact | Consequence here |
|---|---|
| ★ The hook payload is `{ metadata, user, sms }`. `sms.otp` is the code, and `sms.phone` is the **number to text** (the *new* number during a phone change). `metadata.ip_address` is the client IP. **The public docs still show only `user` and `sms.otp`;** the other fields are in the source (`v0hooks.go`). | The function texts `sms.phone`. The IP drives the per-IP cap; if it's ever missing, that cap is skipped (the SQL accepts a NULL IP). The function refuses (rather than guesses) if `sms.phone` is missing while a phone change is pending (§5.2). Check P5 confirms both fields arrive. |
| `user.phone` is stored as digits without `+` (`919876543210`). The docs' sample payload shows a `+`. | `public.mobile10()` and the hook's normaliser keep digits only, so both forms work. |
| Hook success is HTTP 200 with an empty body or `{}`. An error is HTTP 400+ with `{"error":{"http_code":…,"message":"…"}}`, and **the message reaches the client verbatim.** | Hook refusals carry stable prefixes (`PHONE_NOT_SUPPORTED:`, `OTP_LIMIT_REACHED:`, `SMS_SEND_FAILED:`), the same convention as `PRICING_MISMATCH:`. |
| HTTP hooks have a **5 s total budget**. Auth **retries 429 and 503** up to 3 times with a 2 s backoff *inside* that budget. | **Never return 429/503** from the hook. A retried refusal turns into `hook_timeout_after_retry`, and our message is lost. Refusals return 400; provider failures return 502. |
| ★ **The order of Auth's send step** (`sendPhoneConfirmation`): (1) the per-user resend window; (2) the test-number check; then, for real numbers only, (3) the project-wide SMS cap, (4) the code, (5) the hook. | The resend window applies to test numbers too. **The project-wide cap is spent before the hook runs**, so a request the hook refuses (a non-Indian number, a capped number or IP) still uses up one of the hour's sends. §9.1 deals with it. |
| The OTP length is 6–10 digits (default 6). The per-user resend window defaults to 60 s. The project-wide SMS cap defaults to **30/hour** and is **skipped entirely while phone confirmations are off** (§3.4). Verification is limited to 30 per 5 min per IP. | Set explicitly (§6). The OTP goes from today's 4 digits to 6, which the template's `{#var#}` accepts. |
| ★ Test phone numbers **skip SMS delivery** (the hook isn't called) and accept only their fixed code. They can carry a "valid until" date. **The docs say Auth still needs an SMS provider configured for them, and that placeholder credentials work.** | Used for the Play reviewer (D8) and on preview branches, where `config.toml` carries a placeholder provider (§6.2). |
| `verifyOtp` returns `otp_expired` for a **wrong**, an **expired** and an **already-used** code. | One message for all three (§8.6). |
| Every successful `sms` verification calls `ConfirmPhone` again, including routine returning logins. | The sync trigger's WHEN clause ignores those (§4.3). |
| ★ The admin API `updateUserById(id, { phone, phone_confirm: true })` **confirms first, then sets the number**, in one transaction, and creates or updates the **`phone` identity**. It does *not* check for duplicates: a number already on another user hits the unique index and comes back as a generic **500 "Error updating user"**. The customer-facing `updateUser({ phone })` does check, and returns `phone_exists`. | This is how existing customers are backfilled (§7). Production has `CREATE UNIQUE INDEX users_phone_key ON auth.users (phone)` (checked 2026-09-25), so a duplicate fails loudly instead of creating two accounts with one number. The backfill and the `verify-otp` dual write treat a 500 as a likely conflict. Duplicates must still be settled first. |
| The Send SMS hook and Before User Created hook are available on Free and Pro. | No plan dependency. |
| ★ On a merge to production, the GitHub integration applies **migrations, declared functions and storage only**: "All other configurations, including API, Auth, and seed files, are ignored by default." Config reaches production only through a `[remotes]` block naming the production project, or `supabase config push`. Preview branches *do* apply `[auth]`. | `config.toml` can carry branch-only test numbers. **Never add a `[remotes]` block for production and never run `supabase config push`:** either would copy the auth settings, test numbers included, to production. Production phone auth is configured in the Dashboard (§6.1). |

### 3.4 ⚠ "Enable phone confirmations" must be ON

This is the setting that makes or breaks the design. The CLI config default is **off** (`auth.sms.enable_confirmations = false`, i.e. "autoconfirm"), and the production project's current value is unknown, so set it explicitly. With it off, the auth server source shows three things:

1. **A new number is marked confirmed the moment an OTP is *requested*.** `signup.go` calls `ConfirmPhone` at sign-up, before any code is checked. Our sync trigger (§4) would then write `phone_verified = true` for a number nobody has proven they own. That user still can't sign in without the code, but the data would be wrong.
2. **The project-wide SMS cap is skipped entirely.** `phone.go` only applies the SMS limiter when autoconfirm is off, so the main defence against wallet-draining (§9) would silently do nothing.
3. **Changing a number needs no code at all.** In `user.go`, `updateUser({ phone })` under autoconfirm switches the number immediately. With confirmations ON, it texts the new number and waits for `verifyOtp(type 'phone_change')`. The Profile change flow (§8.10) and `/verify-phone` (§8.9) depend on this.

**Set it ON** in the Dashboard (Auth → Providers → Phone) and in `config.toml` for branches. Test B1 (§11.2) proves it: after an OTP request for a new number, `auth.users.phone_confirmed_at` must be `NULL`, and there must be **no** `public.users` row until the code is verified.

### 3.5 The flows

| Flow | What happens |
|---|---|
| **Opening RedLotus signed out** | Home sends the visitor to the login screen once per launch (D12, §8.2). **Skip** returns to Home and is remembered on that device for 7 days. Deep links (a shared menu, a coupon banner) open directly. |
| **New customer** | `signInWithOtp` creates an unconfirmed auth user and texts a code. `verifyOtp(type 'sms')` confirms the phone, and the trigger creates the `public.users` row (`phone_verified = true`, `auth_provider = 'phone'`, empty name). The name step saves `full_name`, then the customer goes to Home, or back to the screen that asked for the login (D14). |
| **Returning customer** | The number is found and a code is texted. `verifyOtp` returns the session for the **same user id**, so there's no name step. Then Home, or the screen that asked. |
| **Signed in without a name** (left during the name step) | The name gate shows the name step before any customer screen (§8.4). Nothing else is asked. |
| **Existing (pre-launch) customer** | Same as returning. The backfill (§7) attached their verified number to their existing auth user beforehand. |
| **Change number** (Profile) | `updateUser({ phone: new })` texts the **new** number. `verifyOtp(type 'phone_change')` swaps the number in `auth.users`, and the trigger mirrors it. From then on, the old number opens a new, empty account. |
| **Legacy session with no verified number** (signed in with email/Google before launch, never verified) | `/verify-phone` becomes "Add your mobile number". It uses the same `updateUser` + `phone_change` flow, which attaches the number to *this* account. |
| **Partner / admin** | `/partner/login` uses email + password (`signInWithPassword`), exactly as today. |
| **Delete account** | `delete-account` deletes the auth user (unchanged), which frees the number. Logging in with it later creates a fresh, empty account. |
| **Session revoked or ended** | supabase-js emits `SIGNED_OUT`. Protected screens send the customer to `/login?next=…`, tabs show `SignInPanel`, and the login screen shows at the next launch. `/login` never redirects anywhere without a session, so there's no loop. |

---

## 4. Database — migration 033

### 4.1 Identity model

| Field | Source of truth | Written by |
|---|---|---|
| `auth.users.phone`, `phone_confirmed_at` | **Supabase Auth** (the OTP proved it) | GoTrue only: OTP verify, phone change, the admin API |
| `public.users.phone` | Mirror: the 10-digit form of the confirmed auth phone | The trigger for OTP customers. Partners' phones stay admin-set, as today. |
| `public.users.phone_verified` | Mirror: `true` once the auth phone is confirmed | The trigger, plus the legacy `verify-otp` until Phase 5 |
| `public.users.full_name` | The customer | The name step and Profile (the only customer-writable column after 034) |
| `public.users.email` | Legacy / partners | Empty string for new customers, whose `auth.users.email` is NULL |
| `public.users.auth_provider` | Informational | Gains `'phone'` |

### 4.2 The SQL

```sql
-- ============================================================
-- 033_phone_otp_login.sql
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

-- Pure and reads no data, but kept off the API all the same (023: explicit
-- grants). The SECURITY DEFINER triggers below call it as their owner.
REVOKE EXECUTE ON FUNCTION public.mobile10(text) FROM PUBLIC, anon, authenticated;

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

-- ── 6. Server-side "verified phone" check for every order
-- Nothing on the server checks phone_verified for an order today: 025
-- dropped orders_customer_insert (the only policy that did), and
-- place_order checks name + phone but not verification (coupons check it
-- only when a code is used). ProtectedRoute is the only gate. A BEFORE
-- INSERT trigger fires on every path, place_order included.
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
- **The trigger's WHEN clause (step 3)** fires on a first confirmation (`OLD.phone_confirmed_at IS NULL`) and on a number change. Auth re-confirms the phone on every `sms` login (§3.3), but that changes neither, so routine returning logins don't fire it. The admin backfill confirms first and sets the number second, in two UPDATEs. The first fires the trigger, which returns at once because the number is still empty. The second fires it through the number-changed branch and mirrors the number. B9 and `033_e2e.sql` prove it.
- **Why the bypass flag is safe (step 4).** Without the flag, the 005 rule "phone changed ⇒ `phone_verified := false`" would undo the sync's own write. The flag is a custom, transaction-local setting (`set_config(..., true)`). PostgREST gives clients no way to run `SET` or `set_config` in the same transaction as their UPDATE. Also, once 034 ships customers can't write `phone` or `phone_verified` at all. Until then 024 still allows it for installed bundles, and the 005 rules apply to those writes.
- **What the limiter protects (step 5).** It's a guard against SMS bombing and wallet-draining, not a correctness rule, so the hook **fails open** if the database call errors (the project-wide cap still applies). The advisory lock makes the per-number check exact. Phones are kept for 48 h at most, and `sms_otp_log` is readable only by service_role.
- **The order trigger (step 6)** changes nothing for honest clients: every customer who reaches checkout is already verified. It closes the gap for pre-launch sessions that never verified a number. Checkout maps `PHONE_NOT_VERIFIED:` to a redirect to `/verify-phone` (§8.6). **Two test scripts rely on the old behaviour.** `supabase/ops/030_e2e.sql` and `032_e2e.sql` insert orders for customers they never verify (they only set roles). The 033 PR marks those customers verified, the way 027–029's scripts already do (`UPDATE public.users SET phone_verified = true …`). Otherwise both scripts fail on every new preview branch.
- **Hygiene.** `claim_sms_otp_slot` is `SECURITY INVOKER` and executable only by service_role, following the Supabase guidance on public-schema functions. `mobile10` is pure, but its EXECUTE is revoked from the API roles too. Trigger functions can't be called over RPC, and `handle_new_user`'s existing permissions aren't touched. No RLS policy changes in this build.
- **One number, one account (D11).** The login identity lives in `auth.users`, whose `phone` is unique (`users_phone_key`). `public.users.phone` stays a non-unique mirror on purpose:
  - legacy duplicates are settled with the customer (§7.4);
  - partners' numbers are set by Ankit and may match a customer's;
  - deleted accounts keep `''`.

  Two simultaneous sign-ups for one new number end with one auth user: the second insert hits the unique index, and its retry finds the first user. Profile creation is idempotent (`ON CONFLICT (id)`). B20 tests it.

### 4.4 Verify and roll back

- `supabase/ops/033_verify.sql` is a single `UNION ALL` query that checks:
  - `on_auth_user_phone_confirmed` and `orders_require_verified_phone` exist.
  - `pg_get_functiondef` of `handle_new_user` contains `phone_confirmed_at`, and that of `reset_phone_verified` contains `redlotus.phone_sync`.
  - RLS is on for `sms_otp_log`, and `anon` / `authenticated` have no privilege on it.
  - `anon` / `authenticated` can't EXECUTE `claim_sms_otp_slot`.
  - `mobile10('+91 98765-43210') = '9876543210'` and `mobile10('447700900123') IS NULL`.
- `supabase/ops/033_rollback.sql` does the following:
  - Restores the 002 `handle_new_user` and the 005 `reset_phone_verified` bodies verbatim.
  - Drops both new triggers and their functions, `claim_sms_otp_slot` and `sms_otp_log`.
  - Drops `mobile10` last.
- `supabase/ops/033_e2e.sql` runs on a preview branch only, as one transaction that is never committed (the 027–032 pattern). It plays Auth's writes on `auth.users` and checks the results:
  - an unconfirmed phone sign-up gets no profile, and confirming it creates one;
  - the admin order (confirm, then set) mirrors the number;
  - a number change re-mirrors it, and a returning login's re-confirm changes nothing;
  - an email sign-up behaves exactly as before;
  - an unverified customer's order raises `PHONE_NOT_VERIFIED:`.

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
  const payload = verifyOrNull(await req.text(), req.headers); // new Webhook(secret minus "v1,whsec_").verify(...)
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

- `supabase/config.toml` gets a `[functions.auth-send-sms]` block with `verify_jwt = false` and a comment. A merge then deploys the function to production (the GitHub integration deploys declared functions), and nobody has to remember `--no-verify-jwt` (the `send-push` lesson). The same PR rewrites the file's header comment, which says auth is managed only in the Dashboard. That stays true for production, but branches now apply the `[auth.sms]` block (§6.2).
- Secrets: `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID` already exist. Add `SEND_SMS_HOOK_SECRET`: copy it from Dashboard → Auth → Hooks when you create the hook, and set it with `supabase secrets set`, not through a PowerShell pipe (the BOM trap). The two cap values are optional env vars with defaults.
- The hook itself (Dashboard → Authentication → Hooks → Send SMS → HTTPS → `https://umsqskeqmwbmvrfvyrbl.supabase.co/functions/v1/auth-send-sms`) is **configured by hand in production**. `config.toml`'s `[auth.hook.*]` is ignored there.

### 5.5 What it logs

One structured line per call: outcome, the phone masked to its last 3 digits, the IP, whether `sms.phone` and `metadata.ip_address` arrived (§3.3), MSG91's `type` / `request_id` and the time taken. **The OTP is never logged.** Refusals and provider failures are `console.error`, so they show up in Edge Function logs.

---

## 6. Supabase Auth configuration

### 6.1 Production (Dashboard), in this order

Set the rate limits and the hook **before** the Phone provider goes on. The moment it's on, `/auth/v1/otp` is public (§10, Phase 1).

| # | Where | Setting | Value | Why |
|---|---|---|---|---|
| 1 | Auth → Rate Limits | SMS messages per hour (project-wide) | **60** (default 30) | D7. 30/hour could block real logins at a dinner-rush spike. 60 caps abuse at about ₹12/hour. |
| 2 | Auth → Rate Limits / Phone | Per-user resend window (`sms_max_frequency`) | **30 s** | Matches the UI's countdown and MSG91 (§5.3). If the Dashboard doesn't show it, set it through the Management API's auth config. The UI copes either way: a "wait N seconds" reply restarts the countdown at N. |
| 3 | Auth → Rate Limits | Token verifications | keep **30 per 5 min per IP** | Enough for honest retries; blocks code guessing. |
| 4 | Auth → Hooks | Send SMS (HTTPS) | the `auth-send-sms` URL + a generated secret | §5.4. Set the secret as `SEND_SMS_HOOK_SECRET` first. |
| 5 | Auth → Providers → Phone | Enable phone confirmations | **ON** | **§3.4 — required.** |
| 6 | (same panel) | SMS OTP expiry | **300 s** | The approved DLT text says "Valid for 5 minutes". |
| 7 | (same panel) | SMS OTP length | **6** | Supabase's minimum. The template's `{#var#}` accepts it. |
| 8 | (same panel) | Test phone numbers + OTPs | **`919460049608`** (D8) → a random 6-digit code, valid until +12 months | Play review (§9.3). Run §7.2's D8 check first. Not `123456`. The code goes only into this field and Play Console's App access notes, never into the repo. Calendar the expiry. |
| 9 | (same panel) | **Enable Phone provider** | **ON, in the same save as 5–8** | The panel saves its fields together. If it insists on SMS-provider credentials although the hook is on, enter placeholders: the hook replaces built-in sending (§3.3). |
| — | Auth → Providers → Email | unchanged (ON) | | Partners and admin still use it. |
| — | Auth → Providers → Google | stays ON until Phase 5 | | Installed bundles still offer it (D9). |
| — | Auth → Sign In / Up | Allow new users to sign up | must stay ON | It's global. Turning it off blocks phone sign-ups too. |
| — | Auth → Attack Protection | CAPTCHA | **off** | Not an emergency switch: turning it on without client support locks everyone out (§9.1). |

### 6.2 Preview branches (`config.toml`)

Production ignores these on merge (§3.3). Branches apply them.

```toml
[functions.auth-send-sms]
# Supabase Auth "Send SMS" hook (phone-OTP login → MSG91). Called by Auth
# with a Standard Webhooks signature, never with a user JWT.
verify_jwt = false

# ── Auth — applied to PREVIEW BRANCHES only. The GitHub integration ignores
# [auth] on the production merge; production phone auth lives in the
# Dashboard (phone_otp_login_plan.md §6.1). NEVER add a [remotes] block for
# production and NEVER run `supabase config push`: either copies this
# section, test numbers included, to production.
[auth.sms]
enable_signup = true
enable_confirmations = true   # REQUIRED — false confirms the phone before the OTP is checked (plan §3.4)
max_frequency = "30s"

# Auth needs an SMS provider configured even for test numbers, and doesn't
# use its credentials for them (Supabase docs, "Testing auth flows"). These
# are placeholders: a real number typed on a branch fails to send, by design.
[auth.sms.twilio]
enabled = true
account_sid = "placeholder"
message_service_sid = "placeholder"
auth_token = "placeholder"

[auth.sms.test_otp]
919999900001 = "123456"   # branch test customer
919999900002 = "123456"   # branch phone-change target
```

On branches, test numbers skip the hook, so no MSG91 secrets are needed there. To test real SMS on a branch, configure the hook in that branch's Dashboard and set its three secrets (branches don't inherit secrets). The hook replaces the placeholder provider.

After the first push, check the branch's Auth settings once. The docs say the branch copies the base project's settings, applies `config.toml` on top, and lets the file win where the two differ. They don't say what happens to auth settings a partial `[auth]` block leaves out. Also update the file's header comment, which says auth is managed only in the Dashboard (§5.4).

---

## 7. Existing accounts

### 7.1 Who is affected and how

The rule: no account is merged because of a matching name or an unverified number, and nobody's history is lost. A number is attached to an existing account only in two cases. Either that account already proved it owns the number (an OTP through `send-otp` / `verify-otp`), or its signed-in owner proves it again (§8.9).

| Account today | After launch | Needs the customer to confirm? |
|---|---|---|
| Customer with a **verified phone**, whether they signed up by email or Google (every customer who has ordered) | Backfilled (§7.3). Typing the number opens the **same account**: same user id, orders, reviews, addresses and coupons. Their existing session also keeps working. | No: they proved the number with an OTP before. |
| Customer, **never verified**, still signed in on a device | Keeps working. Checkout sends them to "Add your mobile number" (§8.9), which proves the number with a code and attaches it to **this** account. | Yes: the code they enter is the confirmation. |
| Customer, **never verified**, signed out | Can't be matched: there's no proven number. Logging in with a number creates a new account. **Nothing is lost.** Ordering always required a verified phone, so these accounts have no orders, reviews or saved addresses (§7.2 checks). The old account stays, unused. | Only if they ask for it back (rare; nothing to recover). They sign in to the old account at `/partner/login`, and a Google-only account sets a password with "Forgot password?" first. Then they add their number there (§8.9). |
| A verified number on **two or more** accounts (a shared family phone) | Not backfilled automatically. Settled before launch (§7.4). | Yes (§7.4). |
| Partner / admin | No change. Email + password at `/partner/login`. Never given an auth phone (§9.2). | — |
| Play reviewer account (email) | Replaced by the D8 test number (§9.3). | — |

### 7.2 Sizing (counts only, no personal data)

`supabase/ops/033_sizing.sql` works before and after 033 and is safe on production:

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
     AND (EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = c.id)
          OR EXISTS (SELECT 1 FROM public.delivery_addresses a
                      WHERE a.user_id = c.id)))                       AS unverified_with_history,
  (SELECT count(*) FROM c WHERE m = '9460049608')                     AS d8_customer_accounts,
  (SELECT count(*) FROM public.users u WHERE u.role <> 'customer'
     AND right(regexp_replace(u.phone, '\D', '', 'g'), 10) = '9460049608') AS d8_partner_accounts,
  (SELECT count(*) FROM public.restaurants r
    WHERE right(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g'), 10) = '9460049608') AS d8_restaurant_lines,
  (SELECT count(*) FROM auth.users a WHERE a.phone IS NOT NULL)       AS auth_users_with_phone
FROM c;
```

`unverified_with_history` should be 0. Run it at the start of Phase 2 and paste the numbers into this section.

**The D8 number.** `+91 94600 49608` is RedLotus's support line, so it may already be on an account: a test account verified with it, or someone's own. The fixed code opens whatever account holds the number after the backfill, for the Play reviewer and for anyone else who learns the code. So before step 8 of §6.1:

- `d8_customer_accounts = 0`: the first login with the fixed code creates the reviewer account. Give it the name "Play Reviewer".
- `= 1`: check in the Dashboard that it's a dedicated test account, with no real orders and no home address. If it's anyone's own account, move the number off it first (Dashboard user editor) and let the first fixed-code login create a fresh one.
- `≥ 2`: settle it as in §7.4, in favour of a dedicated reviewer account.
- `d8_partner_accounts` or `d8_restaurant_lines` above 0: the 026 guard treats the reviewer as that restaurant's own line. Reviews and coupons are refused; ordering still works. Fine for review, but know it.

### 7.3 The backfill

`supabase/ops/033_backfill_customer_phones.mjs` is a Node script run by Ankit. It is a dry run by default; `--live` writes.

1. Read `public.users` where `role = 'customer' AND phone_verified`, using the service-role key. Pass it as a shell env var only (`$env:SUPABASE_SERVICE_ROLE_KEY = '…'`), never in a file, never committed.
2. Normalise each number with the same rule as `mobile10()`. Count and skip anything that doesn't parse.
3. Group by number. **Any number held by 2+ accounts is a conflict**; skip the whole group and list it.
4. List auth users (`auth.admin.listUsers`, paginated):
   - Skip anyone whose auth phone already equals the target (makes the script safe to re-run).
   - Count a conflict if the target number is already another auth user's phone.
   - Skip profiles with no auth user.
5. `--live`: call `auth.admin.updateUserById(id, { phone: '91' + m, phone_confirm: true })` one user at a time, about 100 ms apart. Auth confirms the phone, sets it and creates the `phone` identity (§3.3), and the 033 trigger re-mirrors the same number with no change. **A 500 "Error updating user" usually means the number is already on another auth user:** the API doesn't check duplicates and the unique index refuses them. List it with the conflicts; don't retry it.
6. Print totals (eligible / attached / skipped / conflicts / failed). Save the conflict list to a scratch file, with numbers masked to the last 3 digits plus user ids.

Use the Admin API, never SQL on `auth.users`: the API creates the identity row that GoTrue expects.

### 7.4 Numbers on two or more accounts

Expect 0–3 cases at current scale; the sizing query says. Each needs the customer's choice: both accounts proved the same SIM, and picking one decides whose history that SIM opens.

1. Ankit messages the number on WhatsApp. Both accounts share it, so one message reaches them. Ask which account the number should log into, describing each by its name and number of orders, nothing else.
2. Attach the number to the chosen account with `--attach <user_id>`. If there's no answer before launch, attach it to the account with the most recent order and note it here. The choice can be moved later by hand (Dashboard user editor).
3. The other accounts keep working in sessions already open, and through `/partner/login` if they have a password. Their order rows stay intact for settlement and remain visible to support. Merging order history is a manual support task (§13).

### 7.5 Stragglers during the transition

Until Phase 5, installed apps can still verify phones through the **old** `verify-otp`. Without a change, those customers would be verified in `public.users` but have no auth phone, so their next OTP login would create a **second** account. So in Phase 1, `verify-otp` gets a **dual write**: after flipping `phone_verified`, it also calls `updateUserById(user.id, { phone: '91' + phone, phone_confirm: true })`. If that fails, it logs `[verify-otp] could not attach the number` with the status and carries on, since today's behaviour must not regress. The usual cause is the number being on another auth user, which comes back as a generic 500 (§3.3). Re-running the backfill weekly until Phase 5 catches anything that slipped through.

---

## 8. Frontend

The redesign (live 2026-10-06) left the auth screens to this plan (its §8.9) and gave it the tools to build them:

- the tokens in `src/styles/`;
- the primitives in `src/components/ui/` (`Button`, `IconButton`, `InlineNotice`, `Sheet`, `Dialog`, …);
- `lib/backStack.ts` for Android back;
- `SignInPanel` for the logged-out tabs.

Everything below builds on them. Auth screens render outside `CustomerShell`, so they have no bottom nav.

### 8.1 Routes

| Route | Today | After |
|---|---|---|
| `/` (Home) | The storefront for everyone; owners → `/dashboard` | Unchanged, plus the **launch gate** (§8.2): a signed-out visitor opening RedLotus here sees `/login` first |
| `/login` | Email + password + Google (`Login.tsx`) | **The one customer entry point**: phone → code → name (rewritten `Login.tsx`, §8.3) |
| `/partner/login` | — | **New**: email + password for partners and admin (`PartnerLogin.tsx`, §8.8) |
| `/signup` | `Signup.tsx` | `<Navigate to="/login" replace />` so old links keep working. The component and its CSS are deleted. |
| `/auth/callback` | Recovery + Google + email-confirm routing | Kept for **partner password recovery**. The Google `/profile?setup=true` gate is removed, and the 8 s timeout goes to `/partner/login`. |
| `/reset-password` | Customers + partners | Partners only. Its three "back to login" links go to `/partner/login`. |
| `/verify-phone` | MSG91 `send-otp` / `verify-otp` | **"Add your mobile number"** for legacy sessions (§8.9) |
| `/restaurants/:id` | Public (redesign D4) | Unchanged |
| `/orders`, `/profile` (tabs) | Logged out: `SignInPanel` with "Log in" → `/login` and "Create an account" → `/signup` | One button, "Log in" → `/login?next=<tab>` |
| `/coupons` (tab) | Public; "Log in" → `/login`; "Verify" → `/verify-phone` | The same links, with `next=/coupons` |
| `/checkout`, `/orders/:id`, `/orders/:id/review`, `/profile/addresses` | `<ProtectedRoute>` → `/login` with no return path | `<ProtectedRoute>` → `/login?next=<path>` (§8.7) |
| `/dashboard*` | `<ProtectedRoute role="owner">` → `/login` | → `/partner/login?next=<path>` |

### 8.2 The launch screen (D12)

The Zomato pattern: a signed-out visitor who opens RedLotus sees the login screen first, and can skip it.

- **Where:** `DiscoveryPage` (Home) runs the gate on its first render of each launch. It replaces itself with `/login?launch=1` (`navigate(…, { replace: true })`), so Android back from the login screen minimises the app, as it does on Home.
- **When:** `shouldShowLaunchLogin()` (pure, in `phoneAuth.ts`) returns true only when all of these hold:
  - auth has finished loading, and there's no session;
  - the launch started at `/`, not at a deep link;
  - this is Home's first render since the launch (a module-level flag, reset by a cold start or a full page load);
  - Skip wasn't pressed on this device in the last 7 days.
- **Never** for:
  - a deep link (a shared menu, `/coupons?apply=…`, `/search`);
  - a signed-in visitor (a signed-in owner is already sent to `/dashboard`);
  - Home reached by in-app navigation.

  On Android the gate waits for NativeBridge's launch-URL check, so an App Link cold start goes straight to its page.
- **Skip**, a text button at the top right, returns to Home. It sets `localStorage["redlotus_login_skip_at"]` inside try/catch, which hides the screen for 7 days on that device; a private window just sees the screen again. Signing out clears it, so the first launch after a sign-out shows the screen.
- **Look:** a brand panel above the phone step (§8.3): the RedLotus wordmark on brand red and "Fresh food from local kitchens, every day.", today's login tagline. From 1024 px the panel sits beside the form, as on today's login page. RedLotus's own type, colours and assets throughout; nothing is borrowed from Zomato.
- **First launch on Android:** splash → this screen → Home → the location disclosure and the OS prompt, exactly as today. Nothing else is asked before browsing.
- **Partners** see the same screen and use its partner link.

### 8.3 `/login` — one screen for logging in and signing up

Three steps in one component: `phone → code → name`. There's no choice between logging in and signing up anywhere: the number decides.

- **Phone step**
  - Title "Log in or sign up". Subtitle "Enter your mobile number. We'll text you a 6-digit code."
  - A fixed `🇮🇳 +91` chip (D13), then a 10-digit field: `type="tel"`, `inputMode="numeric"`, `autoComplete="tel-national"`, 16 px text so iOS doesn't zoom.
  - Pasting `+91 98765-43210`, `09876543210` or `919876543210` is normalised. Until the field holds a 10-digit number starting 6–9, **Continue** stays disabled, with "Enter a valid 10-digit mobile number" once the customer has typed 10 digits.
  - **Continue**: the primary `Button`, full width, busy while the request runs.
  - Consent line: "By continuing you agree to our Terms and Privacy Policy." Links: WhatsApp help (`WHATSAPP_CUSTOMER_HELP`, D10), and "Restaurant partner? Log in with email" → `/partner/login`.
  - Calls `supabase.auth.signInWithOtp({ phone: '+91' + n, options: { shouldCreateUser: true, channel: 'sms' } })`.
- **Code step**
  - "Enter the 6-digit code sent to **+91 98765 43210** · Change".
  - One field (`inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength={6}`). Not six boxes: one field pastes cleanly and works with screen readers. It **submits itself on the 6th digit**.
  - "Didn't get it? Resend in 0:30", then **Resend code** (repeats `signInWithOtp`). After a resend, show "Use the newest code — older ones stop working."
  - Calls `supabase.auth.verifyOtp({ phone: '+91' + n, token, type: 'sms' })`.
- **Name step** (only when the profile's `full_name` is empty)
  - "What's your name?" / "The restaurant and rider see this on your order."
  - Sanitised first: trim, collapse runs of spaces, strip control characters. Then required, 2–60 characters, with at least one letter in any script (`/\p{L}/u`), so Devanagari names work.
  - **Continue** saves `supabase.from('users').update({ full_name }).eq('id', userId)`, a column the 024 grant allows.
  - "Not you? Log out" under the button, for a shared phone.
- **Done.** Go to `loginDestination(next, profile)` (D14): `safeNextPath(next)` when a screen asked for the login, otherwise Home. Owners go to `/dashboard`, admin to `/`.
- **Already signed in when `/login` opens** (a stale tab, the browser's back button): with a name, straight to the destination; without one, the name step. `/login` never shows the phone step to someone signed in.

Implementation notes:

- **Right after `verifyOtp`, read the profile row using the returned `data.user.id`.** Don't use `refreshProfile()`: `AuthContext` sets its session in the async `onAuthStateChange`, so at that moment `refreshProfile` may still see no session. The trigger created the row inside the verify transaction, so it's already there. Call `refreshProfile()` after saving the name.
- **Save the pending step** in `localStorage["redlotus_otp_pending"] = { phone, sentAt }`, with a 10-minute lifetime, wrapped in try/catch. Restore it on mount, with the countdown worked out again from `sentAt`. This covers a browser refresh, and Capgo's `directUpdate: true` reloading the WebView when the customer comes back from reading the SMS. Without it they'd land on step 1 again and waste an SMS. Clear it on success, on "Change", and in `AuthContext.signOut` (shared phones).
- **Block double-submits** while a call is in flight; that's also what stops a double-tapped Continue from sending two SMS. On a wrong code, clear the field and refocus it.

### 8.4 The name gate

D3 makes the name required. Without a gate, a customer who enters the code and closes the app before the name step stays signed in with no name. Nothing today would catch that until Place order failed with "Profile incomplete — full_name and phone are required…".

- `CustomerShell` checks `needsNameStep(profile)`, a pure function in `phoneAuth.ts`: role `customer` and an empty trimmed `full_name`. When it's true, the shell redirects to `/login?step=name&next=<current path>`.
- It acts only once the profile has loaded. A slow or failed profile fetch never redirects.
- The name step saves, calls `refreshProfile()`, then goes to `next`. `/login` sits outside the shell, so there's no loop.
- Checkout also maps `Profile incomplete` from `place_order` to the name step, in case an old tab skipped the gate.

### 8.5 Shared pieces

- **`src/components/auth/PhoneOtpForm.tsx`** is the one OTP UI: phone field, code field, resend timer and error area, built on `Button`, `InlineNotice` and the tokens. It has three modes:
  - `login`: `signInWithOtp` + `verifyOtp('sms')`.
  - `link`: `updateUser({ phone })` + `verifyOtp('phone_change')`.
  - `change`: same as `link`, but refuses the current number ("That's already your number").
- **`src/lib/phoneAuth.ts`** holds the pure functions, all tested (§11.1):
  - `normaliseIndianMobile(input) → string | null`
  - `toE164(m) → '+91' + m`
  - `formatMobile(m) → '+91 98765 43210'`
  - `otpDigits(input)` keeps digits only, at most 6
  - `sanitiseName(input)` and `nameError(name) → string | null`
  - `safeNextPath(raw)` (§8.7) and `loginDestination(next, profile)` (D14)
  - `shouldShowLaunchLogin(state)` (§8.2) and `needsNameStep(profile)` (§8.4)
  - `describePhoneAuthError(err) → { kind, message, retryAfterSeconds? }` (§8.6)
  - `OTP_LENGTH = 6`, `RESEND_SECONDS = 30`, `LAUNCH_SKIP_DAYS = 7`

### 8.6 Error copy

Match hook messages by their prefix first: hook errors may arrive without an error `code`, but the message always comes through verbatim (§3.3). Then match on `AuthApiError.code`.

| Signal | Meaning | Copy |
|---|---|---|
| `over_sms_send_rate_limit` + "after N seconds" | Asked again too soon | "Please wait N seconds before asking for a new code." Also restart the countdown at N. |
| `over_sms_send_rate_limit` (no seconds) | Project-wide SMS cap reached | "We're sending a lot of codes right now. Please try again in a few minutes." |
| `OTP_LIMIT_REACHED:` | Per-number / per-IP cap (hook) | "Too many codes for this number today. Message us on WhatsApp and we'll help you log in." |
| `PHONE_NOT_SUPPORTED:`, `validation_failed` | Not an Indian mobile | "Enter a valid 10-digit Indian mobile number." |
| `otp_expired` | A wrong, expired or already-used code (Supabase uses one error for all three) | "That code didn't work. Check it, or tap Resend for a new one." |
| `SMS_SEND_FAILED:`, `sms_send_failed`, `hook_timeout`, `hook_timeout_after_retry` | Delivery failed | "We couldn't send the SMS right now. Please try again in a minute." |
| `phone_exists` | Number is on another account (link / change) | "This number already has a RedLotus account. Log out, then log in with this number." (with a **Log out** button) |
| `over_request_rate_limit` | Too many code checks from this network | "Too many attempts. Please wait a few minutes and try again." |
| `PHONE_NOT_VERIFIED:` (from `place_order`) | Legacy unverified session at checkout | Redirect to `/verify-phone?next=/checkout` |
| `Profile incomplete` (from `place_order`) | Signed in with no name | Redirect to `/login?step=name&next=/checkout` |
| Network failure | Offline | "Connection problem — check your internet and try again." |
| Anything else | | Generic copy, and log via `console.error("[phone-auth]", err)` |

### 8.7 Returning to where the customer was

- **`ProtectedRoute`** redirects to `/login?next=${encodeURIComponent(pathname + search)}`. For `role="owner"` it uses `/partner/login?next=…`, and when the phone check fails, `/verify-phone?next=…`.
- **Other entry points:**
  - `SignInPanel` takes the tab's path as `next` and drops its "Create an account" button: one entry point.
  - `AppHeader`'s "Log in" button passes the current path.
  - `CouponsPage`'s "Log in" and "Verify" links pass `/coupons`.
  - On the marketing pages, `Navbar` and `FooterCTA` drop "Sign up", and their "Log in" goes to `/login`.
- `safeNextPath(raw)` guards against redirects to other sites. It accepts only strings that start with `/`, not `//` or `/\`, and aren't `/login`, `/partner/login`, `/verify-phone` or `/auth/…`, up to 512 characters. Anything else falls back to Home.
- **The cart survives the login redirect** (`localStorage["redlotus_cart"]`, CartContext), so `next=/checkout` brings the customer back to a full cart. A pending coupon from `?apply=` survives too (`couponStorage`).
- **Ended or revoked sessions** follow the same rules. supabase-js emits `SIGNED_OUT` and `AuthContext` clears. Protected screens then go to `/login?next=…`, and tabs show `SignInPanel`.

### 8.8 `/partner/login`

This is today's `Login.tsx` form (`signInWithPassword`), minus:

- the Google button and hint;
- the "Create an account" link;
- the email probe (`.from("users").select("auth_provider").eq("email", …)`). It could never have worked: RLS lets an anonymous visitor read no `users` rows at all.

It keeps "Forgot password?" → `/reset-password`. Title: "Restaurant partner login". After sign-in: owner → `/dashboard`, admin → `/`, anyone else → `safeNextPath(next)`. It links back with "Ordering food? Log in with your mobile number" → `/login`. `ResetPassword.tsx`'s three links back to login, and `AuthCallback`'s timeout, point here. The partner onboarding checklist (`capacitor_native_apps_plan.md` §11.4) gains "Log in at **Restaurant partner login**".

### 8.9 `/verify-phone` — "Add your mobile number"

This is for legacy sessions only; new customers never see it. It uses `PhoneOtpForm` in `link` mode. Copy: "Add your mobile number — we'll use it to log you in next time and to call you about deliveries." On success it calls `refreshProfile()` and goes to `safeNextPath(next)`. It replaces the MSG91 calls in today's `VerifyPhone.tsx`. `CouponsPage` sends legacy customers here from a coupon that needs a verified phone (`?next=/coupons`). Keep the route until the analytics show no legacy sessions left, then delete it.

### 8.10 Profile

Today, after the redesign: `ProfileHeader` shows the name, then the phone with "Verified" / "Not verified", then the email when there is one (it already hides an empty email). The name and phone form sits behind **Edit**, and is always open in `?setup=true`.

- **Customers**
  - **Edit** keeps the name only, and `handleSave` writes `full_name` only.
  - The number is read-only, with a **Change** button that opens `PhoneOtpForm` in `change` mode, in a `Sheet`. On success, `refreshProfile()` and show "Number updated".
  - Remove the `?setup=true` Google banner and the form's email field. Legacy emails still show in `ProfileHeader`.
- **Partners / admin**
  - Name is editable.
  - Phone is read-only with "Contact RedLotus to change your number". Partner numbers are managed by Ankit (D1).

### 8.11 Edits and deletions

- **Delete:**
  - `src/pages/login-signup/Signup.tsx` and `Signup.css`.
  - `src/lib/googleAuth.ts`.
  - `NativeBridge`'s custom-scheme OAuth return: the `NATIVE_OAUTH_REDIRECT` handling in `getLaunchUrl` / `appUrlOpen`, and `routeToLoginWithError`.

  The `in.redlotusfoods.app://auth/callback` intent filter in `AndroidManifest.xml` stays until the next store build; it's harmless.
- **`AuthCallback.tsx`:** keep recovery routing (`/reset-password?mode=update`) and role routing. Drop the Google phone gate. The timeout goes to `/partner/login`.
- **`navigation.ts`:** drop the `?setup=true` clause from `shouldShowBottomNav`, and its test. `/login` and `/partner/login` stay outside the shell.
- **`AuthContext.tsx`:** `auth_provider` gains `'phone'` (it's typed as `string`, so nothing breaks), and `email` may be `''`. `signOut` also clears `redlotus_otp_pending` and `redlotus_login_skip_at`.
- **`src/types/database.ts`:** regenerate for `sms_otp_log` / `claim_sms_otp_slot` / `mobile10`. Use `npx supabase gen types typescript --linked`, since Docker isn't installed for `--local`. On Windows, redirect with `Out-File -Encoding utf8` or use Git Bash, because PowerShell 5.1's `>` writes UTF-16.

### 8.12 Android app and PWA

- **Ships by OTA:** web code only. No plugin, permission or `android/` change is needed (Capgo's safe harbour, plan §5.4).
- **Leaving to read the SMS and coming back** keeps React state. The saved pending step (§8.3) covers a Capgo reload on the way back.
- **Hardware back** (`lib/backStack.ts`, `pushBackHandler`):
  - on the code step, back returns to the phone step;
  - on the name step, back does nothing: the name is required, and "Not you? Log out" is the way out;
  - on the phone step, back follows `decideBackAction`, which minimises the app when `/login` is the launch screen.
- The on-screen keyboard is numeric on both number steps. The code field keeps focus after a failed attempt.
- Nothing changes in `supabaseClient.ts`. The native Keystore session storage and PKCE setting keep working, because `verifyOtp` returns the session directly.
- **PWA:** `/login` and `/partner/login` are ordinary routes the service worker serves through `navigateFallback`; its `/auth/*` denylist is unchanged. An installed PWA starts at `/` (`start_url`), so it gets the launch screen like the app.

### 8.13 Copy and accessibility rules

- Short, plain English with no jargon. Say "code" in body text. The buttons say **Continue** and **Resend code**.
- Hindi labels are §13.
- Every field has a real `<label>`. Errors sit in an `aria-live="polite"` region. Tap targets meet `--rl-size-touch-min` (44 px). The countdown is announced politely, not every second.
- Brand red for actions only (Continue, Resend code), with the tokens' contrast rules: brand text on the brand tint uses `brand-pressed`.
- Never say "app", "download" or "install" (CLAUDE.md product rule).

---

## 9. Abuse, security and privacy

### 9.1 Threats and controls

| Threat | Control |
|---|---|
| **Wallet-draining** (a script requesting codes for thousands of random numbers) | A project-wide cap of 60/hour (D7), which only works with confirmations ON (§3.4). A per-IP cap of 20/hour and a per-number cap of 10/day (hook). MSG91 wallet balance and a low-balance alert. Worst case about ₹12/hour. |
| **Login lock-out** (the same script, aimed at availability) | Auth spends a project-wide send *before* calling the hook (§3.3), so even requests the hook refuses count against the cap. About 60 requests an hour from anywhere block new logins for the rest of that hour. Signed-in customers aren't affected, because sessions last until sign-out. **Detect:** `over_sms_send_rate_limit` in the auth logs (§12). **Respond within minutes:** raise the cap while the attack lasts (each extra 60/hour costs at most ₹12/hour), or lower it if the wallet is the target. **Respond within a day:** CAPTCHA (next row). |
| **CAPTCHA** (Turnstile) | **Not an instant switch.** Once on, Supabase requires a captcha token on every sign-in call: the new `/login`, `/partner/login`'s password login, and every installed bundle older than the one that adds the widget. Turning it on without client support locks everyone out. Adding it takes a client change to both screens, an OTA, and waiting for adoption. It can't go on before Phase 5, because old bundles would lose their login. §13 has the steps. |
| **SMS bombing** (flooding one victim's phone through our endpoint, a common abuse of public OTP forms in India) | The per-number cap of 10 per 24 h (hook), plus the 30 s per-user resend window. |
| **Code guessing** | 6 digits (a million possibilities), a 5-minute expiry, each new code replacing the old one, and verification limited to 30 per 5 min per IP. Even odds of guessing one code within its 5 minutes would take about 17,000 IPs. The per-number cap limits how many codes there are to guess (10 a day). |
| **Guessing the D8 fixed code** | The reviewer number is public (it's the support line) and its code doesn't change, so a slow guess from many IPs could find it over days. The account behind it is a dedicated reviewer account with no real data (§7.2), and the code is random. Rotate it at each store release, and change it at once if the account shows orders nobody expected. |
| **Fake hook calls** | Standard Webhooks signature check with `SEND_SMS_HOOK_SECRET`. Unsigned requests are refused before anything is read. |
| **Texting the wrong number** during a phone change | `sms.phone` is the only trusted destination. The fallback to `user.phone` refuses whenever a change is pending (§5.2). |
| **Unverified numbers in the profile table** | Confirmations ON, profile creation only on confirmation (§4.2), and a hook refusal rolls back the sign-up. |
| **Two accounts for one number** | `auth.users.phone` is unique, two simultaneous sign-ups end with one user, and profile creation is idempotent (§4.3, B20). |
| **Customer changing role / verification flags** | 024 column grants now; 034 narrows customer writes to `full_name` only. The 005 trigger still blocks `phone_verified = true`. |
| **Reading someone else's profile** | Unchanged RLS: `users_self_select` / `users_self_update` limit a customer to their own row, and anon reads no `users` rows. B13 re-checks it. |
| **Ordering without a verified phone** | Order trigger `PHONE_NOT_VERIFIED:` (§4.2 step 6) |
| **Codes or numbers leaking into logs** | Codes are never logged. Numbers are masked to their last 3 digits. `sms_otp_log` is service-role only and pruned at 48 h. Sentry keeps `sendDefaultPii: false`. Secrets (the service-role key, the hook secret, MSG91's key) live only in Edge Function secrets and Ankit's shell, never in the frontend. |

### 9.2 Accepted risks

- **Recycled numbers.** Indian telcos reassign numbers about 90 days after disconnection. The new owner of a recycled number can log into the old account and see its order history, saved addresses and name. Zomato and Swiggy accept the same risk. There are no stored cards (COD), and a delete-account request frees the number cleanly.
- **SIM swap / SMS interception.** A targeted attack against a food-ordering account yields little. It's accepted for the same reason.
- **One number = one account (D11).** Family members sharing a phone share an account: one name on orders, one history, one address book. Before this change, duplicates were possible (`users.phone` has no unique rule, while `auth.users.phone` does), so this change also *removes* a source of messy data. Existing duplicates are settled with the customer (§7.4).
- **An owner who types their personal number into the customer login** gets a separate customer account, because partner accounts aren't phone-linked (D1). The partner link and onboarding cover this.
- **Partner and admin accounts never get an auth phone.** The OTP screen signs in any auth user with a confirmed phone. Attaching a phone to a partner or admin account would add a second way into it, protected only by SMS. The backfill is limited to role `customer`; never add a phone to a partner or admin in the Dashboard.

### 9.3 Legal copy, listing and Play Console

| Where | Change |
|---|---|
| `PrivacyPolicy.tsx` §2, "Account information" | Replace the email/password/Google text with: your mobile number (verified with a one-time code sent by SMS) and your name. Accounts created before the switch may also have an email address. Restaurant partners sign in with email and password, which is never stored in readable form. Fold the separate "Mobile number" bullet into this one. |
| `PrivacyPolicy.tsx` §5 purposes | "…verify your identity and mobile number via OTP, and to send account-related emails such as password resets" → "…sign you in with a one-time code sent to your mobile number, and send password-reset emails to restaurant partners". |
| `PrivacyPolicy.tsx` §7, MSG91 bullet | **Currently: "The OTP itself is generated and checked by MSG91; we never store your OTPs." This becomes false at launch.** New text: "MSG91 delivers the sign-in code by SMS. The code is generated and checked by Supabase, stored only in scrambled (hashed) form until it is used or expires." |
| `PrivacyPolicy.tsx` §7, Google bullet | Drop "only if you choose Google sign-in, for authentication". Keep the Google Maps part. |
| `PrivacyPolicy.tsx` §10 retention | "**OTPs** are never stored by us at all" (line 361) **becomes false.** New text: "**Sign-in codes** are stored only in scrambled (hashed) form by our authentication provider, until they're used or expire after 5 minutes." Add: "Records of sign-in code requests (mobile number, network address, time) are kept for 48 hours to prevent abuse." |
| `PrivacyPolicy.tsx` §12 rights (lines 410–412) | "view and update your name, email and phone number on your profile page… Changing your phone number requires re-verification" → "view and update your name on your profile page, and change your mobile number by confirming the new one with a code". |
| `TermsOfService.tsx` (around line 158) | "create an account (using email and password, or Google sign-in) and verify your mobile number via … OTP" → "create an account by verifying your mobile number with a one-time password (OTP) sent by SMS". |
| `DeleteAccountInfo.tsx` (the public `/delete-account` page) | "Your sign-in (email/Google)" (line 48) → "Your sign-in (your mobile number, or email for older accounts)". Its "personal details on past orders (name, phone…)" (line 52) already over-promises; fix it with §14's item. |
| `store-listing/listing.md` App access | Replace the email/password test account with "Phone: +91 94600 49608 · Code: (fixed test code — no SMS is sent)". The code itself goes only into Play Console. Add: "The login screen appears when you open RedLotus; Skip opens browsing." |
| `store-listing/listing.md` native features | "Google sign-in via Custom Tabs" → "mobile-number sign-in with a one-time SMS code". |
| Play Console → Data safety | Email address stays declared, since partners and legacy accounts still have one, but **mark it optional**. Phone number stays required. |
| Play Console → App access | Update to the D8 number **at launch**. After launch, the old email test account can only sign in through the partner page. |

---

## 10. Rollout

- **Deploy windows:** no deploys between 12–2 PM or 7–9:30 PM IST. Check the time with PowerShell `Get-Date`: on this machine Git Bash's `TZ=Asia/Kolkata date` prints UTC mislabelled as IST.
- **Review gate:** every `db push`, merge and OTA waits for Ankit's manual review.
- **Order:** `db push` first, then merge, as for 022–032.

| Phase | What ships | Gate to move on | Rollback |
|---|---|---|---|
| **0 — Hotfix** ✅ 2026-09-25 | 024–026 and their verify scripts (§2). | Done: every verify row is `true` on production (§2.6). | Re-grant (§2.4) |
| **1 — Backend dark launch** (no UI change) | MSG91 smoke test (§5.3) → one PR with 033, `auth-send-sms`, the `verify-otp` dual write (§7.5), `config.toml`, and the 030/032 e2e fixes (§4.3) → on its preview branch: `033_verify`, `033_e2e`, and branch tests B1–B3 with test numbers → Ankit reviews → `db push` 033 to production and run `033_verify` there → merge (deploys `auth-send-sms` and the dual write) → `SEND_SMS_HOOK_SECRET` → Dashboard settings in §6.1 order → production checks P1–P6 (§11.3). | P1–P6 pass. MSG91 shows a 6-digit code delivered. A refused number leaves no `auth.users` row. | Turn off the Phone provider and the hook (instant). Revert the `verify-otp` change. `033_rollback.sql`. |
| **2 — Backfill** | Sizing (§7.2) → the D8 check (§7.2) → dry run → settle conflicts with the customers (§7.4) → `--live` → re-run sizing. | Every eligible verified customer has an auth phone. Conflicts decided. | Backfilled phones are harmless if unused. They can be cleared through the admin API. |
| **3 — Launch** (web + OTA) | Frontend PR (§8, including the launch screen and the name gate) → Vercel preview on the branch → device matrix (§11.4) → update Play App access (§9.3) → Ankit reviews → merge off-peak → bump `package.json` version (the OTA gate). | Funnel healthy for 48 h (§12). No login-failure spike in Sentry or the Supabase auth logs. | Vercel instant rollback + Capgo previous bundle. The old flows still work, because Google, email and the legacy functions are all still live. |
| **4 — Transition** (D9, ≥30 days) | Nothing new. Watch the funnel and Capgo adoption. Re-run the backfill weekly. | 95%+ of active installs on the new bundle, and no customer logins via Google in the last 14 days (auth logs). | — |
| **5 — Cleanup** | Turn off the Google provider → remove `send-otp` / `verify-otp` from `config.toml` and delete them → **034** (`REVOKE UPDATE ON public.users FROM authenticated; GRANT UPDATE (full_name) ON public.users TO authenticated;`) → docs (§15) → next store build drops the custom-scheme intent filter. | — | Re-enable Google. Re-grant `phone` / `phone_verified`. |

How the brief's work phases map onto these:

| Brief phase | Here |
|---|---|
| 1–3: audit, architecture analysis, documentation and migration plan | This revision (§1.5, §1.6, §7) |
| 4: database and backend | Phases 1 and 2 |
| 5–6: the login UI, then new- and returning-user onboarding | Phase 3 |
| 7: security, RLS and regression tests | §11, in every phase |
| 8: final documentation and report | §15 at launch |

---

## 11. Testing

### 11.1 Unit and render tests (Vitest)

`src/lib/phoneAuth.test.ts` covers the pure logic:

- **Normalising.** `98765 43210`, `+91 98765-43210`, `09876543210` and `919876543210` all become `9876543210`. `5876543210`, `+44 7700 900123`, `98765` and `''` become `null`.
- **Formatting.** `formatMobile` and `toE164`.
- **`otpDigits`.** Strips non-digits and caps at 6.
- **`sanitiseName` / `nameError`.**
  - Trims, collapses spaces and strips control characters.
  - Accepts "Ram", "राम कुमार" and "D'Souza".
  - Refuses `''`, "a", 61 characters, "1234" and "!!".
- **`safeNextPath`.** `/checkout` passes. `//evil.com`, `/\evil.com`, `https://x`, `/login`, `/partner/login`, `/auth/callback`, a 600-character path, `null` and `''` all fall back to Home.
- **`loginDestination`.** A valid `next` wins; otherwise Home. Owners go to `/dashboard`, admin to `/`.
- **`shouldShowLaunchLogin`.**
  - Shows only at `/`, signed out, with auth loaded, on Home's first render of the launch, with no Skip in the last 7 days.
  - Never shows for a deep link, a session, or a second Home render.
  - A Skip 6 days 23 hours ago still hides it; one 7 days ago doesn't.
- **`needsNameStep`.** A customer with an empty or whitespace-only name → true. A named customer, an owner, an admin, or no profile → false.
- **`describePhoneAuthError`.** One case per row of §8.6. This includes extracting `retryAfterSeconds` from "after 17 seconds", matching prefixes on messages with no `code`, and the network case.

Render tests follow the redesign's pattern (`@testing-library/react`):

- **`PhoneOtpForm`:**
  - Continue stays disabled until 10 valid digits are in;
  - one request per tap while busy;
  - the code step submits itself on the 6th digit;
  - a wrong code clears the field and refocuses it;
  - the countdown restarts at a server-sent N;
  - errors land in the `aria-live` region;
  - Android back on the code step returns to the phone step (`backStack`).
- **`SignInPanel` and `ProtectedRoute`** build `next` from the current path.

The database side is `supabase/ops/033_e2e.sql` on a preview branch (§4.4).

### 11.2 Preview branch (test numbers from §6.2)

| # | Case | Expect |
|---|---|---|
| B1 | **New number.** Request the OTP, then query the DB. | An `auth.users` row with `phone_confirmed_at IS NULL`; **no** `public.users` row. This proves confirmations are ON and profile creation waits. |
| B2 | …then verify with the code | `public.users` row: `phone` has 10 digits, `phone_verified = true`, `auth_provider = 'phone'`, `full_name = ''`. Name step → saved → lands on **Home** (no `next`). Then a menu → checkout → order placed, and `orders.customer_phone` has 10 digits. |
| B3 | Log in again with the same number | Same user id, no name step, order history visible |
| B4 | Non-Indian number through the API (real hook only; run it in P3) | Hook returns 400 `PHONE_NOT_SUPPORTED:`; **no** `auth.users` row created (rolled back) |
| B5 | A wrong code; an expired code (wait out the 300 s); a used code; a resend before 30 s; a resend after | The `otp_expired` copy for all three bad codes; the countdown restarts from the server's N; the old code is rejected after a resend |
| B6 | Profile → change to the second test number | The new number is mirrored and verified. The old number now opens a **new** empty account. |
| B7 | Change to a number already on another account | `phone_exists` copy with a Log out button |
| B8 | Legacy email customer, unverified: sign in on `/partner/login` → `/checkout` | Redirect to `/verify-phone?next=/checkout` → link a number → verified → back at checkout |
| B9 | Backfilled legacy customers, one created as an email sign-up and one as a Google sign-up (`raw_app_meta_data.provider = 'google'`). Run the backfill against the branch, then log in by OTP. | **Same user id** for both; old orders and addresses visible |
| B10 | Seed owner at `/partner/login` → `/dashboard`. Open `/dashboard` while logged out. | Dashboard loads; logged out redirects to `/partner/login?next=%2Fdashboard` |
| B11 | `/login?next=//evil.com` | Lands on Home |
| B12 | Delete account → log in with the same number | A fresh user id with no history |
| B13 | Customer session: `update({ role: 'admin' })`, `update({ phone_verified: true })`, and a `select` of another user's row | Both writes refused (024 grants / 005 trigger); the read returns no row |
| B14 | Unverified legacy session calls `place_order` directly | `PHONE_NOT_VERIFIED:` |
| B15 | Logged out: Skip the launch screen, open a restaurant (D6, done by the redesign) | The menu loads with no login and no address. Add to cart → checkout → `/login?next=/checkout` → back at checkout with the cart. |
| B16 | Abandon at the code step, come back the next day with the same number | A new code is sent, verify works, and there's still exactly one auth user for the number |
| B17 | Verify the code, then close the tab before the name step; reopen RedLotus | Still signed in; the name gate shows the name step before Home; after saving, Home. No loop. |
| B18 | Signed out: open `/` | The launch screen. Skip → Home. Reopen within 7 days → Home directly. Sign in, then out → the launch screen again at the next launch. |
| B19 | Signed out: open a shared `/restaurants/:id` link, then `/coupons?apply=CODE` | Each opens directly, with no launch screen |
| B20 | Two devices request a code for the same new number at the same moment | One `auth.users` row and, after verifying with the newest code, one `public.users` row |
| B21 | Refresh the browser on the code step, then on the name step | Back on the same step, with the countdown right; no new SMS; no loop |
| B22 | Sign out, then log in again with the same number | Same user id, no name step, history visible |

### 11.3 Production dark launch (Phase 1)

`<ankit>` below is Ankit's own number, **not** the D8 number: once that's a test number, Supabase never texts it.

| # | Check |
|---|---|
| P1 | `curl` `POST /auth/v1/otp` `{"phone":"+91<ankit>"}` with the anon key → the SMS arrives with a **6-digit** code in the DLT text |
| P2 | `POST /auth/v1/verify` `{"type":"sms","phone":"+91<ankit>","token":"<code>"}` → session JSON. Then (counts / own row only) confirm the `public.users` mirror. |
| P3 | Same with `+447700900123` → `400 PHONE_NOT_SUPPORTED:`; `auth.users` has no row for it |
| P4 | 11th request for one number within 24 h → `OTP_LIMIT_REACHED:`. Clean up with `DELETE FROM public.sms_otp_log WHERE phone = '<ankit>'`. |
| P5 | Edge Function logs show masked numbers and no codes, and that `sms.phone` and `metadata.ip_address` arrived (§3.3). The MSG91 wallet shows about ₹0.20 deducted per send. |
| P6 | `+91 94600 49608` (D8) logs in with its fixed code, **no SMS is sent** (the MSG91 log has no entry), and it opens the dedicated reviewer account (§7.2) |

### 11.4 Devices

- A low-end Android phone with the app over 4G. Leave to read the SMS and come back; a Capgo update applying on return must restore the code step.
- Chrome on Android (web), and an installed PWA ("Add to Home screen").
- iPhone Safari: `one-time-code` should offer the code above the keyboard.
- A desktop browser.
- On each of the above: the launch screen, Skip, a full sign-up and a returning login.
- Hindi keyboard input for the name.
- Screen reader smoke test (TalkBack) on the code step.

### 11.5 The brief's 17 scenarios

| # | Scenario (brief §8) | Covered by |
|---|---|---|
| 1 | New user signs up using a phone number | B1, P1 |
| 2 | New user receives and verifies the OTP | B2, P2 |
| 3 | New user enters their name | B2, B17; `nameError` |
| 4 | New user reaches the home screen | B2, B18; `loginDestination` |
| 5 | Returning user logs in with phone OTP | B3, B22 |
| 6 | Returning user skips name collection | B3; `needsNameStep` |
| 7 | Invalid OTP is rejected | B5 |
| 8 | Expired OTP is rejected | B5 |
| 9 | OTP resend cooldown works | B5; `PhoneOtpForm` render test |
| 10 | Duplicate sign-up requests don't create duplicate accounts | B20; `033_e2e.sql` |
| 11 | Existing Google users aren't accidentally duplicated | B9 (the Google-created user); §7.1 |
| 12 | Existing email/password users keep their data | B9 |
| 13 | Existing sessions keep working per the migration plan | B8; the Phase 3 gate |
| 14 | Restaurant browsing works without an address | B15, B18 |
| 15 | RLS prevents unauthorised profile access | B13 |
| 16 | Logout and a later login work correctly | B22 |
| 17 | A browser refresh doesn't cause an authentication loop | B17, B21 |

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
- Supabase auth logs for `over_sms_send_rate_limit`. Check daily for the first two weeks, and whenever a customer says no code came. A spike means real customers can't get a code (§9.1).

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
- **CAPTCHA (Turnstile)**, if login lock-outs (§9.1) happen more than once:
  1. Add the widget to `/login` and `/partner/login`, behind a site-key env var.
  2. Pass `captchaToken` to `signInWithOtp`, `signInWithPassword` and `resetPasswordForEmail`.
  3. Ship it by OTA and wait for adoption.
  4. Only then switch it on in Auth → Attack Protection.

  Not before Phase 5: older bundles can't send a token.
- **Other countries (D13).** This needs an international SMS route, through MSG91's international product or another provider. Then the `+91` chip becomes a picker and the hook accepts those countries.
- **A database length rule for `full_name`.** The app's checks cover every screen, but a direct API write could still store a longer name. The harm is cosmetic: owner cards and receipts. Add a CHECK once `033_sizing.sql` shows that no existing name breaks it.
- **WhatsApp OTP fallback.** MSG91 WhatsApp authentication templates need Meta business verification. The hook would choose the channel.
- **Voice OTP** for "SMS never came", if MSG91 delivery logs show a real gap.
- **Hindi labels** on the login screen (plus Rajasthani-friendly wording), ideally app-wide.
- **Phone OTP for partners**, if partners ask. They'd need their numbers attached, and owner numbers would then be unusable for customer accounts.
- **Merging duplicate accounts** (moving orders, reviews and addresses between user ids) as a support tool.
- **Pruning unconfirmed auth users** (numbers that asked for a code and never verified) with a daily `pg_cron` job. They're harmless (no profile, no session), but each one holds its number, so a later change to that number may fail with `phone_exists`.

---

## 14. Adjacent findings (found while planning; not part of this build)

| Finding | Severity | Suggested fix |
|---|---|---|
| Customers could make themselves **admin**; owners could edit restaurant / dish ratings, featured and radius columns | **Critical** | **Fixed 2026-09-25**: migration 024 (§2.6) |
| Customers could create orders directly, including already-`completed` ones that unlock "verified" reviews; owners could rewrite any column of their restaurant's orders | **High** | **Fixed 2026-09-25**: migration 025 (§2.5) |
| `delete-account` keeps `orders.customer_name` / `customer_phone`, but the public `/delete-account` page (linked from the Play data-deletion form) says name and phone on past orders are removed | Medium (Play / DPDP) | **Recommend fixing the page, not the function.** Coupons rely on `customer_phone` surviving deletion, so that re-registering doesn't reset "new customer" status (`coupons_and_promo_codes_plan.md` §5.3). The page should say the name and phone stay on past orders for settlement and fraud prevention. If the scrub is ever wanted, keep a hashed copy for the coupon check first. The copy change can ship with §9.3. |
| `/restaurants/:id` required login despite anonymous menu browsing (016) | UX | **Resolved 2026-10-06** by the redesign (its D4) |
| WhatsApp help number differed between Login/Signup (`919460049608`) and CLAUDE.md (`916378939472`) | Low | **Resolved 2026-10-06** (D10): customers see `919460049608` |
| `Login.tsx`'s "this email is linked to Google" probe can't work (RLS blocks anonymous reads of `users`) | Low | Removed in §8.8 |
| `phone_verification_plan.md`'s status line said "Planning" although the flow is live | Low | **Fixed 2026-11-12**: it now says live and points here |

---

## 15. File checklist

**Shipped already (§2)**
- `supabase/migrations/024_column_write_grants.sql`, `supabase/ops/024_verify.sql`, `supabase/ops/024_rollback.sql`
- `supabase/migrations/025_orders_write_grants.sql`, `supabase/ops/025_verify.sql`, `supabase/ops/025_rollback.sql`
- `supabase/migrations/026_owner_self_review_guard.sql`, `supabase/ops/026_verify.sql`, `supabase/ops/026_rollback.sql`

**New**
- `supabase/migrations/033_phone_otp_login.sql`
- `supabase/ops/033_verify.sql`, `033_rollback.sql`, `033_e2e.sql`, `033_sizing.sql`, `033_backfill_customer_phones.mjs`, `phone_login_funnel.sql`
- `supabase/migrations/034_phone_otp_cleanup.sql` (Phase 5)
- `supabase/functions/auth-send-sms/index.ts`
- `src/lib/phoneAuth.ts` + `src/lib/phoneAuth.test.ts`
- `src/components/auth/PhoneOtpForm.tsx` (+ CSS, + `PhoneOtpForm.test.tsx`)
- `src/pages/login-signup/PartnerLogin.tsx` (+ CSS, from today's `Login.tsx`)

**Changed**
- `src/pages/login-signup/Login.tsx` (rewritten: the launch screen and the one customer entry point)
- `src/pages/auth/VerifyPhone.tsx`, `src/pages/auth/AuthCallback.tsx`, `src/pages/auth/ResetPassword.tsx`
- `src/pages/profile/Profile.tsx`
- `src/pages/discovery/DiscoveryPage.tsx` (the launch gate)
- `src/components/shell/CustomerShell.tsx` (the name gate), `src/components/shell/AppHeader.tsx` (`next`)
- `src/components/SignInPanel.tsx` (`next`, one button), `src/pages/coupons/CouponsPage.tsx` (`next` on its links)
- `src/App.tsx` (routes), `src/components/ProtectedRoute.tsx` (`next`, the partner redirect)
- `src/components/Navbar.tsx`, `src/components/FooterCTA.tsx`, `src/components/NativeBridge.tsx`
- `src/lib/navigation.ts` + `navigation.test.ts` (the `?setup=true` clause)
- `src/context/AuthContext.tsx`
- `src/pages/checkout/Checkout.tsx` (`PHONE_NOT_VERIFIED:` and `Profile incomplete`)
- `src/components/PrivacyPolicy.tsx`, `src/components/TermsOfService.tsx`, `src/components/DeleteAccountInfo.tsx`
- `supabase/functions/verify-otp/index.ts` (the dual write, Phase 1)
- `supabase/config.toml` (and its header comment)
- `supabase/ops/030_e2e.sql`, `supabase/ops/032_e2e.sql` (mark their customers verified)
- `src/types/database.ts` (regenerated)
- `store-listing/listing.md`

**Deleted**
- `src/pages/login-signup/Signup.tsx`, `src/pages/login-signup/Signup.css`, `src/lib/googleAuth.ts`
- `supabase/functions/send-otp/`, `supabase/functions/verify-otp/` (Phase 5)

**Docs updated in this revision (2026-11-12)**
- This plan.
- `phone_verification_plan.md`: the status line.
- `redlotusfoods_documentation.md`: a D11 note in §4.7.9.
- `CLAUDE.md` + `GEMINI.md`: OTP login moved from deferred to planned.

**Docs after launch**
- `CLAUDE.md` + `GEMINI.md`:
  - routes table (`/login`, `/partner/login`, `/signup`, `/verify-phone`), the launch and name gates, the auth gates section, the file map;
  - Critical rules: the phone mirror trigger, "confirmations ON", the 024/034 column grants, "hook never returns 429/503", "never `config push`";
  - Phone verification section, Hosting & env (the hook secret).
- `src/docs/redlotusfoods_documentation.md` (its email/Google sections), `play_store_launch_runbook.md` (App access), `capacitor_native_apps_plan.md` (native Google return removed; the partner checklist), `pre_production_checklist.md` (login checks).
- `src/docs/v2_deferred_issues.md`.
- `phone_verification_plan.md` marked retired at Phase 5.

---

## 16. Sources (checked 2026-09-25; re-checked 2026-11-12)

The 2026-11-12 re-check covered the GitHub integration, branching configuration, Send SMS hook, phone login and testing pages, and `phone.go`, `v0hooks.go`, `verify.go` and `admin.go`. The other sources weren't re-read.

- Supabase — Send SMS hook (the documented payload is `user` + `sms.otp`): <https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook>
- Supabase — Auth hooks (plans, 5 s budget, retries, error shape): <https://supabase.com/docs/guides/auth/auth-hooks>
- Supabase — Phone login: <https://supabase.com/docs/guides/auth/phone-login>
- Supabase — Testing auth flows (test numbers need an SMS provider configured; placeholder credentials work; `supabase config push` copies `[auth.sms.test_otp]`): <https://supabase.com/docs/guides/auth/testing-auth-flows>
- Supabase — Auth rate limits: <https://supabase.com/docs/guides/auth/rate-limits>
- Supabase — Auth error codes: <https://supabase.com/docs/guides/auth/debugging/error-codes>
- Supabase — CLI config (`auth.sms.*`, `auth.rate_limit.*`): <https://supabase.com/docs/guides/local-development/cli/config>
- Supabase — Phone settings (OTP length 6–10, test OTPs skip delivery, valid-until): <https://supabase.com/docs/guides/self-hosting/self-hosted-phone-mfa>
- Supabase — GitHub integration ("All other configurations, including API, Auth, and seed files, are ignored by default" on a production merge): <https://supabase.com/docs/guides/deployment/branching/github-integration>
- Supabase — Branching configuration (`config.toml` syncs to preview branches; persistent branches need a `[remotes]` block): <https://supabase.com/docs/guides/deployment/branching/configuration>
- Supabase Auth server source (`github.com/supabase/auth`, `master`):
  - `internal/api/phone.go`: `sendPhoneConfirmation` runs the resend window, then the test-number check, then (real numbers only) the project-wide SMS limiter, which is skipped under autoconfirm, then the code and the hook. `sms.phone` is passed to the hook.
  - `internal/api/signup.go`: autoconfirm confirms the phone at sign-up.
  - `internal/api/otp.go`
  - `internal/api/verify.go`: `smsVerify` calls `ConfirmPhone` on every `sms` verification.
  - `internal/api/admin.go`: an admin phone update confirms, then sets the number, and creates or updates the `phone` identity. There's no duplicate check; only `adminUserCreate` has one.
  - `internal/hooks/v0hooks/v0hooks.go`: payload incl. `sms.phone` and `metadata.ip_address`.
  - `internal/hooks/hookshttp/hookshttp.go`: 5 s, 3 retries on 429/503.
  - `internal/hooks/hookserrors`: messages passed through verbatim.
- MSG91 — SendOTP API parameters (optional `otp`: "OTP you want to send"): <https://knowledgebase.msg91.com/how-to-integrate-sendotp-api->

---

## 17. Ankit's phone-first brief (2026-11-12): where each point is handled

The brief asked for a Zomato-style, phone-first login: one entry point, an OTP, a name for new customers, then Home. v1 of this plan already covered most of it. The brief added:

- the launch screen (D12);
- one entry point with **Continue** (§8.3);
- the name gate (§8.4);
- the country code (D13);
- Home after login (D14);
- the cohort table with customer confirmation (§7.1);
- the 17 test scenarios (§11.5).

| The brief | Where |
|---|---|
| §1 Understand the existing implementation | §1.5 (audit), §1.1 (journeys), §2 (grants and RLS history) |
| §2 Review and update the documentation | §1.6 (which documents describe auth); §15 (what this revision updated and what's left for launch) |
| §3 Step 1: login screen at launch, +91 by default, validation, Continue, loading and errors, resend protection, no email or Google | D12, D13; §8.2, §8.3, §8.6 |
| §3 Step 2: OTP through the existing infrastructure, no second OTP system, brute force, cooldown, invalid / expired / used codes, a real session | §3.2 (what's reused, and why the code check moves to Supabase), §5, §6.1, §8.6, §9.1 |
| §3 Step 3: tell new users from existing ones; a required, sanitised name; no duplicate profiles | §3.5, §4.2, §4.3, §8.3 (name step), §8.4 (name gate) |
| §3 Step 4: Home after the name; no forced address or location | D14; §1.4, §8.2 |
| §4 Returning users | §3.5, §8.3 |
| §5 Database: reuse the tables, a normalised unique phone, concurrent sign-ups, idempotent profiles, RLS not weakened, no service-role key in the client | §4 (incl. D11's uniqueness note), §9.1; no RLS policy changes |
| §6 Existing users: email, Google and phone-verified; no merging on names or unverified numbers; customer confirmation where needed | §7 |
| §7 Frontend: design system, mobile-first, loading and error states, no duplicate requests, refresh, ended sessions, protected routes, no loops, PWA | §8 |
| §8 Security and testing: the 17 scenarios | §11.5 |
| §9 Work order | §10 (the table under the phases) |
| §10 Deliverables | The implementation report at the end of Phase 3. The manual Dashboard steps are in §6.1, the deployment order in §10. |
| Zomato-style experience | D12 (launch screen + Skip), §8.3 (one entry point, Continue, no login/sign-up choice), §8.2 and §8.13 (RedLotus's own design system and assets) |

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
