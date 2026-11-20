// Creates (or re-invites) a real Supabase Auth account for a new signee, and
// returns a one-time link that lets them set a password and log in.
//
// Called by free-signup.js and stripe-webhook.js right after a signup is
// logged, so the signee gets a real account instead of just a row in the
// signups table. Once they set their password and log in (dashboard-login.html
// -> dashboard-redirect.html), the SSO bridge (sso-redirect.js) hands them off
// to Sonosuite, which -- per Sonosuite support -- auto-creates their account
// on that side too.
//
// Never blocks the signup itself: any failure here is logged and swallowed,
// same pattern as the email helpers.

const SUPABASE_URL = "https://mavxlbtbczebeydfcael.supabase.co";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

// Where the one-time link lands. The signee sets a password there, which
// then redirects into the SSO handoff.
const SET_PASSWORD_REDIRECT = "https://subelodistro.com/set-password.html";

async function generateLink(type, email) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type,
      email,
      redirect_to: SET_PASSWORD_REDIRECT,
    }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    return { ok: false, status: resp.status, data };
  }
  return { ok: true, link: data && data.action_link };
}

// Returns the set-password link, or null if we couldn't get one (never throws).
async function createAccountSetupLink(email) {
  if (!SUPABASE_SECRET_KEY) {
    console.error("SUPABASE_SECRET_KEY not set -- skipping account creation");
    return null;
  }
  try {
    // "invite" creates the Supabase Auth user (if they don't already have
    // one) and returns a link for them to set their password.
    const invite = await generateLink("invite", email);
    if (invite.ok) return invite.link;

    // Most likely failure: they already have an account (re-signup, or the
    // paid flow running after an earlier free signup). "recovery" works for
    // an existing user and still gets them a working set/reset-password link.
    console.error("invite link failed, falling back to recovery:", invite.status, invite.data);
    const recovery = await generateLink("recovery", email);
    if (recovery.ok) return recovery.link;

    console.error("recovery link also failed:", recovery.status, recovery.data);
    return null;
  } catch (err) {
    console.error("Could not reach Supabase admin API:", err && err.message, err);
    return null;
  }
}

module.exports = { createAccountSetupLink };
