// Captures a Free-plan signup (no payment involved) and logs it into
// Supabase the same way a paid signup gets logged, at 80% royalties
// instead of 100%, so the admin can see it and create the matching
// Sonosuite account.
//
// Server-side only (Netlify Function), never sent to the browser.

const SUPABASE_URL = "https://mavxlbtbczebeydfcael.supabase.co";
// Server-side secret key (Project Settings > API Keys > Secret keys in
// Supabase). Stored in Netlify's environment variables as SUPABASE_SECRET_KEY
// instead of hardcoded, same reason as the Stripe key: full-access keys
// shouldn't live in source control. This has full table access regardless of
// Row Level Security, which is fine here because this code only runs on the
// server (Netlify Function), never in the visitor's browser.
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const { notifyAdminOfSignup, sendSignupConfirmation } = require("./lib/email");
const { createAccountSetupLink } = require("./lib/account");

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
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
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
      // A duplicate-email signup (they lost their set-password email and
      // tried again, or just signed up twice) is not a real failure --
      // don't show them a broken "signup failed" page for it. Postgres
      // reports this as a 409 with a "duplicate key" message. Any other
      // failure is still a real error.
      const isDuplicate = resp.status === 409 || /duplicate key/i.test(text);
      if (!isDuplicate) {
        console.error("Supabase insert failed:", resp.status, text);
        return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: "Could not log signup", detail: text }) };
      }
      console.log(`Duplicate free signup for ${email} -- resending their account setup link instead of logging a new row.`);
    }
  } catch (err) {
    console.error("Could not reach Supabase:", err && err.message, err);
    return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: "Could not reach Supabase" }) };
  }

  // Create their real login account and get a one-time set-password link.
  // Failure here is logged inside the helper and never blocks the signup.
  const setupLink = await createAccountSetupLink(email);

  // Fire both emails after the row is safely logged. Failures here are
  // logged inside the helper and never block the signup response.
  await Promise.all([
    notifyAdminOfSignup({ email, plan: "free", royaltyPct: 80 }),
    sendSignupConfirmation({ email, plan: "free", setupLink }),
  ]);

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
