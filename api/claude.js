// AXIA backend: a small serverless function that keeps your Claude API key on the server.
// The page calls it with a prompt and images; it forwards them to the Claude Messages API
// and returns the text answer. Deploy on Vercel (see README).
//
// Environment variables (set them in your hosting dashboard, never in the code):
//   ANTHROPIC_API_KEY  required. Your key from the Claude Console.
//   ALLOWED_ORIGINS    optional. Comma-separated sites allowed to call this function from
//                      another domain, e.g. "https://yourname.github.io". Leave empty when the
//                      page and this function are hosted together.

const MODELS = {
  quick: "claude-haiku-5-5",
  default: "claude-sonnet-5-5",
  complex: "claude-sonnet-5-5", // switch to "claude-opus-5-5" for deeper reads (slower, pricier)
};
const MAX_IMAGES = 8;
const MAX_PROMPT_CHARS = 60000;
const MAX_IMAGE_B64 = 1500000; // about 1.1 MB per image
const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Best-effort limit per visitor. Serverless instances do not share memory, so this only
// slows down abuse; set a spend limit in the Claude Console as the real safety net.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 20;
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

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const key = process.env.ANTHROPIC_API_KEY;
  if (req.method === "GET") return res.status(key ? 200 : 503).json({ ok: !!key });
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!key) return res.status(503).json({ error: "ANTHROPIC_API_KEY is not set on the server." });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many requests. Try again in a minute." });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Invalid JSON." }); }
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const images = Array.isArray(body?.images) ? body.images : [];
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) return res.status(400).json({ error: "Missing or oversized prompt." });
  if (images.length > MAX_IMAGES) return res.status(413).json({ error: `At most ${MAX_IMAGES} images per request.` });
  for (const im of images) {
    if (!MEDIA.has(im?.media_type) || typeof im?.data !== "string" || im.data.length > MAX_IMAGE_B64) {
      return res.status(413).json({ error: "Unsupported or oversized image." });
    }
  }

  const content = [];
  images.forEach((im, i) => {
    if (images.length > 1) content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
  });
  content.push({ type: "text", text: prompt });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODELS[body.tier] || MODELS.default,
        max_tokens: 16000,
        messages: [{ role: "user", content }],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      const status = r.status === 429 ? 429 : 502;
      return res.status(status).json({ error: data?.error?.message || "Claude API error." });
    }
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return res.status(200).json({ text, truncated: data.stop_reason === "max_tokens" });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the Claude API." });
  }
};
