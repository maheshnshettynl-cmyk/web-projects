# Campus Toolkit (Full-Stack)

Three real-world projects in one Node.js + Express app:

| Page | Problem it solves | Syllabus topics |
|---|---|---|
| Smart Lost & Found | Students lose things and have no central place to look | Semantic HTML, forms and validation, DOM, Fetch + JSON, Tailwind |
| Weather Safety Advisor | A temperature number is not advice | Fetch API, JSON, loading + error states |
| FocusFlow | Big study goals feel overwhelming | Flexbox/Grid, events, breaking problems into small steps |

## Run it (3 commands)

```bash
npm install
npm start
# open http://localhost:3000
```

Needs Node.js 18 or newer. Data is saved in `data/db.json` (created automatically).

## Run the tests

```bash
npm test
```

## Folder structure

```
server.js          Express app + all REST API routes
lib/validate.js    server-side validation rules
lib/store.js       JSON-file database (atomic writes, corrupt-file recovery)
lib/weather.js     Open-Meteo client, safety-advice engine, 10-minute cache
public/            front end: HTML pages, css/style.css, js/common.js
test/api.test.js   automated tests
```

## API

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/health` | server status |
| GET / POST | `/api/items` | list (q, type, category, status) / create report |
| PATCH / DELETE | `/api/items/:id` | resolve-reopen / delete |
| GET / POST | `/api/tasks` | list (status=all/open/done) / create |
| PATCH / DELETE | `/api/tasks/:id` | toggle / delete |
| PATCH | `/api/tasks/:id/steps/:index` | tick a small step |
| GET | `/api/stats?date=YYYY-MM-DD` | today + last 7 days of focus minutes |
| POST | `/api/stats/session` | save a finished focus session |
| GET | `/api/weather?city=...` or `?lat=..&lon=..` | weather + advice + 5-day forecast |

## Deploy (needs a Node host, not Netlify Drop)

Because there is a backend, use a Node host such as **Render**:

1. Push this folder to a GitHub repository.
2. On render.com choose New, then Web Service, and connect the repo.
3. Build command `npm install`, start command `npm start`.
4. Free plans have a temporary disk, so saved data resets on redeploy. For permanent data, add a Render Disk and set the environment variable `DB_FILE=/var/data/db.json`.

## Debugging notes (bugs found and fixed while building)

- Date bug: `toISOString()` gives the UTC date, so users in India saw the wrong "today" near midnight. The front end now uses the local date and the server allows a one-day tolerance.
- Race condition: a slow old search response could overwrite a newer one. Each page now ignores outdated responses.
- Timer drift: a "subtract 1 each second" timer slows down in background tabs. It now counts to a fixed end time.
- Fog advice wrongly appeared for thunderstorm codes (the old range check was too wide). Now only codes 45 and 48.
- XSS: all user text is escaped before it is shown.
- Crash safety: invalid JSON, oversized bodies, a weather provider outage and a corrupt database file all return clean errors instead of crashing.
