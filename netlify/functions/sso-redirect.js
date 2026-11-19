// Bridges a logged-in Subelo Distro artist into Sonosuite via SSO/JWT.
//
// Flow:
//   1. Browser has already logged the artist in via Supabase (client-side).
//   2. Browser POSTs here with the Supabase access token.
//   3. We verify that token against Supabase, pull the artist's email + id.
//   4. We sign a Sonosuite-shaped JWT with that info and a shared secret.
//   5. We hand back the Sonosuite URL to redirect the browser to.
//
// Required environment variables (set in Netlify: Site settings -> Environment variables):
//   SUPABASE_URL            e.g. https://xxxx.supabase.co
//   SUPABASE_ANON_KEY       the "anon public" key from Supabase project settings
//   SONOSUITE_SSO_SECRET    the "Secret" value from Sonosuite Setup -> 3rd Party -> SSO
//   SONOSUITE_SUBDOMAIN     e.g. sablatino  (so it builds https://sablatino.sonosuite.com/...)

const jwt = require("jsonwebtoken");
const crypto = require("crypto");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { statusCode: 401, body: JSON.stringify({ error: "Missing session token" }) };
  }
  const accessToken = authHeader.slice("Bearer ".length);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SONOSUITE_SSO_SECRET = process.env.SONOSUITE_SSO_SECRET;
  const SONOSUITE_SUBDOMAIN = process.env.SONOSUITE_SUBDOMAIN || "sablatino";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SONOSUITE_SSO_SECRET) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server is missing required configuration (env vars not set yet)." }),
    };
  }

  // Verify the Supabase session and get the real user record.
  let user;
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!resp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid or expired session" }) };
    }
    user = await resp.json();
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Could not reach Supabase" }) };
  }

  if (!user || !user.email || !user.id) {
    return { statusCode: 401, body: JSON.stringify({ error: "Session did not return a valid user" }) };
  }

  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomBytes(16).toString("hex"); // exactly 32 hex characters

  const payload = {
    exp: now + 300, // 5 minute validity, this is a one-time handoff
    iat: now,
    jti,
    email: user.email,
    externalId: user.id,
  };

  const token = jwt.sign(payload, SONOSUITE_SSO_SECRET, { algorithm: "HS256" });

  const returnTo = event.queryStringParameters && event.queryStringParameters.return_to;
  let redirectUrl = `https://${SONOSUITE_SUBDOMAIN}.sonosuite.com/albums?jwt=${encodeURIComponent(token)}`;
  if (returnTo) {
    redirectUrl += `&return_to=${encodeURIComponent(returnTo)}`;
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect: redirectUrl }),
  };
};
