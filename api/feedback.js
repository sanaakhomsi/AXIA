// AXIA feedback loop: stores user and clinician feedback in Supabase.
// The page sends one record per verdict. This function checks consent, saves the case,
// uploads the small anonymised image crop (if any) to private storage, and saves the feedback row.
//
// Environment variables (hosting dashboard only, never in code):
//   SUPABASE_URL               e.g. https://abcd1234.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  the "service_role" secret key (server only, bypasses row security)
//   CLINICIAN_CODE             optional. Access code for clinician mode; their feedback is marked verified.
//   ALLOWED_ORIGINS            optional, same as api/claude.js.

const BUCKET = "feedback-crops";
const TYPES = new Set(["spot", "map_label", "scene", "read_observation"]);
const VERDICTS = new Set(["correct", "wrong"]);
const MAX_IMAGE_B64 = 400000; // the page sends a 256 px JPEG, far below this
const MAX_JSON_CHARS = 8000;

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 40;
}

function cors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
  }
}

const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const isUuidish = (v) => typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);

async function supa(path, opts = {}) {
  const url = process.env.SUPABASE_URL.replace(/\/$/, "") + path;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(url, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text().catch(() => "")}`);
  return r;
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const configured = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (req.method === "GET") return res.status(configured ? 200 : 503).json({ ok: configured });
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!configured) return res.status(503).json({ error: "Feedback storage is not configured." });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many requests." });

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { return res.status(400).json({ error: "Invalid JSON." }); } }
  if (!b || b.consent !== true) return res.status(400).json({ error: "Consent is required." });
  if (!TYPES.has(b.ai_type) || !VERDICTS.has(b.verdict)) return res.status(400).json({ error: "Invalid feedback." });
  if (!b.case || !isUuidish(b.case.id)) return res.status(400).json({ error: "Missing case id." });
  const output = JSON.stringify(b.ai_output ?? null);
  if (output.length > MAX_JSON_CHARS) return res.status(413).json({ error: "AI output too large." });

  // Clinician mode: a wrong code is refused so the page can tell the reviewer.
  let role = "patient";
  if (b.clinician_code) {
    if (!process.env.CLINICIAN_CODE || b.clinician_code !== process.env.CLINICIAN_CODE) {
      return res.status(403).json({ error: "Clinician code not recognised." });
    }
    role = "clinician";
  }

  try {
    // 1. The case (one per upload). Repeated feedback on the same case updates nothing.
    await supa("/rest/v1/cases?on_conflict=id", {
      method: "POST",
      headers: { "content-type": "application/json", Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({
        id: b.case.id,
        consent: true,
        body_part: clip(b.case.body_part, 80),
        sequence: clip(b.case.sequence, 20),
        plane: clip(b.case.plane, 20),
        source: clip(b.case.source, 20),
        slice_count: Number.isInteger(b.case.slices) ? b.case.slices : null,
      }),
    });

    // 2. The image crop, if any, into private storage.
    let imagePath = null;
    if (typeof b.image === "string" && b.image.length > 0) {
      if (b.image.length > MAX_IMAGE_B64) return res.status(413).json({ error: "Image too large." });
      imagePath = `${b.case.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      await supa(`/storage/v1/object/${BUCKET}/${imagePath}`, {
        method: "POST",
        headers: { "content-type": "image/jpeg" },
        body: Buffer.from(b.image, "base64"),
      });
    }

    // 3. The feedback row.
    const spot = b.spot && typeof b.spot.x === "number" && typeof b.spot.y === "number" ? { x: b.spot.x, y: b.spot.y } : null;
    await supa("/rest/v1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        case_id: b.case.id,
        ai_type: b.ai_type,
        ai_output: JSON.parse(output),
        ai_via: clip(b.ai_via, 20),
        model_tier: clip(b.model_tier, 20),
        prompt_version: clip(b.prompt_version, 40),
        verdict: b.verdict,
        correction: clip(b.correction, 200),
        reviewer_role: role,
        review_status: role === "clinician" ? "verified" : "unverified",
        slice_index: Number.isInteger(b.slice_index) ? b.slice_index : null,
        spot,
        image_path: imagePath,
      }),
    });
    return res.status(200).json({ ok: true, role });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "Could not save feedback." });
  }
};
