"use strict";
// Shared helpers used by every page: API calls, toast messages, safe storage, animations, nav bar.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // The user's own calendar date (NOT UTC) so "today" is correct in every time zone.
  const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  const debounce = (fn, ms = 250) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  // localStorage can throw (private mode, blocked cookies): never let that break the page.
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
  };

  async function api(url, { method = "GET", body } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      const e = new Error("Cannot reach the server. Check your connection or start the server.");
      e.offline = true;
      throw e;
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON body */ }
    if (!res.ok) {
      const e = new Error((data && data.error) || `Request failed (${res.status})`);
      e.status = res.status;
      e.details = data && data.details;
      throw e;
    }
    return data;
  }

  function toast(msg, type = "info") {
    let box = $("#toasts");
    if (!box) {
      box = document.createElement("div");
      box.id = "toasts";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      document.body.appendChild(box);
    }
    const t = document.createElement("div");
    t.className = "toast " + (type === "ok" ? "ok" : type === "bad" ? "bad" : "");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, 3200);
  }

  function countUp(el, to, ms = 700) {
    if (!el) return;
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (from === to) { el.textContent = to; return; }
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function confetti(n = 60) {
    const colors = ["#818cf8", "#f0abfc", "#67e8f9", "#4ade80", "#fbbf24", "#f87171"];
    for (let i = 0; i < n; i++) {
      const c = document.createElement("span");
      c.className = "confetti";
      c.style.left = Math.random() * 100 + "vw";
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 0.5 + "s";
      c.style.animationDuration = 1.4 + Math.random() * 1.2 + "s";
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 3200);
    }
  }

  function reveal() {
    const els = $$(".reveal:not(.in)");
    if (!("IntersectionObserver" in window)) return els.forEach((e) => e.classList.add("in"));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
  }

  function renderNav(active) {
    const links = [
      ["/", "Home", "home"],
      ["/lost-found.html", "🔎 Lost & Found", "lf"],
      ["/weather.html", "🌦️ Weather", "wx"],
      ["/focusflow.html", "🎯 FocusFlow", "ff"],
    ];
    const nav = $("#nav");
    if (!nav) return;
    nav.className = "nav";
    nav.innerHTML = `<div class="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
      <a href="/" class="brand text-lg" style="padding:0">Campus Toolkit</a>
      <nav aria-label="Main" class="flex gap-1 flex-wrap ml-auto">
        ${links.map(([h, t, k]) => `<a href="${h}" class="${k === active ? "active" : ""}" ${k === active ? 'aria-current="page"' : ""}>${t}</a>`).join("")}
      </nav></div>`;
  }

  function addBlobs() {
    if ($(".blob")) return;
    ["b1", "b2", "b3"].forEach((c) => {
      const b = document.createElement("div");
      b.className = "blob " + c;
      b.setAttribute("aria-hidden", "true");
      document.body.prepend(b);
    });
  }

  // Ripple effect on every .btn click
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".btn");
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    const s = document.createElement("span");
    const d = Math.max(r.width, r.height);
    s.style.cssText = `position:absolute;border-radius:50%;background:rgba(255,255,255,.4);pointer-events:none;width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px;transform:scale(0);opacity:.8;transition:transform .5s,opacity .6s`;
    b.appendChild(s);
    requestAnimationFrame(() => { s.style.transform = "scale(2.4)"; s.style.opacity = "0"; });
    setTimeout(() => s.remove(), 650);
  });

  document.addEventListener("DOMContentLoaded", () => { addBlobs(); reveal(); });

  window.App = { $, $$, esc, api, toast, store, localDate, debounce, countUp, confetti, reveal, renderNav };
})();
