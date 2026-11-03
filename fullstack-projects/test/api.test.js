"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("../server");
const { createStore } = require("../lib/store");
const { createWeatherService, getAdvice } = require("../lib/weather");
const V = require("../lib/validate");

// ---- fake Open-Meteo so tests never touch the internet ----
let providerMode = "ok";
let providerCalls = 0;
const fakeFetch = async (url) => {
  providerCalls++;
  if (providerMode === "down") throw new TypeError("fetch failed");
  if (providerMode === "500") return new Response("boom", { status: 500 });
  if (providerMode === "garbage") return new Response("<html>", { status: 200 });
  const u = String(url);
  if (u.includes("geocoding-api")) {
    if (u.includes("Nowhereville")) return Response.json({});
    return Response.json({ results: [{ name: "Bengaluru", latitude: 12.97, longitude: 77.59, country: "India", admin1: "Karnataka" }] });
  }
  return Response.json({
    current: { temperature_2m: 34.4, relative_humidity_2m: 85, wind_speed_10m: 12, precipitation: 0, weather_code: 1 },
    daily: {
      time: ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"],
      weather_code: [1, 61, 0, 95, 71, 3],
      temperature_2m_max: [35, 30, 33, 28, 2, 31],
      temperature_2m_min: [24, 22, 23, 20, -3, 22],
      precipitation_probability_max: [10, 80, 0, 90, 40, 5],
    },
  });
};

let server, base, tmpDir;
before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-test-"));
  const app = createApp({ store: createStore(path.join(tmpDir, "db.json")), weather: createWeatherService({ fetchFn: fakeFetch }) });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

const call = async (p, method = "GET", body, raw) => {
  const res = await fetch(base + p, { method, headers: body || raw ? { "Content-Type": "application/json" } : undefined, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  let json = null; try { json = await res.json(); } catch (_) { /* html */ }
  return { status: res.status, json, res };
};
const goodItem = (o = {}) => ({ type: "Lost", name: "Blue bottle", category: "Other", location: "Library", date: new Date().toISOString().slice(0, 10), desc: "dent on side", contact: "me@college.edu", ...o });

// ---------------- general ----------------
test("health check works", async () => {
  const r = await call("/api/health");
  assert.equal(r.status, 200); assert.equal(r.json.status, "ok");
});
test("unknown API route returns JSON 404", async () => {
  const r = await call("/api/nope"); assert.equal(r.status, 404); assert.ok(r.json.error);
});
test("security headers are set and x-powered-by is hidden", async () => {
  const r = await call("/api/health");
  assert.equal(r.res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.res.headers.get("x-powered-by"), null);
});
test("invalid JSON body gives 400 not 500", async () => {
  const r = await call("/api/items", "POST", null, "{bad json");
  assert.equal(r.status, 400); assert.match(r.json.error, /JSON/);
});
test("oversized body gives 413", async () => {
  const r = await call("/api/items", "POST", { desc: "x".repeat(30000) });
  assert.equal(r.status, 413);
});
test("static pages are served and unknown page gives 404 page", async () => {
  for (const p of ["/", "/lost-found.html", "/weather.html", "/focusflow.html", "/css/style.css", "/js/common.js"]) {
    const r = await call(p); assert.equal(r.status, 200, p);
  }
  const r = await fetch(base + "/missing.html"); assert.equal(r.status, 404);
});

// ---------------- lost & found ----------------
test("create, list, search, filter, resolve, delete an item", async () => {
  const c = await call("/api/items", "POST", goodItem());
  assert.equal(c.status, 201); const id = c.json.item.id; assert.equal(c.json.item.status, "Open");
  await call("/api/items", "POST", goodItem({ type: "Found", name: "Red umbrella", category: "Other", location: "Gate" }));

  let l = await call("/api/items?q=umbrella"); assert.equal(l.json.items.length, 1);
  l = await call("/api/items?type=Lost"); assert.ok(l.json.items.every((i) => i.type === "Lost"));
  assert.equal(l.json.summary.total, 2);

  const p = await call(`/api/items/${id}`, "PATCH", { status: "Resolved" });
  assert.equal(p.json.item.status, "Resolved");
  l = await call("/api/items?status=Resolved"); assert.equal(l.json.items.length, 1);

  const d = await call(`/api/items/${id}`, "DELETE"); assert.equal(d.status, 200);
  assert.equal((await call(`/api/items/${id}`, "DELETE")).status, 404);
});
test("item validation reports every bad field", async () => {
  const r = await call("/api/items", "POST", { type: "Stolen", name: "x", category: "Pets", location: "", date: "2999-01-01", contact: "nope" });
  assert.equal(r.status, 400);
  for (const k of ["type", "name", "category", "location", "date", "contact"]) assert.ok(r.json.details[k], k);
});
test("fake calendar dates like 2026-02-31 are rejected", async () => {
  const r = await call("/api/items", "POST", goodItem({ date: "2026-02-31" })); assert.equal(r.status, 400);
});
test("HTML in input is stored as plain text (frontend escapes it)", async () => {
  const r = await call("/api/items", "POST", goodItem({ name: "<img src=x onerror=alert(1)>" }));
  assert.equal(r.status, 201); assert.equal(r.json.item.name, "<img src=x onerror=alert(1)>");
});
test("bad ids and bad filters are rejected", async () => {
  assert.equal((await call("/api/items/abc", "PATCH", { status: "Open" })).status, 400);
  assert.equal((await call("/api/items/-5", "DELETE")).status, 400);
  assert.equal((await call("/api/items/999999", "PATCH", { status: "Open" })).status, 404);
  assert.equal((await call("/api/items?type=Hacked")).status, 400);
  const live = (await call("/api/items", "POST", goodItem({ name: "Status probe" }))).json.item;
  assert.equal((await call(`/api/items/${live.id}`, "PATCH", { status: "Weird" })).status, 400);
});
test("a date that is 'tomorrow' in another time zone is accepted", async () => {
  const t = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal((await call("/api/items", "POST", goodItem({ date: t }))).status, 201);
});

// ---------------- focusflow ----------------
test("tasks: create with steps, tick steps, progress, filter, delete", async () => {
  const c = await call("/api/tasks", "POST", { text: "Finish Unit II", subject: "Web Dev", steps: "DOM, Events , Fetch" });
  assert.equal(c.status, 201); const t = c.json.task;
  assert.equal(t.steps.length, 3); assert.equal(t.progress, 0);

  let s = await call(`/api/tasks/${t.id}/steps/0`, "PATCH", { done: true });
  assert.equal(s.json.task.progress, 33);
  await call(`/api/tasks/${t.id}/steps/1`, "PATCH", { done: true });
  s = await call(`/api/tasks/${t.id}/steps/2`, "PATCH", { done: true });
  assert.equal(s.json.task.completed, true); assert.equal(s.json.task.progress, 100);

  assert.equal((await call("/api/tasks?status=done")).json.tasks.length, 1);
  assert.equal((await call("/api/tasks?status=open")).json.tasks.length, 0);
  assert.equal((await call(`/api/tasks/${t.id}`, "DELETE")).status, 200);
});
test("tasks: simple task toggle, and toggling a task with steps is refused", async () => {
  const a = (await call("/api/tasks", "POST", { text: "Read notes" })).json.task;
  assert.equal((await call(`/api/tasks/${a.id}`, "PATCH", { done: true })).json.task.completed, true);
  const b = (await call("/api/tasks", "POST", { text: "Has steps", steps: ["one"] })).json.task;
  assert.equal((await call(`/api/tasks/${b.id}`, "PATCH", { done: true })).status, 400);
  assert.equal((await call(`/api/tasks/${b.id}`, "PATCH", { done: "yes" })).status, 400);
});
test("tasks: validation", async () => {
  assert.equal((await call("/api/tasks", "POST", { text: "ab" })).status, 400);
  assert.equal((await call("/api/tasks", "POST", { text: "Good task", subject: "Cooking" })).status, 400);
  assert.equal((await call("/api/tasks", "POST", { text: "Good task", steps: Array(11).fill("s") })).status, 400);
  assert.equal((await call("/api/tasks", "POST", { text: "Good task", steps: 5 })).status, 400);
  assert.equal((await call("/api/tasks/1/steps/99", "PATCH", { done: true })).status, 404);
  assert.equal((await call("/api/tasks?status=weird")).status, 400);
});
test("stats: record sessions, reject bad input, weekly chart", async () => {
  const day = "2026-11-03";
  assert.equal((await call("/api/stats/session", "POST", { date: day, minutes: 25 })).status, 201);
  const r = await call("/api/stats/session", "POST", { date: day, minutes: 25 });
  assert.deepEqual([r.json.sessions, r.json.minutes], [2, 50]);
  const s = await call(`/api/stats?date=${day}`);
  assert.equal(s.json.week.length, 7); assert.equal(s.json.week[6].date, day); assert.equal(s.json.week[6].minutes, 50);
  assert.equal(s.json.week[0].date, "2026-10-28");
  assert.equal((await call("/api/stats/session", "POST", { date: day, minutes: 0 })).status, 400);
  assert.equal((await call("/api/stats/session", "POST", { date: day, minutes: 25.5 })).status, 400);
  assert.equal((await call("/api/stats/session", "POST", { date: "bad", minutes: 25 })).status, 400);
  assert.equal((await call("/api/stats")).status, 400);
});

// ---------------- weather ----------------
test("weather by city returns data, advice and 5-day forecast", async () => {
  providerMode = "ok";
  const r = await call("/api/weather?city=Bengaluru");
  assert.equal(r.status, 200);
  assert.equal(r.json.location.name, "Bengaluru"); assert.equal(r.json.current.temp, 34);
  assert.equal(r.json.forecast.length, 5);
  assert.ok(r.json.advice.some((a) => /Hot day/.test(a.text)));
  assert.ok(r.json.advice.some((a) => /humid/i.test(a.text)));
});
test("weather results are cached (provider called once for repeat searches)", async () => {
  providerCalls = 0;
  await call("/api/weather?lat=10.5&lon=20.5");
  const r = await call("/api/weather?lat=10.5&lon=20.5");
  assert.equal(r.json.cached, true); assert.equal(providerCalls, 1);
});
test("weather by coordinates works; bad input is rejected", async () => {
  assert.equal((await call("/api/weather?lat=12.9&lon=77.5")).status, 200);
  assert.equal((await call("/api/weather?lat=999&lon=0")).status, 400);
  assert.equal((await call("/api/weather?lat=abc&lon=0")).status, 400);
  assert.equal((await call("/api/weather")).status, 400);
  assert.equal((await call("/api/weather?city=" + encodeURIComponent("<script>"))).status, 400);
  assert.equal((await call("/api/weather?city=a")).status, 400);
});
test("weather: unknown city gives 404 with a friendly message", async () => {
  providerMode = "ok";
  const r = await call("/api/weather?city=Nowhereville");
  assert.equal(r.status, 404); assert.match(r.json.error, /not found/i);
});
test("weather: provider down / error / garbage gives 502, never a crash", async () => {
  for (const mode of ["down", "500", "garbage"]) {
    providerMode = mode;
    const r = await call("/api/weather?city=Chennai");
    assert.equal(r.status, 502, mode); assert.ok(r.json.error);
  }
  providerMode = "ok";
});
test("advice rules", () => {
  const has = (o, re) => getAdvice(o).some((a) => re.test(a.text));
  assert.ok(has({ temp: 40, wind: 5, code: 0, humidity: 20 }, /Extreme heat/));
  assert.ok(has({ temp: 22, wind: 50, code: 0, humidity: 20 }, /Strong winds/));
  assert.ok(has({ temp: 22, wind: 5, code: 96, humidity: 20 }, /Thunderstorm/));
  assert.ok(has({ temp: 5, wind: 5, code: 0, humidity: 20 }, /Cold/));
  assert.ok(has({ temp: 22, wind: 5, code: 45, humidity: 20 }, /Fog/));
  assert.ok(has({ temp: 22, wind: 5, code: 0, humidity: 20 }, /comfortable/));
  assert.ok(!has({ temp: 22, wind: 5, code: 95, humidity: 20 }, /Fog/), "thunderstorm code 95 must not trigger fog advice");
});

// ---------------- unit: validation + store ----------------
test("validateCity / validateCoords", () => {
  assert.equal(V.validateCity("São Paulo").ok, true);
  assert.equal(V.validateCity("New York, NY").ok, true);
  assert.equal(V.validateCity("x").ok, false);
  assert.equal(V.validateCoords("0", "0").ok, true);
  assert.equal(V.validateCoords(undefined, "5").ok, false);
});
test("store saves to disk and reloads", async () => {
  const f = path.join(tmpDir, "persist.json");
  const a = createStore(f); a.db.items.push({ id: a.nextId(), name: "kept" }); await a.save(); await a.flush();
  const b = createStore(f);
  assert.equal(b.db.items[0].name, "kept"); assert.equal(b.nextId(), 2);
});
test("corrupt db file is backed up and the server still starts", () => {
  const f = path.join(tmpDir, "corrupt.json"); fs.writeFileSync(f, "{ not json");
  const s = createStore(f);
  assert.deepEqual(s.db.items, []);
  assert.ok(fs.readdirSync(tmpDir).some((n) => n.startsWith("corrupt.json.corrupt-")));
});
