# HatchHaven

A moonlit pixel-art field guide for the HatchHaven Discord bot. The website runs on Cloudflare Workers and deploys from GitHub. Its catalogue comes from the supplied bot release and has 250 creatures, nine egg tiers, 50 consumables, seven cosmetics, and all 27 player commands.

## Upload the website to GitHub

The whole package contains **24 files**. The `artwork` folder contains three compressed files that the build expands into the original 297 artwork files, including all 250 creature sprites.

1. Extract the outer website ZIP into a **new, empty folder**. Open the folder that contains `package.json` and `wrangler.jsonc`. Leave the three `.json.gz` files inside `artwork` as they are.
2. Go to the main page of your GitHub repository and start a fresh **Add file → Upload files**. For an empty repository, choose **uploading an existing file**.
3. Drag everything **inside** the extracted folder onto the upload area, including the `artwork`, `public`, `scripts`, `src` and `test` folders. The upload list should show `artwork/creatures-1.json.gz` and `package.json` at their original paths.
4. Choose **Commit changes**. If you prefer uploading in stages, commit each top-level folder or group of root files, then start the next upload from the main page of the repository. The largest folder contains six files, counting its subfolders.

Use a freshly extracted copy for browser uploads. Running a local build or installing dependencies adds generated files to the working folder. If you already committed some original artwork, you can leave those files in place. [GitHub file uploads](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)

## Deploy the GitHub repository on Cloudflare

1. **Create a Cloudflare Worker.** In the Cloudflare dashboard, open **Workers & Pages → Create application → GitHub**. Select the website repository and its production branch.
2. **Use the settings below and deploy.** Open the HTTPS address Cloudflare provides. You can now browse the entire guide.
3. **Connect Discord** using the next section. The first deployment can run before you set up sign-in.

| Build setting | Value |
| --- | --- |
| Worker name | `hatchhaven`, matching `name` in `wrangler.jsonc` |
| Root directory | Repository root |
| Build command | `npm test` (builds the site, then runs the checks) |
| Deploy command | `npm run deploy` |
| Node | Node 24 recommended. The minimum is 22.12.0. Set the build variable `NODE_VERSION` to `24` if needed. |

The build restores the art and generates the HTML in `public/`. The checked-in Wrangler configuration also runs this step on deploy. The Worker serves the pages and the OAuth endpoints on one HTTPS origin. Wrangler provisions the `AUTH_VAULT` SQLite-backed Durable Object and `AUTH_RATE` binding from the included configuration. GitHub Pages serves static files and cannot execute the login handler. Use the Cloudflare URL as the public website address. [Cloudflare Git builds](https://developers.cloudflare.com/workers/ci-cd/builds/) · [Build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)

**Keep the original bot archive private.** It includes a `.env` file and historical player saves. Upload the extracted **website** files to GitHub. If a real bot token has been shared, reset it in the Discord Developer Portal under **Bot → Reset Token**, update the private `DISCORD_TOKEN` on the bot host, and restart the bot. The website uses an OAuth client secret. [Discord token reset instructions](https://support-dev.discord.com/hc/en-us/articles/6470840524311-Why-can-t-I-copy-my-bot-s-token)

## Enable Discord sign-in

1. Copy the deployed site address, or finish connecting a custom domain first. Use a single canonical origin, for example `https://hatchhaven.your-subdomain.workers.dev`.
2. In the Discord Developer Portal, select your HatchHaven application. Under **OAuth2 → Redirects**, add your exact site origin followed by `/auth/callback`. For the sample origin, enter `https://hatchhaven.your-subdomain.workers.dev/auth/callback`, then save changes.
3. Copy the application’s **Client ID** and its OAuth2 **Client Secret**. Keep the client secret in your own Discord and Cloudflare accounts.
4. In Cloudflare, open the deployed **Worker → Settings → Variables and Secrets**. Add the following **runtime** settings and deploy the changes. Build-only variables are unavailable to the running Worker.

| Name | Cloudflare type | Value |
| --- | --- | --- |
| `SITE_ORIGIN` | Text | Exact public HTTPS origin, without a trailing slash or path |
| `DISCORD_CLIENT_ID` | Text | Discord’s numeric application/client ID |
| `DISCORD_CLIENT_SECRET` | **Secret** | OAuth2 client secret from the same application |

Open **Connect Discord → Continue to Discord** on that exact origin. Approve the identity request if Discord asks. Back on the site, your display name should appear in the header. Open it and choose **Sign out** to finish the live check. Sign-in can also be cancelled on Discord and retried from the guide. [Discord Developer Portal](https://discord.com/developers/applications) · [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2) · [Cloudflare runtime secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

### What sign-in does

The Worker uses the authorization code flow with S256 PKCE and requests only `identify`. It validates a one-use state against a separate browser cookie, exchanges the code on the server, then calls Discord’s current-user endpoint. The website session contains the Discord ID, username, and display name. Discord tokens are discarded after the identity lookup. [Discord authorization server metadata](https://discord.com/.well-known/oauth-authorization-server) · [Discord current user](https://docs.discord.com/developers/resources/user#get-current-user)

The browser receives an opaque, host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookie. Login attempts expire after ten minutes. Website sessions expire after eight hours and signing out invalidates the server record. Login and logout require a same-origin POST. Protected responses use `no-store`. Cloudflare rate-limits sign-in starts at the edge. The public guide and privacy page remain usable when authentication is unconfigured.

## Fix common setup issues

| What you see | How to fix it |
| --- | --- |
| “Sign-in is awaiting the site owner’s Discord and Cloudflare settings.” | Check all three runtime settings on the deployed production Worker. Use its exact `SITE_ORIGIN`, including HTTPS. A public preview intentionally displays this state. |
| Discord rejects the redirect URI | Copy `SITE_ORIGIN`, append exactly `/auth/callback` and register that entire address in Discord. Check the domain, path, and trailing slash. Restart sign-in from the website. |
| You return to the website with a failed sign-in message | Check the OAuth client ID and secret come from the same Discord application. Save the secret as a Cloudflare runtime **Secret**, deploy the change, and begin a fresh login. |
| A login has expired | Start again on the same host and browser with first-party cookies enabled. Old attempts, including a previous login tab, expire. |
| The build reports a missing artwork pack | From the repository root, upload the entire `artwork` folder from the compact ZIP. Check that it contains `creatures-1.json.gz`, `creatures-2.json.gz` and `world.json.gz`, then retry the build. |
| Cloudflare cannot find the Worker or public files | Upload the extracted contents at repository root, including `src/`, `public/`, build scripts and the lockfile. Match the dashboard’s Worker name to `wrangler.jsonc`. |
| You switched to a custom domain | Update `SITE_ORIGIN` and Discord’s registered callback together, then start a new session on that domain. |

## Preview and maintain the site

Use Node 24 or Node 22.12+ from the project root.

```sh
npm ci
npm run build
npm test
npm run test:worker
npm run dev
```

The local public preview opens at `http://127.0.0.1:4173`. `npm run test:worker` exercises login, identity lookup, replay rejection, session reads, and logout inside the Cloudflare Workers runtime with a simulated Discord provider. `npx wrangler deploy --dry-run` validates the deployment bundle and bindings without publishing.

For local OAuth development, copy `.dev.vars.example` to `.dev.vars`, set a separate test application’s values, register its exact HTTPS callback, then run `npm run dev:worker`. Use the same hostname and port that you registered. A real Discord consent and return on the production domain completes the launch verification.

| File | What to edit |
| --- | --- |
| `artwork/*.json.gz` | The original artwork packed for upload. After editing the expanded art under `public/assets/`, run `npm run pack:art` before building again. |
| `scripts/build.mjs` | Page content, homepage spotlights, and proposed updates. Run `npm run build` after edits. |
| `public/assets/site.css` and `public/assets/site.mjs` | Layout, responsive navigation, optional parallax, search, filters, and dialogs |
| `public/assets/components.mjs` | Shared catalogue cards and field notes |
| `public/data/catalog.json` | Public creature, egg, and shop information |
| `public/data/commands.json` | Player-facing command descriptions and options |
| `src/worker.mjs` and `src/vault.mjs` | Discord OAuth and expiring Cloudflare sessions |

For compatible catalogue-v8 releases, `python scripts/export_catalog.py /path/to/private-bot.zip` regenerates the public catalogue and artwork. It requires Python 3.10+ and Pillow with WebP support. From a fresh checkout, run `npm run build` once to expand the existing artwork. Run the exporter against the private archive, then run `npm run pack:art` to save the updated art and `npm test` to verify the result. Commit the updated packs and `public/data/catalog.json`. The exporter reads specific game art and catalogue fields. Update the command reference separately if the bot’s registered public commands change.

## Current scope and future additions

**Discord progress.** Website sign-in identifies a visitor. Inventories, plots, wallets, and trades continue to live on the bot host. To add a personal inventory later, give the bot a read-only authenticated endpoint that checks the signed-in Discord ID and the chosen server before returning that player’s collection. Keep the private game database on the bot host.

**Limited companions.** The Updates page shows original proposals with a quest redemption route and a possible fixed-price route to the same pet. Launching one would require implementing the event and redemption logic in the bot. An optional paid route would also need a payment provider, verified purchase notifications and duplicate-safe delivery. A branded crossover would need permission from the rights holder. No licensed partnership or sale is active.

**Artwork.** The creature and egg sprites, Shellbit coin and game location illustrations come from the supplied HatchHaven release. The moonlit lakeside hatchery was created for this website. The small habitat backgrounds, pixel UI icons, consumable illustrations, and Haven Pixel display typeface were made for the guide. The icon and font permission notice is in `public/assets/ui/PERMISSIONS.txt`.
