"use strict";
// Server-side validation. Never trust the browser: every rule here is enforced again on the server.

const CATEGORIES = ["Electronics", "Documents/ID", "Bags", "Keys", "Clothing", "Books", "Other"];
const TYPES = ["Lost", "Found"];
const STATUSES = ["Open", "Resolved"];
const SUBJECTS = ["Web Dev", "Maths", "Programming", "Other"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[\d\s-]{8,15}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Users live in different time zones, so "today" on the server can be a day behind or ahead of the
// user's own today. Allow dates up to tomorrow (UTC) so nobody gets a false "date is in the future".
function isFuture(s, now = new Date()) {
  const limit = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return s > limit;
}

function validateItem(body, now = new Date()) {
  const b = body && typeof body === "object" ? body : {};
  const errors = {};
  const value = {
    type: clean(b.type),
    name: clean(b.name),
    category: clean(b.category),
    location: clean(b.location),
    date: clean(b.date),
    desc: clean(b.desc),
    contact: clean(b.contact),
  };
  if (!TYPES.includes(value.type)) errors.type = "Type must be Lost or Found.";
  if (value.name.length < 3 || value.name.length > 80) errors.name = "Item name must be 3-80 characters.";
  if (!CATEGORIES.includes(value.category)) errors.category = "Choose a valid category.";
  if (value.location.length < 2 || value.location.length > 80) errors.location = "Location must be 2-80 characters.";
  if (!isRealDate(value.date)) errors.date = "Enter a valid date (YYYY-MM-DD).";
  else if (isFuture(value.date, now)) errors.date = "Date cannot be in the future.";
  if (value.desc.length > 300) errors.desc = "Description must be 300 characters or fewer.";
  if (!(EMAIL_RE.test(value.contact) || PHONE_RE.test(value.contact))) errors.contact = "Enter a valid email or phone number.";
  return { errors, value, ok: Object.keys(errors).length === 0 };
}

function validateTask(body) {
  const b = body && typeof body === "object" ? body : {};
  const errors = {};
  const text = clean(b.text);
  const subject = clean(b.subject) || "Other";
  let steps = b.steps;
  if (typeof steps === "string") steps = steps.split(",");
  if (steps === undefined || steps === null) steps = [];
  if (!Array.isArray(steps)) {
    errors.steps = "Steps must be a list.";
    steps = [];
  }
  steps = steps.map((s) => clean(typeof s === "string" ? s : s && s.text)).filter(Boolean);

  if (text.length < 3 || text.length > 120) errors.text = "Task must be 3-120 characters.";
  if (!SUBJECTS.includes(subject)) errors.subject = "Choose a valid subject.";
  if (steps.length > 10) errors.steps = "Maximum 10 small steps per task.";
  else if (steps.some((s) => s.length > 80)) errors.steps = "Each step must be 80 characters or fewer.";

  return {
    errors,
    ok: Object.keys(errors).length === 0,
    value: { text, subject, steps: steps.map((s) => ({ text: s, done: false })) },
  };
}

function validateCity(city) {
  const c = clean(city);
  if (c.length < 2 || c.length > 60) return { ok: false, error: "City name must be 2-60 characters." };
  if (!/^[\p{L}\p{M}\s.,'-]+$/u.test(c)) return { ok: false, error: "City name contains invalid characters." };
  return { ok: true, value: c };
}

function validateCoords(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (lat === undefined || lon === undefined || lat === "" || lon === "") return { ok: false };
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    return { ok: false, error: "Invalid coordinates." };
  }
  return { ok: true, value: { lat: la, lon: lo } };
}

module.exports = {
  CATEGORIES, TYPES, STATUSES, SUBJECTS,
  isRealDate, isFuture, validateItem, validateTask, validateCity, validateCoords,
};
