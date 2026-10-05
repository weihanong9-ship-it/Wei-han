# 🥕 FoodLoop

**A digital service that cuts food waste where most of it happens: at home and in local shops.**

About a third of all food produced is never eaten. In many countries, households are the single largest
source. Food usually gets binned for three simple reasons:

| Why food gets wasted | How FoodLoop helps |
| --- | --- |
| *"I forgot it was in the fridge."* | **My pantry**: track what you buy and its expiry date. Items are sorted by urgency and colour-coded, and a banner flags anything that needs eating today. |
| *"I don't know what to cook with it."* | **Use it up**: recipe suggestions ranked by how much of your *soon-to-expire* food they use. The most urgent items count most. |
| *"I have too much and can't finish it."* | **Share board**: post surplus food (from a household, café or shop) with a pickup place and time. Neighbours claim it in one tap. Any pantry item can be shared directly. |
| *"Does it even matter?"* | **Impact**: your rescue rate, kg of food saved, estimated CO₂e avoided, money not wasted and community pickups. |

## Run it

Requires Node.js 18+. There are no dependencies to install.

```bash
npm start            # http://localhost:3000
npm test             # 14 unit + API tests
```

Environment variables: `PORT` (default `3000`) and `DATA_FILE` (default `data/db.json`).

## How it's built

```
server.js          HTTP server: JSON API + static files (Node built-ins only)
src/logic.js       Pure business rules: expiry/urgency, validation, stats, recipe matching
src/recipes.js     Built-in "use-it-up" recipes
src/store.js       JSON-file persistence with atomic writes
public/            Mobile-first web UI (vanilla JS, light/dark mode)
test/              node:test suites for the logic and the HTTP API
```

### API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/pantry[?all=1]` | Active items, sorted by expiry (`all=1` includes resolved items) |
| POST | `/api/pantry` | Add `{ name, expiresOn, category?, weightKg?, price? }` |
| PATCH | `/api/pantry/:id` | Resolve with `{ outcome: "eaten" \| "shared" \| "wasted" }` |
| DELETE | `/api/pantry/:id` | Remove an item that was added by mistake |
| POST | `/api/pantry/:id/share` | Turn an item into a share-board listing `{ location, pickupWindow?, donor? }` |
| GET | `/api/listings` | Available, unexpired listings |
| POST | `/api/listings` | Offer food `{ title, location, expiresOn, pickupWindow?, donor?, description?, category? }` |
| POST | `/api/listings/:id/claim` | Claim a listing `{ name? }`. A listing can only be claimed once. |
| GET | `/api/recipes` | Recipe suggestions for food expiring within 5 days |
| GET | `/api/stats` | Impact numbers |

## Roadmap ideas

This is a working MVP. To run it as a real public service, the next steps would be:

1. **Accounts & privacy.** Give each household its own pantry (the MVP has a single shared pantry) and
   show exact pickup addresses only after a claim.
2. **Reminders.** Send push or email notifications the day before food expires.
3. **Faster input.** Scan receipts or barcodes to add items, with typical shelf life filled in automatically.
4. **Location.** Sort listings by distance and add a map view.
5. **Business mode.** Let bakeries, cafés and supermarkets post end-of-day surplus at a discount or for free,
   and connect with food banks and charities for larger donations.
6. **Food safety.** Add guidance on "use by" vs "best before", allergen fields and rules for high-risk foods.
