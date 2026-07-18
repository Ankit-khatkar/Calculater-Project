# Google Play listing — RedLotus (`in.redlotusfoods.app`)

Paste-ready content + form answers for the Play Console (plan §9/§10).
Everything is **town-agnostic** (A9): one listing serves every current and
future service area; only the "Now serving" line updates as cities go live.

## App record (Play Console → Create app)

| Field | Value |
|---|---|
| App name | `RedLotus — Food Delivery` |
| Default language | English (India) — en-IN |
| App or game | App |
| Free or paid | Free |
| Category | Food & Drink |
| Email | admin@redlotusfoods.in |
| Website | https://redlotusfoods.in |
| Privacy policy | https://redlotusfoods.in/privacy-policy |

## Short description (80 chars max — this is 79)

```
Order food from local restaurants in your town. Fast delivery, no hidden fees.
```

## Full description

```
RedLotus brings your town's real local restaurants online — the family-run
kitchens, dhabas and bhojnalayas you already know, now just a tap away.

We built RedLotus for smaller cities, not metros. No inflated prices, no
hidden charges, no commission squeezing your favourite restaurant. What you
see is what you pay — cash on delivery.

WHY REDLOTUS
• Real local restaurants near you — browse menus with photos and ratings
• Honest pricing — no hidden fees, and delivery is free on orders above ₹150
• Cash on delivery — no online payment needed
• Live order tracking — know the moment your food is accepted, cooked and
  out for delivery
• Instant alerts — notifications at every step of your order
• Saved addresses — home, office, anywhere

HOW IT WORKS
1. Allow location and see restaurants that deliver to you
2. Pick your dishes and place the order
3. The restaurant confirms with a delivery time
4. Pay cash when your food arrives — that's it

FOR RESTAURANTS
Own a restaurant? RedLotus lists your kitchen with zero per-order
commission. Visit redlotusfoods.in/partner-program or write to
admin@redlotusfoods.in.

Now serving: Gudha Gorji (Rajasthan) — more towns joining soon.

Questions or help with an order? Message us on WhatsApp at +91 63789 39472.
```

> Maintenance: update the "Now serving" line as service areas go live (A9).
> Never mention UPI/online payment until the payments phase ships (§7), and
> never use the words "website" or "browser" in the listing.

## Graphics

| Asset | Spec | Source |
|---|---|---|
| App icon | 512×512 PNG (Play auto-uses the AAB icon; upload `store-listing/play-icon-512.png` if asked) | generated from brand SVG |
| Feature graphic | **1024×500 PNG, required** | `store-listing/feature-graphic.png` |
| Phone screenshots | 2–8, min 1080 px short side, 9:16 | `store-listing/screenshots/` — captured from the real app |

Screenshot set (capture order): 1 storefront (restaurants near you),
2 restaurant menu, 3 cart/checkout, 4 live order tracking, 5 order history /
profile. Plain real screenshots are acceptable for v1; framed-with-caption
versions can replace them later without re-review.

## Data Safety form (§9.6)

Data collection: **Yes**. Data sharing: **No** (processors ≠ sharing in
Play's definition, but list them in the privacy policy). Encryption in
transit: **Yes**. Deletion: **Yes** — users can request deletion via
https://redlotusfoods.in/delete-account (in-app path: Profile → Delete
account).

Declare collected (all "App functionality", none "shared", none "processed
ephemerally"; account creation = required):

| Category | Type | Linked to user? |
|---|---|---|
| Personal info | Name | Yes |
| Personal info | Email address | Yes |
| Personal info | Phone number | Yes |
| Personal info | Address (delivery) | Yes |
| Location | Approximate location | Yes |
| Location | Precise location | Yes |
| App activity (or "Other user-generated content") | Orders, reviews | Yes |
| App info and performance | Crash logs / diagnostics (when Sentry ships — omit until then) | No |
| Device or other IDs | Device ID (push token) | Yes |

**No Financial info** at the COD-only v1 (§7). Add "Payment info — processed
by Razorpay" and re-submit the form only when the payments phase ships.

## Content rating (IARC questionnaire)

- Category: Utility/Productivity/Shopping style app → **no** violence, sex,
  language, gambling, drugs.
- **User-generated content: YES** — the app shows customer-written
  restaurant/dish reviews (migration 019). UGC is moderated (verified
  purchase only, admin can remove via dashboard).
- Users can interact / share location? Location is collected for delivery,
  not shared between users. No user-to-user communication.
- Expected outcome: **Everyone / 3+**.

## App access (Play Console → App content → App access)

"All or some functionality is restricted" → add instructions:

```
RedLotus is a hyperlocal food-delivery service for specific towns in India
(currently Gudha Gorji, Rajasthan). Browsing is open without login; ordering
requires an account with an OTP-verified Indian phone number.

TEST ACCOUNT
Email: <fill at submission>
Password: <fill at submission>
(Phone verification is already completed on this account.)

SEEING RESTAURANTS OUTSIDE THE SERVICE AREA
The home screen is geofenced to a 4 km radius. If your test location is
outside our service area, the empty state shows a "Show restaurants anyway"
button — tap it to browse the live Gudha Gorji catalogue and complete a
test order (cash on delivery — no payment collected in-app; you can cancel
the order right after placing it, or the restaurant declines it).

NATIVE FEATURES (not a website wrapper)
Push notifications for live order status (FCM), native geolocation with
in-app prominent disclosure, secure on-device session storage (Android
Keystore), Google sign-in via Custom Tabs, App Links, hardware back-button
handling, offline detection, in-app account deletion.
```

> Before submitting: create the dedicated test customer account (real
> verified phone), fill the credentials above, and re-test the
> "Show restaurants anyway" path signed in as that account.

## Remaining Console steps (Phase 8/9, manual)

1. Create the app record (table above) + complete all "App content" tasks
   (privacy policy URL, App access, Ads = No, Content rating, Target
   audience = 18+ recommended (food ordering, no child appeal), Data
   Safety, Government apps = No, Financial features = None).
2. Play App Signing: accept the default (Google holds the signing key) on
   first AAB upload — then append the **App Signing SHA-256** to
   `public/.well-known/assetlinks.json` and redeploy the web app.
3. Create a service account for CI upload (Play Console → API access) →
   grant "Release to testing tracks" → put its JSON in the
   `PLAY_SERVICE_ACCOUNT_JSON` GitHub secret.
4. Internal testing track first (Ankit's devices), then the closed track
   with the 12 testers → the 14-day clock (§11.2).
