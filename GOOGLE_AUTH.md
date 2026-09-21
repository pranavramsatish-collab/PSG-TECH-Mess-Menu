# Adding "Continue with Google"

Step-by-step, in the order things have to happen. Roughly 2–3 hours of work if nothing fights you.

The goal: students tap one button, Google confirms who they are, and they stay signed in for the
rest of the term. Ratings then get tied to a real person instead of a random number in browser
storage, which is what makes "one rating per meal" actually mean something.

---

## Step 0 — Do this first

**Deploy the site.** You cannot complete Google's setup without the live URL, because you have to
register it as an authorised origin. Push to GitHub Pages first (see README).

### A note on which accounts are allowed

This guide assumes **any Google account works** — personal Gmail included, not just college mail.
That's the simpler setup and it's what most students will reach for.

What you get: **uniqueness**. One Google account is one identity, and making a second takes phone
verification, so double-rating is genuinely deterred. This is the thing that matters for ratings.

What you don't get: **eligibility**. Sign-in can't prove the person is a PSG hostel student —
anyone with a Google account can get in. For a mess menu that's a fine trade; the menu isn't
secret, and the realistic worst case is someone outside the hostel leaving a junk rating.

If you later want the roster you don't currently have, the clean way is to ask for a roll number
**once**, on first sign-in. Because it's now attached to a verified Google identity, one person
can't claim ten roll numbers, and collisions between accounts are detectable. You'd be building
the roster as students arrive rather than needing it upfront.

---

## Step 1 — Create the Google Cloud project

1. Go to <https://console.cloud.google.com/>
2. Project dropdown (top left) → **New Project** → name it `psg-mess-menu` → Create
3. Make sure the new project is selected before continuing — everything below applies to the
   selected project, and creating things in the wrong one is the most common early mistake.

## Step 2 — Configure the OAuth consent screen

**APIs & Services → OAuth consent screen**

- **User type: External.** (Internal only exists for Workspace organisations and would block
  personal Gmail, which is the opposite of what you want.)
- App name: `PSG Tech Mess Menu`
- User support email: your email
- Developer contact: your email
- **Scopes:** you need none beyond the defaults. Do not add any. Asking for extra scopes triggers
  Google's verification review and you'd be stuck for weeks.

### ⚠️ Then hit "Publish app" — do not leave it in Testing

A new External app starts in **Testing**, and Testing mode will quietly wreck this app:

- only **100 users**, and you must add each one manually by email address
- **authorisations expire after 7 days**, so every student gets kicked out weekly — which destroys
  the entire "stay logged in" point of doing this
- users see a warning screen before they can continue

Go to the consent screen and press **Publish app** to move it to production. Because you're only
asking for name, email and profile — the scopes Sign in with Google uses by default — **this does
not require Google's verification review** and no "unverified app" warning appears. It's immediate.

## Step 3 — Create the OAuth client ID

**APIs & Services → Credentials → Create Credentials → OAuth client ID**

- Application type: **Web application**
- Name: `Mess Menu Web`
- **Authorised JavaScript origins** — add both:
  ```
  https://<your-username>.github.io
  http://localhost:8000
  ```
  Origin only — no path, no trailing slash. `https://you.github.io/psg-mess-menu/` is **wrong**
  and will fail with `origin_mismatch`. The localhost entry lets you test before deploying.
- Leave **Authorised redirect URIs** empty for now (only needed for the iOS fallback in Step 9).
- Create, then copy the **Client ID**. It looks like `1234567890-abc...xyz.apps.googleusercontent.com`.

**About the client secret:** you'll also be shown one. You do not need it, and you must not put it
in `index.html`. This flow doesn't use it. The Client ID *is* safe to put in frontend code — it's
public by design.

---

## Step 4 — Backend: install what you need

Everything below assumes you're adding to the existing Render service.

**Python / Flask**
```bash
pip install google-auth PyJWT
# add google-auth and PyJWT to requirements.txt
```

**Node / Express**
```bash
npm install google-auth-library jsonwebtoken
```

## Step 5 — Backend: set your secrets

In the Render dashboard → your service → **Environment**, add:

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the client ID from Step 3 |
| `SESSION_SECRET` | a long random string you invent — `openssl rand -hex 32` generates one |

Never commit these to git. Read them from the environment.

## Step 6 — Backend: the sign-in endpoint

This is the important one. It takes Google's token, **verifies it**, and hands back your own
session token.

**Flask**
```python
import os, time, jwt
from flask import request, jsonify
from google.oauth2 import id_token
from google.auth.transport import requests as g_requests

CLIENT_ID = os.environ['GOOGLE_CLIENT_ID']
SESSION_SECRET = os.environ['SESSION_SECRET']

@app.post('/auth/google')
def auth_google():
    credential = (request.json or {}).get('credential')
    if not credential:
        return jsonify(error='missing credential'), 400

    try:
        # Verifies the signature against Google's public keys, plus aud and exp.
        info = id_token.verify_oauth2_token(credential, g_requests.Request(), CLIENT_ID)
    except ValueError:
        return jsonify(error='invalid token'), 401

    if info['iss'] not in ('accounts.google.com', 'https://accounts.google.com'):
        return jsonify(error='bad issuer'), 401

    # Any Google account is accepted — no domain restriction. If you ever want to limit
    # this to college accounts, the check is: info.get('hd') == 'psgtech.ac.in'

    user_id = info['sub']            # stable and unique — this is your real user key
    email   = info.get('email', '')
    name    = info.get('name', '')

    save_user(user_id, email, name)  # upsert into wherever you store data

    session_token = jwt.encode(
        {'sub': user_id, 'email': email, 'exp': int(time.time()) + 60*60*24*30},
        SESSION_SECRET, algorithm='HS256'
    )
    return jsonify(session_token=session_token, name=name)
```

**Express**
```js
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.post('/auth/google', async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'missing credential' });

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    payload = ticket.getPayload();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }

  // Any Google account is accepted. To restrict to college accounts later:
  //   if (payload.hd !== 'psgtech.ac.in') return res.status(403).json({ error: '...' });

  await saveUser(payload.sub, payload.email, payload.name);

  const sessionToken = jwt.sign(
    { sub: payload.sub, email: payload.email },
    process.env.SESSION_SECRET,
    { expiresIn: '30d' }
  );
  res.json({ session_token: sessionToken, name: payload.name });
});
```

**Do not skip the verification.** Decoding the JWT without checking its signature is the single
most common mistake here, and it makes the whole thing pointless — anyone can POST hand-written
JSON straight to your API and claim to be whoever they like.

## Step 7 — Backend: protect the existing endpoints

Add a check that reads your session token, then apply it to `/rate-submit` and `/complaint-submit`.

**Flask**
```python
from functools import wraps

def require_auth(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return jsonify(error='sign in required'), 401
        try:
            claims = jwt.decode(header[7:], SESSION_SECRET, algorithms=['HS256'])
        except jwt.PyJWTError:
            return jsonify(error='session expired'), 401
        request.user_id = claims['sub']
        return fn(*a, **kw)
    return wrapper

@app.post('/rate-submit')
@require_auth
def rate_submit():
    user_id = request.user_id      # <- use this, ignore any user_id the client sends
    ...
```

**The payoff:** now that `user_id` is trustworthy, enforce one rating per meal in the database
with a unique constraint on `(user_id, mess, menu, day, meal)`. That's the thing this whole
exercise was for — it can't be bypassed by clearing browser storage.

## Step 8 — Backend: CORS

Still required, and now it must also allow the `Authorization` header:

```python
CORS(app, origins=["https://<your-username>.github.io"], allow_headers=["Content-Type", "Authorization"])
```

Redeploy the backend before testing.

---

## Step 9 — Frontend

In `index.html`, add Google's library in `<head>`:

```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

Replace the password lock card's contents with a sign-in button, and wire it up:

```js
const GOOGLE_CLIENT_ID = 'PASTE_YOUR_CLIENT_ID_HERE';

window.onload = () => {
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: onGoogleSignIn
  });
  google.accounts.id.renderButton(
    document.getElementById('googleBtn'),
    { theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill' }
  );
};

async function onGoogleSignIn(response){
  try{
    const r = await fetch(`${API_BASE}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    if (!r.ok) throw new Error('auth failed');
    const { session_token, name } = await r.json();
    await window.storage.set('session_token', session_token, false);
    hideLock();
  }catch(e){
    document.getElementById('pwError').textContent = "Sign-in failed — try again.";
  }
}
```

On load, skip the lock if a stored session exists:

```js
(async () => {
  const s = await window.storage.get('session_token', false);
  if (s && s.value) hideLock();
})();
```

Send the token with every submission — in `postToLocalServer` and `postComplaintToServer`:

```js
const s = await window.storage.get('session_token', false);
headers: {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${s.value}`
}
```

And if the server ever answers `401`, clear the stored token and show the lock again — that's what
happens when a 30-day session finally expires.

**If sign-in misbehaves on an iPhone home-screen install:** popups can get lost in standalone PWA
mode. Switch to redirect mode — add `ux_mode: 'redirect'` and `login_uri: '<API_BASE>/auth/google'`
to `initialize()`, add that same URL to **Authorised redirect URIs** in Step 3, and change the
backend endpoint to accept a form POST (`request.form['credential']`) and redirect back to the app
instead of returning JSON. Only do this if popup mode actually gives you trouble — it's more work.

---

## Step 10 — Test, in this order

1. **Locally** — serve with `python3 -m http.server 8000` and open `http://localhost:8000`.
   Not `file://`; Google rejects it.
2. **On the live site** — the deployed GitHub Pages URL.
3. **Installed to the home screen** — add to home screen and sign in from there. This is the one
   that catches the popup problem, and it's how your users will actually run it.
4. **Rate the same meal twice** — the second attempt should be refused by the server, not just
   hidden by the UI.

## Step 11 — Clean up

- Delete `APP_PASSWORD` and everything that used it.
- Delete `getDeviceUserId()` and the `device_user_id` storage — the session replaces it.
- Decide what you're storing about students. You need `sub`; email is useful for matching roll
  numbers if you're on Workspace. You do not need the profile picture. Complaints are one place
  students may speak more freely knowing their name isn't attached — worth deciding on purpose.

---

## When something breaks

| Symptom | Cause |
|---|---|
| `origin_mismatch` | The origin in Step 3 doesn't match exactly — check protocol, no trailing slash, no path |
| Button doesn't render | `gsi/client` script didn't load, or `initialize()` ran before the DOM was ready |
| Works in browser, fails on home screen | Popup in standalone mode — see the redirect fallback in Step 9 |
| 401 on every submit | Token not being sent, or `SESSION_SECRET` differs between sign-in and verification |
| Everything fails only on the live site | CORS — Step 8, and remember to redeploy the backend |
| Works for you, "access blocked" for friends | App still in Testing — publish it (Step 2) |
| Everyone gets signed out after a week | Same cause: Testing mode expires authorisations after 7 days |
| First request after a quiet spell hangs | Render free tier cold start, 30–60s. Not a bug. |
