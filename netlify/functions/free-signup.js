// Captures a Free-plan signup (no payment involved) and logs it into
// Supabase the same way a paid signup gets logged, at 80% royalties
// instead of 100%, so the admin can see it and create the matching
// Sonosuite account.
//
// Server-side only (Netlify Function), never sent to the browser.

const SUPABASE_URL = "https://mavxlbtbczebeydfcael.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JDbHyrpzq9Ya61LoG9mYJw_GJNNLhcI";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { email } = body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Valid email required" }) };
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/signups`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        email,
        plan: "free",
        royalty_pct: 80,
        status: "pending",
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: "Could not log signup", detail: text }) };
    }
  } catch {
    return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: "Could not reach Supabase" }) };
  }

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
