# POOKY Pixel Panic! ✺

A playable **up-to-20-player multiplayer** product guessing game, inspired by Pooky. Players enter nicknames, create or join a shared room, and race through ten rounds. Each round starts as a blocky pixelated image; a randomly chosen section becomes sharp every five seconds until the whole image is revealed at the 60-second mark.

**No accounts, database, paid services, API keys or npm dependencies required.** Player “login” means **nickname + room code**, not email/password authentication.

## Start in under a minute

1. Install [Node.js 20+](https://nodejs.org/) if you haven't already.
2. In the project directory, run:

   ```bash
   npm start
   ```

3. Open http://localhost:3000 in your browser. Create a game using your nickname.
4. Give your colleaguess the **invite link** and room code. They open the link in their browsers, type a nickname and join. Once they're connected, click **Let's play**.

If you're both on the **same office network**, your colleague can use `http://YOUR-COMPUTERS-LAN-IP:3000` (not `localhost:3000`). Your firewall may ask you to allow incoming connections to port 3000.

If your colleague is **on a different network**, deploy the Node app to a hosting provider (e.g. Render) so both of you can open the same public URL. A `render.yaml` deployment blueprint is provided. Render's free service may sleep when idle; allow it to wake before playing. When it restarts, room state and uploaded photos are lost.

## Rules

- **2 to 20 players per room**; everyone competes at the same time.
- **10 rounds**, with **60 seconds** in each round.
- A new **1/12 portion** of the photo reveals every **5 seconds**.
- Players type the **product family** (e.g. *Trindle*, *Freya*, *Aspen*), not the full colour/finish.
- Answers with **one insertion, deletion or substitution typo** are accepted. The first correct server-validated answer ends the round and scores `100 + 15 × seconds remaining` (up to **1000 points**).
- The exact answer is revealed for 4.5 seconds, then the next round starts automatically.
- After 10 rounds, the ranked leaderboard and full history are shown. The host can start a rematch using 10 previously unused products.
- A product family never repeats in the same room until the host explicitly resets product history. The browser remembers previously played products across newly created rooms on the same device. With fewer than 10 unseen products remaining, another full match is blocked until history is reset.

## Photos and custom rounds

The app tries to download authentic product photographs from the public Pooky UK Shopify product endpoints **on server startup**. Currently, there are 48 Pooky product URLs in `server.js`. If Pooky blocks any download (or internet isn't available), that item uses a generic **illustrated demo** fallback. The screen explicitly labels that fallback. Photos are displayed within the game and answers are validated on the server. This is a prototype for private use, **not an official Pooky product**.

For full control over the imagery, in the lobby the **host** can open **“Want to use your own Pooky product photos instead?”** and upload **at least 10** JPEG, PNG, or WebP images (5 MB max each). Name each file after its product, e.g. `Trindle.jpg`, `Freya.jpg`. The first word of each filename is the accepted guess; the whole filename is shown at the end. You can upload up to 40 and a random 10 will be selected per game. Photos are temporarily stored in the Node server's memory, not saved to disk. Photos downloaded from Pooky are similarly cached in memory.

## Deploy with Render

1. Put the extracted `pooky-pixel-panic` folder in a **private GitHub repository**.
2. In [Render](https://render.com/), create a **Blueprint** using the repository, or create a **Web Service** with Runtime `Node`, Build Command `npm install`, and Start Command `npm start`.
3. Render reads the included `render.yaml` if you use Blueprint. Once deployed, use your `https://...onrender.com` URL on both devices.
4. The Pooky image fetch runs again when the server boots. For a guaranteed 100% photography round set, upload your own images in the lobby.

## Notes and limitations

- No registration/passwords; rooms are protected by their room code and an unguessable browser session token. **Not intended as corporate SSO or public account management.**
- Rooms, uploaded images, and scores live **in memory** and disappear when the Node server restarts. A browser-local list of previously used product names persists on the host device unless browser data is cleared or private browsing is used. The list of used product names also persists in the **host browser’s local storage** across new rooms on the same browser/device, but not across devices, browser-data clearing or private windows. A database would be needed for long-term records and accounts.
- This is for casual office multiplayer games (up to 20 players per room). Host the server in one instance and don't enable horizontal scaling without a shared database and pub/sub.
- The name of the Pooky brand and any authentic images belong to their respective owner. Make sure you have permission before publicly distributing or hosting company photos.
- For stronger anti-cheat controls, server validation already determines the first accepted correct answer. As with most casual image games, a determined player might inspect the image response or source code, so don't use this for prize-money competitions.

## Folder layout

```text
pooky-pixel-panic/
  server.js          # Game rooms, images, timer, scoring & events
  package.json       # Node start command; no dependencies
  render.yaml        # Optional Render deployment
  public/
    index.html       # Main page
    styles.css       # Responsive design
    app.js           # Player interface and progressive reveal canvas
```

## Optional adjustments

- Change `ROUND_MS`, `REVEAL_MS` and `ROUND_COUNT` in `server.js` (and their corresponding client visuals) if you wish to change timing/round count.
- Edit `BANK` in `server.js` to add other Pooky product URLs. Supply the correct public Shopify URL handle for each item.
- `PORT=5000 npm start` runs the site on port 5000.