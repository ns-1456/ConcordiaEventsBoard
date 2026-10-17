// Adds demo users, clubs, follows and events: `npm run seed` (server must be running)
// Demo logins (password for all: password123):
//   fady@live.concordia.ca  — owns "CS Society", follows "Math Help Club"
//   sara@live.concordia.ca  — owns "Math Help Club"
const BASE = `http://localhost:${process.env.PORT || 3000}`;

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch", ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 409) console.warn(method, path, res.status, data.error);
    return data;
  };
}
async function user(email, name) {
  const c = client();
  const r = await c("POST", "/api/auth/signup", { email, name, password: "password123" });
  if (r.error) await c("POST", "/api/auth/login", { email, password: "password123" });
  return c;
}
const at = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const plus = (iso, h) => new Date(new Date(iso).getTime() + h * 3600e3).toISOString();
const ev = (o) => ({ ...o, ends_at: o.ends_at || plus(o.starts_at, 2) });

(async () => {
  const fady = await user("fady@live.concordia.ca", "Fady");
  const sara = await user("sara@live.concordia.ca", "Sara");

  const cs = (await fady("POST", "/api/clubs", { name: "CS Society", type: "Tech", description: "Hack nights, workshops and interview prep for CS & SOEN students.", links: "https://discord.gg/example" }));
  const math = (await sara("POST", "/api/clubs", { name: "Math Help Club", type: "Academic", description: "Free peer tutoring for MATH 203/204/205 and ENGR 213/233." }));
  const me = await fady("GET", "/api/me");
  const csId = cs.id || me.managed_clubs.find((c) => c.name === "CS Society")?.id;
  await fady("POST", "/api/clubs/math-help-club/follow");
  const mathId = math.id || (await sara("GET", "/api/me")).managed_clubs.find((c) => c.name === "Math Help Club")?.id;

  await fady("POST", "/api/events", ev({ title: "COMP 348 midterm prep — past exams + Prolog practice", course: "comp348", category: "Exam prep",
    building: "H", floor: "5th", room: "H-529", starts_at: at(1, 17), description: "Going through last year's midterm, then Prolog/Lisp exercises. Bring a laptop.", contact: "Discord @fady", capacity: 25 }));
  await sara("POST", "/api/events", ev({ title: "Quiet group study for COMP 352", course: "COMP 352", category: "Study session",
    building: "LB", floor: "4th", location_note: "Big tables near the windows", starts_at: at(0, 23) }));
  await sara("POST", "/api/events", ev({ club_id: mathId, title: "Calc II problem-solving night", course: "MATH 205", category: "Study session",
    building: "CC", room: "CC-115", starts_at: at(2, 18) }));
  await fady("POST", "/api/events", ev({ club_id: csId, title: "Intro to Git & GitHub workshop", category: "Workshop", building: "EV", floor: "2nd", room: "EV-2.260",
    starts_at: at(3, 16), description: "Beginner friendly. Clone, branch, PRs.", capacity: 40 }));
  await fady("POST", "/api/events", ev({ club_id: csId, title: "Hack night 🍕", category: "Club", building: "EV", floor: "3rd",
    starts_at: at(5, 18), ends_at: at(5, 22), description: "Bring a project or join one. Pizza at 7." }));
  console.log("Seeded. Log in as fady@live.concordia.ca / password123");
})();
