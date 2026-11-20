// Bridges a logged-in Subelo Distro artist into Sonosuite via SSO/JWT.
//
// Flow:
//   1. Browser has already logged the artist in via Supabase (client-side).
//   2. Browser POSTs here with the Supabase access token.
//   3. We verify that token against Supabase, pull the artist's email + id.
//   4. We sign a Sonosuite-shaped JWT with that info and a shared secret.
//   5. We hand back the Sonosuite URL to redirect the browser to.
//
// This Netlify app type has no environment-variables UI, so these live here
// directly instead. This file is server-side only -- it is never sent to
// the browser, so this is safe (just don't post this file's contents anywhere public).
const SUPABASE_URL = "https://mavxlbtbczebeydfcael.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JDbHyrpzq9Ya61LoG9mYJw_GJNNLhcI";
// Server-side secret key, same one free-signup.js and stripe-webhook.js use
// (Netlify env var SUPABASE_SECRET_KEY). Needed here to update the signups
// table, which the anon key above can't write to.
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
// This is the real secret from Sonosuite's own Setup > 3rd Party > SSO page
// (distribution.subelodistro.com), not the stale one the old developer left
// hardcoded here. SSO is "Activated" there as of 2026-11-20.
const SONOSUITE_SSO_SECRET = "13dd6bb58478fcec5e507e643b13d33896dc992ddbaa4dfa9edddc19b15cb035";
// This is the vanity domain (CNAME'd to platform.sonosuite.com) so artists
// never see "sablatino" or "sonosuite.com" anywhere in the URL.
const SONOSUITE_DASHBOARD_DOMAIN = "distribution.subelodistro.com";

const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// This function is hosted on a separate classic Netlify site from the main
// static pages (which can't run functions), so calls to it are cross-origin.
// These headers let subelodistro.com's pages call it successfully.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Only touches rows still sitting at "pending" -- never overwrites a status
// an admin or another process already moved on (e.g. "cancelled").
async function markSignupActive(email) {
  if (!SUPABASE_SECRET_KEY) {
    console.error("SUPABASE_SECRET_KEY not set -- skipping signup status update");
    return;
  }
  const url = `${SUPABASE_URL}/rest/v1/signups?email=eq.${encodeURIComponent(email)}&status=eq.pending`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ status: "active" }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase PATCH failed: ${resp.status} ${text}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method not allowed" };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: "Missing session token" }) };
  }
  const accessToken = authHeader.slice("Bearer ".length);

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
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid or expired session" }) };
    }
    user = await resp.json();
  } catch (err) {
    return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: "Could not reach Supabase" }) };
  }

  if (!user || !user.email || !user.id) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: "Session did not return a valid user" }) };
  }

  // They've made it this far, meaning they logged in and Sonosuite SSO is
  // about to hand them an account (or already did). Flip their signups row
  // from "pending" to "active" so the admin can see at a glance who's
  // actually gotten in versus who's still waiting on a password. Awaited
  // (serverless functions can get frozen/killed right after returning a
  // response, so a fire-and-forget call here could just never run) but
  // never allowed to fail or slow down the actual handoff.
  try {
    await markSignupActive(user.email);
  } catch (err) {
    console.error("Could not mark signup active:", err && err.message, err);
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

  // Sonosuite sends people to /sonosuite/login with a "next" telling us
  // which page they were trying to reach (e.g. next=%2Falbums). Honor it
  // when present, otherwise just land them on the releases list.
  const nextPath = (event.queryStringParameters && event.queryStringParameters.next) || "/albums";
  const redirectUrl = `https://${SONOSUITE_DASHBOARD_DOMAIN}${nextPath}?jwt=${encodeURIComponent(token)}`;

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ redirect: redirectUrl }),
  };
};
