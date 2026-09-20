# PSG Tech Hostel — Mess Menu

An installable web app (PWA) showing the North and South Indian hostel mess menus for
both messes and all seven days, with meal ratings and issue reporting.

Built by a student at PSG College of Technology. **Not an official college
application** — the college and the hostel administration don't operate it.

[Privacy](./privacy.html) · [Terms](./terms.html)

---

## Running it

There is no build step. It's one HTML file plus a service worker and some icons.
Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then http://localhost:8000
```

A plain `file://` open mostly works, but the service worker won't register and the
install prompt won't appear, so use the server when testing those.

## Deploying to GitHub Pages

Push the folder to a **public** repo, then **Settings → Pages → Source: Deploy from a
branch → `main` / `/ (root)` → Save**. It goes live at
`https://<username>.github.io/<repo>/` within a minute or two.

Every path in the project is relative (`./sw.js`, `./icon-192.png`), which is what makes
it work under that sub-path. Don't change them to absolute `/…` paths or Pages breaks.

**Bump `CACHE_VERSION` in `sw.js` on every deploy.** The service worker serves a cached
shell to returning visitors; without a bump, some of them keep seeing the old version
until their browser happens to revalidate.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app — five tabbed views, all styles, all logic, and the menu data |
| `sw.js` | Service worker: makes it installable, and keeps the menu readable with no signal |
| `manifest.json` | PWA metadata |
| `icon-192.png`, `icon-512.png` | App icons |
| `icon-maskable-512.png` | Padded variant, so Android's circular mask doesn't clip the artwork |
| `privacy.html`, `terms.html` | Required by Google to publish the sign-in, and worth having anyway |
| `prototype-*.html` | Three 3D experiments. Not part of the app; safe to delete |

## How it's put together

One document, five views (`Today`, `Full week`, `Find a dish`, `Your activity`,
`About`), routed by hash and swapped with a `.view.on` class. A bottom tab bar, because
the app is used one-handed walking to the mess. Each view remembers its own scroll
position.

The things you'll most likely want to edit, all inside `index.html`:

| What | Where |
|---|---|
| The menu itself | the `MENU` object |
| Prices for paid (token-basis) items | `PRICED_ITEMS` — **keys must be lowercase**, lookups are lowercased and will silently miss otherwise |
| Serving times | `MEAL_START` / `MEAL_END` — one copy, used by the Now card, the meal rows and the countdowns |
| How long a meal stays rateable | `RATING_WINDOW_HOURS` (currently 12, from when the meal starts) |
| Meal names | `MEAL_LABELS` — both messes point at this one object, so they can't drift apart |
| Roll number format | `ROLL_PATTERN` — currently `MNXABC`: two digits, one letter, three digits |

Colours are CSS custom properties on `:root`, with a `body.light` override. Turmeric is
a bright colour, so the accent is split into three roles — `--accent` for fills,
`--accent-ink` for accent-coloured text on the page, `--on-accent` for text on top of a
turmeric fill. Collapsing those into one token is how you get white text on yellow.

## Backend

Ratings and reports currently POST to a FastAPI service on Render, which writes to
Supabase. That is being replaced: the browser will talk to Supabase directly, with
Google sign-in through Supabase Auth and Row Level Security doing the enforcement, and
the Render service will be retired.

Until that lands, two things in the UI are honest about being incomplete:

- **Star averages are device-local.** There's no read endpoint, so a student only ever
  sees their own ratings back. The badges say "you" rather than pretending otherwise.
- **Complaint status never moves.** The app sends a reference number and polls for a
  status; nothing serves one yet.

## Known limitations

- **The password gate is not security.** `APP_PASSWORD` is in the page source and anyone
  can read it. It's a speed bump. Google sign-in is the replacement.
- **Nothing yet stops someone re-rating.** The once-per-person rule is enforced in the
  browser against data the browser supplied. Real enforcement is a unique index plus a
  verified `auth.uid()` in the database — that's the point of the backend change above.
- **The menu can be wrong.** It's a fixed timetable baked into the app; the mess changes
  what it serves without telling anyone. Don't rely on it for an allergy or a fast.
