// Concordia Events Board — frontend (vanilla JS, hash routing)
const TZ = "America/Montreal";
const $ = (s, root = document) => root.querySelector(s);
const view = $("#view");

const state = {
  meta: null,
  me: null,             // { user, managed_clubs, following } or { user: null }
  events: [],
  filters: { q: "", course: "", campus: "", building: "", when: "", category: "" },
};
const loggedIn = () => !!state.me?.user;

// ---------- utils ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
function dayLabel(iso) {
  const k = dayKey(iso);
  const pretty = new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" });
  if (k === dayKey(new Date().toISOString())) return `Today · ${pretty}`;
  if (k === dayKey(new Date(Date.now() + 86400e3).toISOString())) return `Tomorrow · ${pretty}`;
  return pretty;
}
const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const safeUrl = (u) => { try { const x = new URL(u.startsWith("http") ? u : `https://${u}`); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}
function showError(el, msg) { el.textContent = msg; el.hidden = !msg; }

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.status = res.status; throw err; }
  return data;
}
async function refreshMe() {
  state.me = await api("/api/me");
  renderUserSlot();
}

// ---------- header ----------
function renderUserSlot() {
  const slot = $("#userSlot");
  if (loggedIn()) {
    const u = state.me.user;
    slot.innerHTML = `<a class="avatar" href="#/me" title="${esc(u.name)}">${esc(initials(u.name))}</a>`;
  } else {
    slot.innerHTML = `<button class="btn ghost-light" data-action="login">Log in</button>`;
  }
}
function setActiveNav(name) {
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
}

// ---------- dialogs ----------
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) d.close();
}));

let authMode = "login", afterAuth = null;
function openAuth(mode = "login", reason = "", then = null) {
  authMode = mode; afterAuth = then;
  const f = $("#authForm");
  f.reset();
  showError($("#authError"), "");
  $("#authReason").textContent = reason; $("#authReason").hidden = !reason;
  const signup = mode === "signup";
  $("#authTitle").textContent = signup ? "Create your account" : "Log in";
  $("#authSubmit").textContent = signup ? "Sign up" : "Log in";
  f.querySelector("[data-signup]").hidden = !signup;
  f.password.autocomplete = signup ? "new-password" : "current-password";
  const domains = state.meta?.allowed_domains || [];
  f.email.placeholder = domains.length ? `you@${domains[0]}` : "you@live.concordia.ca";
  $("#authSwitch").innerHTML = signup
    ? `Already have an account? <a href="#" data-auth-switch="login">Log in</a>`
    : `New here? <a href="#" data-auth-switch="signup">Create an account</a>`;
  if (!$("#authDialog").open) $("#authDialog").showModal();
  (signup ? f.name : f.email).focus();
}
$("#authSwitch").addEventListener("click", (e) => {
  const a = e.target.closest("[data-auth-switch]");
  if (a) { e.preventDefault(); openAuth(a.dataset.authSwitch, $("#authReason").textContent, afterAuth); }
});
$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  try {
    await api(`/api/auth/${authMode}`, { method: "POST", body });
    $("#authDialog").close();
    await refreshMe();
    toast(authMode === "signup" ? `Welcome, ${state.me.user.name}!` : "Logged in");
    const fn = afterAuth; afterAuth = null;
    if (fn) fn(); else route();
  } catch (err) { showError($("#authError"), err.message); }
});
// Run fn if logged in, otherwise ask to log in first and then run it
function needLogin(reason, fn) {
  if (loggedIn()) return fn();
  openAuth("login", reason, fn);
}

function openPost(clubId = "") {
  needLogin("Log in to post an event.", () => {
    const f = $("#postForm");
    f.reset();
    showError($("#postError"), "");
    const clubs = state.me.managed_clubs || [];
    $("#fPostAs").innerHTML = `<option value="">Myself (${esc(state.me.user.name)})</option>` +
      clubs.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    $("#fPostAs").closest("label").hidden = !clubs.length;
    $("#fPostAs").value = String(clubId || "");
    if (clubId) f.category.value = "Club";
    const start = new Date(); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);
    f.starts_at.value = toLocalInput(start);
    f.ends_at.value = toLocalInput(new Date(start.getTime() + 2 * 3600e3));
    $("#postDialog").showModal();
    f.title.focus();
  });
}
$("#openPost").onclick = () => {
  const m = location.hash.match(/^#\/c\/([\w-]+)/);
  const club = m && state.me?.managed_clubs?.find((c) => c.slug === m[1]);
  openPost(club ? club.id : "");
};
$("#postForm").starts_at.addEventListener("change", (e) => {
  const s = new Date(e.target.value), end = $("#postForm").ends_at;
  if (!isNaN(s) && (!end.value || new Date(end.value) <= s)) end.value = toLocalInput(new Date(s.getTime() + 2 * 3600e3));
});
$("#postForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  body.starts_at = body.starts_at ? new Date(body.starts_at).toISOString() : "";
  body.ends_at = body.ends_at ? new Date(body.ends_at).toISOString() : "";
  const btn = $("#postSubmit");
  btn.disabled = true; btn.textContent = "Posting…";
  try {
    const ev = await api("/api/events", { method: "POST", body });
    $("#postDialog").close();
    toast("Event posted!");
    location.hash = `#/e/${ev.id}`;
  } catch (err) { showError($("#postError"), err.message); }
  finally { btn.disabled = false; btn.textContent = "Post event"; }
});

function openCreateClub() {
  needLogin("Log in to create a club.", () => {
    $("#clubForm").reset();
    showError($("#clubError"), "");
    $("#clubDialog").showModal();
    $("#clubForm").name.focus();
  });
}
$("#clubForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const club = await api("/api/clubs", { method: "POST", body: Object.fromEntries(new FormData(e.target).entries()) });
    $("#clubDialog").close();
    await refreshMe();
    toast("Club created!");
    location.hash = `#/c/${club.slug}`;
  } catch (err) { showError($("#clubError"), err.message); }
});

// ---------- event cards ----------
function eventCard(e, { highlight = false } = {}) {
  const live = new Date(e.starts_at) <= Date.now() && new Date(e.ends_at) >= Date.now();
  const floor = e.floor ? ` · ${esc(/floor/i.test(e.floor) ? e.floor : e.floor + " floor")}` : "";
  const where = e.building === "ONLINE" || e.building === "OTHER"
    ? esc(e.building_name)
    : `${esc(e.building)} building${floor}${e.room ? ` · room ${esc(e.room)}` : ""} <small>(${esc(e.campus)})</small>`;
  const full = e.capacity && e.going >= e.capacity;
  const by = e.club
    ? `<a href="#/c/${esc(e.club.slug)}" class="club-link">${esc(e.club.name)}</a>`
    : esc(e.organizer);
  return `
    <article class="card ${highlight ? "highlight" : ""}" id="ev-${e.id}">
      <div class="time">
        <div class="start">${fmtTime(e.starts_at)}</div>
        <div class="end">to ${fmtTime(e.ends_at)}</div>
        ${live ? `<span class="live">LIVE</span>` : ""}
      </div>
      <div>
        <div class="meta">
          ${e.course ? `<span class="badge">${esc(e.course)}</span>` : ""}
          <span class="badge cat">${esc(e.category)}</span>
        </div>
        <h3><a href="#/e/${e.id}">${esc(e.title)}</a></h3>
        <div class="where">📍 ${where}</div>
        ${e.location_note ? `<div class="by">${esc(e.location_note)}</div>` : ""}
        ${e.description ? `<p class="desc ${highlight ? "" : "clamp"}" data-desc>${esc(e.description)}</p>` : ""}
        <div class="by">By ${by}${e.contact ? ` · ${esc(e.contact)}` : ""}</div>
        <div class="actions">
          <button class="btn small ${e.is_going ? "on" : ""}" data-rsvp="${e.id}" ${full && !e.is_going ? "disabled" : ""}>
            ${e.is_going ? "✓ Going" : full ? "Full" : "I'm going"} · ${e.going}${e.capacity ? `/${e.capacity}` : ""}
          </button>
          <a class="btn small" href="/api/events/${e.id}/ics">Add to calendar</a>
          <button class="btn small" data-share="${e.id}">Share</button>
          ${e.can_delete ? `<button class="btn small danger" data-del="${e.id}">Delete</button>` : ""}
        </div>
      </div>
    </article>`;
}
function eventList(events, emptyHtml) {
  if (!events.length) return `<div class="empty">${emptyHtml}</div>`;
  let html = "", last = "";
  for (const e of events) {
    const k = dayKey(e.starts_at);
    if (k !== last) { html += `<h2 class="day">${esc(dayLabel(e.starts_at))}</h2>`; last = k; }
    html += eventCard(e);
  }
  return html;
}
const eventsById = new Map();
const remember = (list) => { list.forEach((e) => eventsById.set(e.id, e)); return list; };

// ---------- views ----------
async function viewEvents(feed) {
  setActiveNav("events");
  const f = state.filters;
  const tabs = [["", "All events", "#/"], ["following", "Following", "#/following"], ["going", "I'm going", "#/going"]];
  view.innerHTML = `
    <div class="tabs">${tabs.map(([k, label, href]) => `<a href="${href}" class="${k === feed ? "active" : ""}">${label}</a>`).join("")}</div>
    <section class="filters" aria-label="Filters">
      <input id="q" type="search" placeholder="Search events or clubs…" value="${esc(f.q)}" />
      <input id="course" type="search" placeholder="Course, e.g. COMP 348" value="${esc(f.course)}" />
      <select id="campus"><option value="">All campuses</option><option>SGW</option><option>Loyola</option><option>Online</option></select>
      <select id="building"><option value="">All buildings</option>${buildingOptions()}</select>
      <select id="when"><option value="">Any time</option><option value="today">Today</option><option value="week">Next 7 days</option></select>
    </section>
    <div class="chips">${["", ...state.meta.categories].map((c) =>
      `<button class="chip" data-cat="${esc(c)}" aria-pressed="${c === f.category}">${esc(c || "All")}</button>`).join("")}</div>
    <p class="count" id="count"></p>
    <section id="list"><div class="empty">Loading…</div></section>`;
  $("#campus").value = f.campus; $("#building").value = f.building; $("#when").value = f.when;

  let t;
  const onChange = () => {
    Object.assign(f, { q: $("#q").value.trim(), course: $("#course").value.trim(), campus: $("#campus").value, building: $("#building").value, when: $("#when").value });
    load();
  };
  ["#q", "#course"].forEach((s) => $(s).addEventListener("input", () => { clearTimeout(t); t = setTimeout(onChange, 250); }));
  ["#campus", "#building", "#when"].forEach((s) => $(s).addEventListener("change", onChange));
  view.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
    f.category = b.dataset.cat;
    view.querySelectorAll("[data-cat]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    load();
  }));

  async function load() {
    if (feed && !loggedIn()) {
      $("#count").textContent = "";
      $("#list").innerHTML = `<div class="empty"><strong>${feed === "following" ? "See events from clubs you follow" : "Keep track of events you're going to"}</strong><br/>
        <button class="btn primary" data-action="signup" style="margin-top:12px">Create a free account</button>
        <button class="btn" data-action="login" style="margin-top:12px">Log in</button></div>`;
      return;
    }
    const p = new URLSearchParams();
    if (feed) p.set("feed", feed);
    for (const k of ["q", "course", "campus", "building", "category"]) if (f[k]) p.set(k, f[k]);
    if (f.when === "today") { const d = new Date(); d.setHours(23, 59, 59, 999); p.set("before", d.toISOString()); }
    if (f.when === "week") p.set("before", new Date(Date.now() + 7 * 86400e3).toISOString());
    try {
      const events = remember(await api(`/api/events?${p}`));
      $("#count").textContent = events.length ? `${events.length} upcoming event${events.length === 1 ? "" : "s"}` : "";
      let empty = `<strong>No events match.</strong><br/>Be the first — post a study session or exam prep!`;
      if (feed === "following") empty = state.me.following.length
        ? `<strong>No upcoming events from the clubs you follow.</strong><br/><a href="#/clubs">Find more clubs →</a>`
        : `<strong>You're not following any clubs yet.</strong><br/><a class="btn primary" href="#/clubs" style="margin-top:12px">Browse clubs</a>`;
      if (feed === "going") empty = `<strong>You haven't RSVP'd to anything yet.</strong><br/>Tap "I'm going" on an event to save it here.`;
      $("#list").innerHTML = eventList(events, empty);
    } catch (err) { $("#list").innerHTML = `<div class="empty">Couldn't load events: ${esc(err.message)}</div>`; }
  }
  view._reload = load;
  await load();
}

function buildingOptions() {
  const groups = {};
  state.meta.buildings.forEach((b) => (groups[b.campus] ||= []).push(b));
  return Object.entries(groups).map(([campus, list]) =>
    `<optgroup label="${esc(campus)}">${list.map((b) =>
      `<option value="${b.code}">${["ONLINE", "OTHER"].includes(b.code) ? esc(b.name) : `${b.code} — ${esc(b.name)}`}</option>`).join("")}</optgroup>`).join("");
}

function clubCard(c) {
  return `
    <article class="club-card">
      <a href="#/c/${esc(c.slug)}" class="club-avatar">${esc(initials(c.name))}</a>
      <div class="club-body">
        <h3><a href="#/c/${esc(c.slug)}">${esc(c.name)}</a></h3>
        <div class="muted small">${esc(c.type)} · ${c.followers} follower${c.followers === 1 ? "" : "s"} · ${c.upcoming} upcoming</div>
        ${c.description ? `<p class="club-desc">${esc(c.description)}</p>` : ""}
      </div>
      ${followButton(c)}
    </article>`;
}
function followButton(c) {
  if (c.my_role) return `<span class="pill">${c.my_role === "owner" ? "Owner" : "Admin"}</span>`;
  return `<button class="btn small ${c.is_following ? "on" : "primary"}" data-follow="${esc(c.slug)}" data-following="${c.is_following ? 1 : 0}">
    ${c.is_following ? "✓ Following" : "Follow"}</button>`;
}

async function viewClubs() {
  setActiveNav("clubs");
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Clubs</h1><p class="muted">Follow clubs to get their events in your Following feed.</p></div>
      <button class="btn primary" data-action="create-club">+ Create a club</button>
    </div>
    <section class="filters two">
      <input id="cq" type="search" placeholder="Search clubs…" />
      <select id="ctype"><option value="">All types</option>${state.meta.club_types.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
    </section>
    <section id="clubList" class="club-grid"><div class="empty">Loading…</div></section>`;
  let t;
  async function load() {
    const p = new URLSearchParams();
    if ($("#cq").value.trim()) p.set("q", $("#cq").value.trim());
    if ($("#ctype").value) p.set("type", $("#ctype").value);
    const clubs = await api(`/api/clubs?${p}`);
    $("#clubList").innerHTML = clubs.length ? clubs.map(clubCard).join("")
      : `<div class="empty"><strong>No clubs yet.</strong><br/>Start one — it takes 30 seconds.</div>`;
  }
  $("#cq").addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); });
  $("#ctype").addEventListener("change", load);
  view._reload = load;
  await load();
}

async function viewClub(slug) {
  setActiveNav("clubs");
  let club;
  try { club = await api(`/api/clubs/${encodeURIComponent(slug)}`); }
  catch { view.innerHTML = `<div class="empty"><strong>Club not found.</strong><br/><a href="#/clubs">Back to clubs</a></div>`; return; }
  const events = remember(await api(`/api/events?club=${encodeURIComponent(slug)}`));
  const link = club.links && safeUrl(club.links);
  const canManage = !!club.my_role || state.me?.user?.is_site_admin;

  view.innerHTML = `
    <p class="crumbs"><a href="#/clubs">← All clubs</a></p>
    <section class="club-hero">
      <div class="club-avatar big">${esc(initials(club.name))}</div>
      <div class="club-body">
        <h1>${esc(club.name)}</h1>
        <div class="muted">${esc(club.type)} · <strong>${club.followers}</strong> follower${club.followers === 1 ? "" : "s"} · ${club.upcoming} upcoming event${club.upcoming === 1 ? "" : "s"}</div>
        ${club.description ? `<p class="club-about">${esc(club.description)}</p>` : ""}
        ${link ? `<p><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(club.links)} ↗</a></p>` : ""}
      </div>
      <div class="hero-actions">
        ${club.my_role ? `<button class="btn primary" data-action="post-club" data-club-id="${club.id}">+ Post event</button>` : ""}
        ${club.my_role ? "" : followButton(club)}
      </div>
    </section>
    ${canManage ? managePanel(club) : ""}
    <h2 class="section-title">Upcoming events</h2>
    ${eventList(events, `<strong>No upcoming events.</strong>${club.my_role ? "<br/>Post one so your followers see it." : "<br/>Follow to see new events in your feed."}`)}`;

  if (canManage) wireManagePanel(club);
  view._reload = () => viewClub(slug);
}

function managePanel(club) {
  const isOwner = club.my_role === "owner" || state.me?.user?.is_site_admin;
  return `
    <details class="panel">
      <summary>Manage club</summary>
      <form id="editClub" class="dlg-inline">
        <div class="row">
          <label><span>Type</span><select name="type">${state.meta.club_types.map((t) => `<option ${t === club.type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <label><span>Link</span><input name="links" maxlength="200" value="${esc(club.links || "")}" /></label>
        </div>
        <label><span>About</span><textarea name="description" rows="3" maxlength="1500">${esc(club.description || "")}</textarea></label>
        <div><button class="btn primary small" type="submit">Save</button></div>
      </form>
      <h3 class="sub">Admins</h3>
      <ul class="admins">
        ${(club.admins || []).map((a) => `<li><span>${esc(a.name)} <span class="muted small">${esc(a.email)}</span></span>
          ${a.role === "owner" ? `<span class="pill">Owner</span>` : (isOwner || a.id === state.me.user.id)
            ? `<button class="btn small danger" data-remove-admin="${a.id}">${a.id === state.me.user.id ? "Leave" : "Remove"}</button>` : `<span class="pill">Admin</span>`}</li>`).join("")}
      </ul>
      ${isOwner ? `<form id="addAdmin" class="inline-form">
        <input name="email" type="email" placeholder="Add admin by email (they need an account)" required />
        <button class="btn small" type="submit">Add</button>
      </form>` : ""}
    </details>`;
}
function wireManagePanel(club) {
  $("#editClub")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api(`/api/clubs/${club.slug}`, { method: "PATCH", body: Object.fromEntries(new FormData(e.target).entries()) }); toast("Saved"); viewClub(club.slug); }
    catch (err) { toast(err.message); }
  });
  $("#addAdmin")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api(`/api/clubs/${club.slug}/admins`, { method: "POST", body: { email: e.target.email.value } }); toast("Admin added"); await viewClub(club.slug); $(".panel").open = true; }
    catch (err) { toast(err.message); }
  });
  view.querySelectorAll("[data-remove-admin]").forEach((b) => b.addEventListener("click", async () => {
    try {
      await api(`/api/clubs/${club.slug}/admins/${b.dataset.removeAdmin}`, { method: "DELETE" });
      await refreshMe(); toast("Removed"); viewClub(club.slug);
    } catch (err) { toast(err.message); }
  }));
}

async function viewEvent(id) {
  setActiveNav("events");
  try {
    const e = await api(`/api/events/${encodeURIComponent(id)}`);
    eventsById.set(e.id, e);
    view.innerHTML = `<p class="crumbs"><a href="#/">← All events</a></p>
      <h2 class="day">${esc(dayLabel(e.starts_at))}</h2>${eventCard(e, { highlight: true })}`;
  } catch {
    view.innerHTML = `<div class="empty"><strong>This event doesn't exist anymore.</strong><br/><a href="#/">Back to events</a></div>`;
  }
  view._reload = () => viewEvent(id);
}

async function viewMe() {
  setActiveNav("");
  if (!loggedIn()) { view.innerHTML = `<div class="empty"><strong>You're not logged in.</strong><br/><button class="btn primary" data-action="login" style="margin-top:12px">Log in</button></div>`; return; }
  const { user, managed_clubs, following } = state.me;
  const mine = remember(await api("/api/events?feed=mine"));
  view.innerHTML = `
    <section class="club-hero">
      <div class="club-avatar big">${esc(initials(user.name))}</div>
      <div class="club-body"><h1>${esc(user.name)}</h1><div class="muted">${esc(user.email)}</div></div>
      <div class="hero-actions"><button class="btn" data-action="logout">Log out</button></div>
    </section>
    <div class="cols">
      <section>
        <h2 class="section-title">Clubs you run</h2>
        ${managed_clubs.length ? `<ul class="link-list">${managed_clubs.map((c) => `<li><a href="#/c/${esc(c.slug)}">${esc(c.name)}</a> <span class="pill">${c.role === "owner" ? "Owner" : "Admin"}</span></li>`).join("")}</ul>`
          : `<p class="muted">None yet.</p>`}
        <button class="btn small" data-action="create-club">+ Create a club</button>
      </section>
      <section>
        <h2 class="section-title">Following (${following.length})</h2>
        ${following.length ? `<ul class="link-list">${following.map((c) => `<li><a href="#/c/${esc(c.slug)}">${esc(c.name)}</a>
            <button class="btn small" data-follow="${esc(c.slug)}" data-following="1">Unfollow</button></li>`).join("")}</ul>`
          : `<p class="muted">You're not following any clubs. <a href="#/clubs">Browse clubs →</a></p>`}
      </section>
    </div>
    <h2 class="section-title">Your upcoming posts</h2>
    ${eventList(mine, "You haven't posted any upcoming events.")}`;
  view._reload = viewMe;
}

// ---------- global click actions ----------
document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("[data-action],[data-rsvp],[data-share],[data-del],[data-desc],[data-follow]");
  if (!t) return;

  if (t.dataset.desc !== undefined) { t.classList.toggle("clamp"); return; }

  const action = t.dataset.action;
  if (action === "login") return openAuth("login");
  if (action === "signup") return openAuth("signup");
  if (action === "create-club") return openCreateClub();
  if (action === "post-club") return openPost(t.dataset.clubId);
  if (action === "logout") {
    await api("/api/auth/logout", { method: "POST" });
    await refreshMe(); toast("Logged out"); location.hash = "#/"; return route();
  }

  if (t.dataset.follow) {
    const slug = t.dataset.follow, on = t.dataset.following === "1";
    needLogin("Log in to follow clubs.", async () => {
      t.disabled = true;
      try {
        await api(`/api/clubs/${slug}/follow`, { method: on ? "DELETE" : "POST" });
        await refreshMe();
        toast(on ? "Unfollowed" : "Following! Their events will show up in your Following feed.");
        view._reload?.();
      } catch (err) { toast(err.message); t.disabled = false; }
    });
    return;
  }

  if (t.dataset.rsvp) {
    const id = t.dataset.rsvp;
    needLogin("Log in to RSVP.", async () => {
      const e = eventsById.get(id);
      t.disabled = true;
      try {
        const updated = await api(`/api/events/${id}/rsvp`, { method: e?.is_going ? "DELETE" : "POST" });
        eventsById.set(id, updated);
        const card = document.getElementById(`ev-${id}`);
        if (card) card.outerHTML = eventCard(updated, { highlight: card.classList.contains("highlight") });
      } catch (err) { toast(err.message); t.disabled = false; }
    });
    return;
  }

  if (t.dataset.share) {
    const url = `${location.origin}/#/e/${t.dataset.share}`;
    const e = eventsById.get(t.dataset.share);
    if (navigator.share) navigator.share({ title: e?.title, url }).catch(() => {});
    else { await navigator.clipboard?.writeText(url).catch(() => {}); toast("Link copied"); }
    return;
  }

  if (t.dataset.del) {
    if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Tap again to delete"; return; }
    try {
      await api(`/api/events/${t.dataset.del}`, { method: "DELETE" });
      toast("Event deleted");
      if (location.hash.startsWith("#/e/")) location.hash = "#/"; else view._reload?.();
    } catch (err) { toast(err.message); }
  }
});

// ---------- router ----------
async function route() {
  view._reload = null;
  const h = location.hash.replace(/^#/, "") || "/";
  const [, a, b] = h.split("/");
  window.scrollTo(0, 0);
  if (!a) return viewEvents("");
  if (a === "following") return viewEvents("following");
  if (a === "going") return viewEvents("going");
  if (a === "clubs") return viewClubs();
  if (a === "c" && b) return viewClub(decodeURIComponent(b));
  if (a === "e" && b) return viewEvent(decodeURIComponent(b));
  if (a === "me") return viewMe();
  if (h.startsWith("e=")) { location.hash = `#/e/${h.slice(2)}`; return; } // links from v1
  return viewEvents("");
}
window.addEventListener("hashchange", route);

(async function init() {
  try {
    [state.meta] = await Promise.all([api("/api/meta"), refreshMe()]);
    $("#fCategory").innerHTML = state.meta.categories.map((c) => `<option ${c === "Study session" ? "selected" : ""}>${esc(c)}</option>`).join("");
    $("#fBuilding").innerHTML = `<option value="" disabled selected>Choose…</option>` + buildingOptions();
    $("#fClubType").innerHTML = state.meta.club_types.map((t) => `<option>${esc(t)}</option>`).join("");
    await route();
    // keep event lists fresh
    setInterval(() => { if (!document.querySelector("dialog[open]") && /^#?\/?(following|going)?$/.test(location.hash.replace("#", "")) && view._reload) view._reload(); }, 60_000);
  } catch (err) {
    view.innerHTML = `<div class="empty">Failed to start: ${esc(err.message)}</div>`;
  }
})();
