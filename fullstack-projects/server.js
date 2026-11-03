"use strict";
const express = require("express");
const path = require("path");
const { createStore } = require("./lib/store");
const { createWeatherService, HttpError } = require("./lib/weather");
const V = require("./lib/validate");

// ---------- small helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Invalid id.");
  return id;
}

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 5000) hits.clear();
      return next();
    }
    rec.count++;
    if (rec.count > max) {
      res.set("Retry-After", String(Math.ceil((rec.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }
    next();
  };
}

function lastNDates(endDate, n) {
  const end = new Date(endDate + "T00:00:00Z");
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

const decorateTask = (t) => {
  const done = t.steps.filter((s) => s.done).length;
  return {
    ...t,
    completed: t.steps.length ? done === t.steps.length : t.done,
    progress: t.steps.length ? Math.round((done / t.steps.length) * 100) : t.done ? 100 : 0,
  };
};

// ---------- app factory (so tests can create isolated apps) ----------
function createApp({ store, weather } = {}) {
  store = store || createStore(process.env.DB_FILE || path.join(__dirname, "data", "db.json"), { seed: true });
  weather = weather || createWeatherService();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    next();
  });
  app.use(express.json({ limit: "20kb" }));
  app.use("/api", rateLimit({ windowMs: 60_000, max: 300 }));

  const api = express.Router();

  api.get("/health", (req, res) => res.json({ status: "ok", uptime: Math.round(process.uptime()) }));

  // ===== Lost & Found =====
  api.get("/items", (req, res) => {
    const { q = "", type = "", category = "", status = "" } = req.query;
    if (type && !V.TYPES.includes(type)) throw new HttpError(400, "Invalid type filter.");
    if (category && !V.CATEGORIES.includes(category)) throw new HttpError(400, "Invalid category filter.");
    if (status && !V.STATUSES.includes(status)) throw new HttpError(400, "Invalid status filter.");
    const all = store.db.items;
    const needle = String(q).trim().toLowerCase().slice(0, 80);
    const items = all
      .filter((i) =>
        (!type || i.type === type) && (!category || i.category === category) && (!status || i.status === status) &&
        (!needle || [i.name, i.location, i.desc, i.category].join(" ").toLowerCase().includes(needle)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    res.json({
      items,
      summary: {
        total: all.length,
        lost: all.filter((i) => i.type === "Lost").length,
        found: all.filter((i) => i.type === "Found").length,
        resolved: all.filter((i) => i.status === "Resolved").length,
      },
    });
  });

  api.post("/items", (req, res) => {
    const { errors, value, ok } = V.validateItem(req.body);
    if (!ok) return res.status(400).json({ error: "Please fix the highlighted fields.", details: errors });
    const item = { id: store.nextId(), ...value, status: "Open", createdAt: new Date().toISOString() };
    store.db.items.push(item);
    store.save();
    res.status(201).json({ item });
  });

  api.patch("/items/:id", (req, res) => {
    const id = parseId(req.params.id);
    const item = store.db.items.find((i) => i.id === id);
    if (!item) throw new HttpError(404, "Item not found.");
    const status = req.body && req.body.status;
    if (!V.STATUSES.includes(status)) throw new HttpError(400, "Status must be Open or Resolved.");
    item.status = status;
    store.save();
    res.json({ item });
  });

  api.delete("/items/:id", (req, res) => {
    const id = parseId(req.params.id);
    const idx = store.db.items.findIndex((i) => i.id === id);
    if (idx === -1) throw new HttpError(404, "Item not found.");
    store.db.items.splice(idx, 1);
    store.save();
    res.json({ deleted: id });
  });

  // ===== FocusFlow: tasks =====
  api.get("/tasks", (req, res) => {
    const status = req.query.status || "all";
    if (!["all", "open", "done"].includes(status)) throw new HttpError(400, "Invalid status filter.");
    const all = store.db.tasks.map(decorateTask);
    const tasks = all.filter((t) => status === "all" || (status === "done" ? t.completed : !t.completed));
    res.json({
      tasks,
      summary: {
        total: all.length,
        done: all.filter((t) => t.completed).length,
        progress: all.length ? Math.round(all.reduce((a, t) => a + t.progress, 0) / all.length) : 0,
      },
    });
  });

  api.post("/tasks", (req, res) => {
    const { errors, value, ok } = V.validateTask(req.body);
    if (!ok) return res.status(400).json({ error: "Please fix the highlighted fields.", details: errors });
    const task = { id: store.nextId(), ...value, done: false, createdAt: new Date().toISOString() };
    store.db.tasks.unshift(task);
    store.save();
    res.status(201).json({ task: decorateTask(task) });
  });

  api.patch("/tasks/:id", (req, res) => {
    const id = parseId(req.params.id);
    const task = store.db.tasks.find((t) => t.id === id);
    if (!task) throw new HttpError(404, "Task not found.");
    if (typeof (req.body && req.body.done) !== "boolean") throw new HttpError(400, "'done' must be true or false.");
    if (task.steps.length) throw new HttpError(400, "This task has small steps. Tick the steps instead.");
    task.done = req.body.done;
    store.save();
    res.json({ task: decorateTask(task) });
  });

  api.patch("/tasks/:id/steps/:index", (req, res) => {
    const id = parseId(req.params.id);
    const task = store.db.tasks.find((t) => t.id === id);
    if (!task) throw new HttpError(404, "Task not found.");
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= task.steps.length) throw new HttpError(404, "Step not found.");
    if (typeof (req.body && req.body.done) !== "boolean") throw new HttpError(400, "'done' must be true or false.");
    task.steps[idx].done = req.body.done;
    store.save();
    res.json({ task: decorateTask(task) });
  });

  api.delete("/tasks/:id", (req, res) => {
    const id = parseId(req.params.id);
    const idx = store.db.tasks.findIndex((t) => t.id === id);
    if (idx === -1) throw new HttpError(404, "Task not found.");
    store.db.tasks.splice(idx, 1);
    store.save();
    res.json({ deleted: id });
  });

  // ===== FocusFlow: focus session stats =====
  const dayStats = (date) => store.db.sessions[date] || { sessions: 0, minutes: 0 };

  api.get("/stats", (req, res) => {
    const date = req.query.date;
    if (!V.isRealDate(date)) throw new HttpError(400, "Query 'date' must look like YYYY-MM-DD.");
    res.json({
      date,
      ...dayStats(date),
      week: lastNDates(date, 7).map((d) => ({ date: d, minutes: dayStats(d).minutes })),
    });
  });

  api.post("/stats/session", (req, res) => {
    const { date, minutes } = req.body || {};
    if (!V.isRealDate(date)) throw new HttpError(400, "'date' must look like YYYY-MM-DD.");
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) throw new HttpError(400, "'minutes' must be a whole number from 1 to 180.");
    const cur = dayStats(date);
    store.db.sessions[date] = { sessions: cur.sessions + 1, minutes: cur.minutes + minutes };
    store.save();
    res.status(201).json({ date, ...store.db.sessions[date] });
  });

  // ===== Weather =====
  api.get("/weather", rateLimit({ windowMs: 60_000, max: 30 }), wrap(async (req, res) => {
    const coords = V.validateCoords(req.query.lat, req.query.lon);
    if (coords.error) throw new HttpError(400, coords.error);
    let result;
    if (coords.ok) {
      result = await weather.forByCoords(coords.value.lat, coords.value.lon);
    } else {
      const city = V.validateCity(req.query.city);
      if (!city.ok) throw new HttpError(400, city.error);
      result = await weather.forByCity(city.value);
    }
    res.json(result);
  }));

  api.use((req, res) => res.status(404).json({ error: "API route not found." }));
  app.use("/api", api);

  app.use(express.static(path.join(__dirname, "public")));
  app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "404.html")));

  // Central error handler: always JSON, never a stack trace.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err.type === "entity.parse.failed") { status = 400; message = "Request body is not valid JSON."; }
    if (err.type === "entity.too.large") { status = 413; message = "Request body is too large."; }
    if (status >= 500) { console.error("[error]", err); message = status === 500 ? "Something went wrong on the server." : message; }
    if (req.path.startsWith("/api")) return res.status(status).json({ error: message });
    res.status(status).send(message);
  });

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const store = createStore(process.env.DB_FILE || path.join(__dirname, "data", "db.json"), { seed: true });
  const app = createApp({ store });
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => console.log(`Server running → http://localhost:${port}`));
  const shutdown = async () => {
    console.log("Shutting down…");
    server.close();
    await store.flush();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
