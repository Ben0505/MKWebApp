# Deploying BUKU MK v2.1 — start to finish

For: testing v2.1 on a **new Cloudflare account**, using the **existing duplicate
Google Sheet**, with the code on GitHub at `Ben0505/MKWebApp`.

Nothing here touches your live/production setup. Total time ≈ 30–40 minutes,
most of it waiting on Google.

---

## Before you start — the three things that matter

1. **Everything is on `main`.** You do not need to pick a branch anywhere.
   Cloudflare defaults to `main`, which is now the deployable branch, so
   leave every branch setting alone. All future changes go to `main` too.

2. **Which folder gets published is already decided, in `wrangler.jsonc`.**
   `Code.gs` and these guides live at the repo root, *outside* `public/`,
   and `wrangler.jsonc` publishes only `public/`. There is no dashboard
   field to get wrong, and the setting is in Git so it cannot be lost to a
   stray click later.

3. **Your Cloudflare email and your GitHub email do not need to match.**
   Cloudflare asks GitHub for permission to read the repo. You log into
   Cloudflare with the new email, and authorize the `Ben0505` GitHub account
   when prompted. That is normal and expected.

---

## Step 1 — Update the backend (Google Apps Script)

Work in the **duplicate sheet** you are already testing with.

1. Open the duplicate sheet → `Extensions` → `Apps Script`.

2. **Select all existing code and delete it.** All of it.
   Pasting on top of the old code causes "function already defined" errors.

3. Open `Code.gs` from this repo, copy the whole file, paste it in.
   Save (the disk icon, or Ctrl+S).

4. Deploy — **this part is easy to get wrong:**

   `Deploy` → `Manage deployments` → click the **pencil / Edit icon** on your
   existing deployment → set `Version` to **New version** → `Deploy`.

   > Use **Manage deployments → Edit**, *not* `New deployment`.
   > Edit keeps the same `/exec` URL. New deployment gives you a different
   > URL and you would have to update `mk-config.js` as well.

5. Google may ask you to re-authorize. Allow it.

6. Copy the `/exec` URL shown. Keep it — you need it in Step 2.
   It looks like `https://script.google.com/macros/s/AKfycb..../exec`

### Check the backend before going further

Paste this into a browser tab, replacing `<URL>` with your `/exec` URL:

```
<URL>?action=batch&a=getProduk,getStock
```

- You should see JSON starting with `{"success":true,"batch":true,...`
- If you instead see `{"status":"ok","message":"BUKU MK API aktif."}`,
  the new `Code.gs` did **not** deploy. Redo step 4 and make sure you
  picked **New version**.

Do not continue until this returns `"batch":true`. Everything downstream
depends on it.

> **Do not run `setupAll()` or `setupUsers()`.** They are for empty sheets
> only. `setupUsers()` no longer contains real passwords (they were removed
> because the file is stored in a repo), so running it on an empty sheet
> would create users with the password `GANTI_SAYA`. Your existing Users
> sheet is untouched either way.

---

## Step 2 — Put your GAS URL into the config

`public/mk-config.js` currently has a placeholder. The app cannot work until
you replace it.

Easiest way, straight in the browser:

1. Go to
   `https://github.com/Ben0505/MKWebApp/blob/main/public/mk-config.js`
2. Click the **pencil (Edit)** icon.
3. Change this line:
   ```js
   GAS: 'GANTI_DENGAN_URL_DEPLOYMENT_BARU',
   ```
   to your real URL:
   ```js
   GAS: 'https://script.google.com/macros/s/AKfycb..../exec',
   ```
4. Keep the quotes and the trailing comma.
5. Scroll down → **Commit changes** → commit directly to `main`.

While you are in this file, confirm:
```js
ENV_LABEL: 'UJI COBA',
```
This puts an orange **UJI COBA** label in the sidebar so you can never confuse
the test site with the real one. Leave it as is.

---

## Step 3 — Cloudflare

Cloudflare now steers new projects to **Workers** rather than Pages. Pages
still exists but is de-emphasised in the dashboard. We use Workers, which is
what Cloudflare recommends for new projects, and `wrangler.jsonc` in this
repo already configures it.

1. Sign up / log in at `dash.cloudflare.com` with your new email.

2. **Compute (Workers)** → **Create** → **Import a repository**
   (older wording: *Connect to Git*).

3. When the GitHub window opens, **log in as `Ben0505`** there, not the new
   account. Grant access to the `MKWebApp` repository — "Only select
   repositories" and pick just this one is fine.

4. On the **Set up your application** screen:

   | Field | Value |
   |---|---|
   | Project name | **`bukumk-test`** — must match `name` in `wrangler.jsonc` |
   | Build command | **leave empty** (there is no build) |
   | Deploy command | `npx wrangler deploy` — the default, leave it |
   | Builds for non-production branches | leave ticked, harmless |
   | Protect with Cloudflare Access | see the note below |

   Under **Advanced settings**, leave `Path` as `/` and the non-production
   deploy command as `npx wrangler versions upload`.

   > **The project name matters.** `wrangler.jsonc` says `bukumk-test`. If you
   > name the project something else, wrangler will create a *second*,
   > separate Worker under the name in the file and you will be looking at an
   > empty site wondering why.

   > You will **not** see "Production branch", "Framework preset" or "Build
   > output directory" on this screen. Those are Pages fields and do not exist
   > in the Workers flow. Nothing is missing — `wrangler.jsonc` covers them.

5. **Deploy.** Under a minute; there is no build step, Cloudflare just
   uploads the 17 files in `public/`.

6. You get a URL like `https://bukumk-test.<your-subdomain>.workers.dev`.

### Worth considering: Protect with Cloudflare Access

That toggle on the setup screen puts a login gate in front of the whole site,
so only email addresses you nominate can reach it at all.

Given there is still no authentication on the Apps Script backend (see the
last section), turning this on is the single cheapest thing you can do to
close that gap for the test site. It costs nothing on the free plan and takes
a couple of minutes: you list the emails allowed in, and everyone else gets
a Cloudflare login screen before they ever see the app.

The trade-off is that your staff would have to pass that gate too, which is
friction during testing. Your call — but if you ever put real customer data
into this site, turn it on.

## Step 4 — Verify (10 minutes, do not skip)

### A. It loads at all
Open the URL. You should get the login page. Log in with a user from your
Users sheet.

If you see *"Tidak bisa terhubung ke server"*, the GAS URL in Step 2 is wrong.

### B. Check the orange label
Bottom of the sidebar must show **UJI COBA** in orange. This is your guard
against entering real data into the test site.

### C. Prove the speed fix landed
Open `tagihan.html` → press F12 → **Network** tab → filter for `exec` →
reload the page.

- **Expect ONE request**, `action=batch&a=getPelanggan,getNotaBelumTagih,...`
- If you see five separate requests, Step 1 did not take effect.

Now reload again within 30 seconds → expect **zero** requests.

Then sit on the page for ~3 seconds without clicking → one more `batch`
request appears. That is the idle prefetch warming the other pages. Click any
menu item afterwards and it should open instantly.

### D. Prove the mobile fix landed
On your phone, open `input-penjualan.html`.

- The **ITEM / BARANG** card must be visible below the Informasi Nota card,
  and **+ Tambah Item** must be tappable.
  Previously both were off-screen and unreachable — this is the main fix.
- Try to swipe the page sideways. It should not move.

### E. The part I could not test — do this properly

Everything above was verified in a real browser, but against a **mock server**,
not your spreadsheet. Write operations were never tested against real data.
Please run each of these once on the test site and confirm the row appears
correctly in the duplicate sheet:

- [ ] Save a nota (`input-penjualan`) — check Data Penjualan + Item Penjualan
- [ ] Edit that nota — check the row updates rather than duplicating
- [ ] Create a tagihan (`tagihan`) — check Tagihan + Kredit
- [ ] Record a payment against it
- [ ] Input stock (`stock`)
- [ ] Kirim a langsiran, then Terima it (`langsiran`)
- [ ] Print a nota and the daily print — check the layout is intact
- [ ] Add and edit a pelanggan and a produk

**One specific check that tests my new cache logic:**
after saving a nota, open the **Pelanggan** page and confirm the
*nota belum tagih* figure for that customer has changed.

That path is subtle: `getPelanggan` secretly reads Data Penjualan and Tagihan
via `_calcBelumTagih()`, so saving a nota has to invalidate the customer cache
too. I mapped it deliberately, but real data is the only real proof. If the
number is stale, tell me — it means my dependency map has a gap.

---

## If something goes wrong

**Roll back the frontend:** Cloudflare → your project → **Deployments** →
find an earlier deployment → **Rollback**. Instant.

**Roll back the backend:** Apps Script → `Deploy` → `Manage deployments` →
`Edit` → pick the previous version → `Deploy`.

**No data can be lost by rolling back.** v2.1 changed no sheet, column, or
value. All of the speed work lives in CacheService (Google's memory) and in
the browser. Worst case you are back where you started.

**One page broken on mobile only?** Don't discard the whole thing — add
`class="mk-keep-table"` to that page's table and it reverts to sideways
scrolling. Tell me which page and I'll fix it properly.

---

## What this does NOT fix

Worth being blunt, since you are about to put this on a public URL.

**There is still no authentication on the server.** `doGet` and `doPost` never
check who is calling, and the deployment is set to *Who has access: Anyone*.
Anyone who has the `/exec` URL — which is visible in `mk-config.js`, which is
served publicly by Cloudflare — can read all customer and sales data, or call
`deletePelanggan`, straight from a browser console. No login required. The
login screen controls what the sidebar shows, not what the data lets you do.

I removed the passwords from `Code.gs` so they are no longer downloadable from
the website, and that is a real improvement, but it is not the same as fixing
this. The passwords are still stored as plain text in the Users sheet and still
sent in a URL query string at login.

For a test site with an unlisted `pages.dev` URL, your realistic exposure is
low. It is worth knowing that "nobody has the link" is the only thing
protecting it, and that is luck rather than a security model. Fixing it
properly — a signed token checked in every handler, hashed passwords, and
server-side role checks — is roughly two days of work and touches every page.
Worth doing once you have confirmed v2.1 is stable.
