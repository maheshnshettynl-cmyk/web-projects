"use strict";
// Tiny JSON-file database. Zero native dependencies, so it installs anywhere.
// Writes are queued and atomic (write temp file, then rename) so a crash can't corrupt the data.

const fs = require("fs");
const path = require("path");

const EMPTY = () => ({ nextId: 1, items: [], tasks: [], sessions: {} });

function createStore(file, { seed = false } = {}) {
  let db = EMPTY();
  let writing = Promise.resolve();

  if (file && fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      db = { ...EMPTY(), ...parsed };
    } catch (err) {
      // Corrupt file: keep a backup and start fresh instead of crashing the server.
      const backup = `${file}.corrupt-${Date.now()}`;
      try { fs.renameSync(file, backup); } catch (_) { /* ignore */ }
      console.error(`[store] Could not read ${file} (${err.message}). Backed up to ${backup}.`);
    }
  } else if (seed) {
    const today = new Date().toISOString().slice(0, 10);
    db.items.push(
      { id: db.nextId++, type: "Lost", name: "Black backpack", category: "Bags", location: "Canteen", date: today, desc: "Has a red keychain.", contact: "9876543210", status: "Open", createdAt: new Date().toISOString() },
      { id: db.nextId++, type: "Found", name: "Student ID card", category: "Documents/ID", location: "Main gate", date: today, desc: "Name starts with R.", contact: "security@college.edu", status: "Open", createdAt: new Date().toISOString() }
    );
  }

  function persist() {
    if (!file) return writing;
    const snapshot = JSON.stringify(db, null, 2);
    writing = writing.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.promises.writeFile(tmp, snapshot);
        await fs.promises.rename(tmp, file);
      } catch (err) {
        console.error("[store] write failed:", err.message);
      }
    });
    return writing;
  }

  return {
    get db() { return db; },
    nextId: () => db.nextId++,
    save: persist,
    flush: () => writing,
  };
}

module.exports = { createStore };
