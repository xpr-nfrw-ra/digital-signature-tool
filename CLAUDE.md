# Digital Signature Tool

## Project Structure
- `public/` — Client-side files served by Express (HTML, CSS, JS, forge.min.js)
- `server/` — Node.js/Express backend (HTTPS, authentication)
- `data/` — Runtime data (users.json, gitignored)
- `certs/` — SSL certificates (gitignored)

## Running the Project
```
npm install
npm run generate-certs   # one-time: creates self-signed SSL certs
npm start                # starts HTTPS server on port 3443
```
Then open https://localhost:3443 (accept the self-signed cert warning).

## Architecture
- Authentication: Express + bcryptjs + express-session (session-based, secure cookies)
- User storage: JSON file (`data/users.json`) via `server/userStore.js` — swap this file to add a real database
- Crypto operations (signing, verification, key generation): 100% client-side using forge.js
- Private keys never leave the browser

## Key Conventions
- All `userStore.js` functions are async (ready for database migration)
- Auth routes are in `server/auth.js`, mounted at `/api/auth`
- Frontend auth logic is in `public/js/auth.js` — makes fetch() calls to the backend
- No build tools or bundlers — vanilla JS
