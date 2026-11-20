// Shared helper for updating a row in the signups table from a Stripe
// subscription lifecycle event (renewal, cancellation, failed payment).
// Looked up by stripe_subscription_id, which gets stored on the row when
// the original checkout.session.completed webhook logs the signup.
//
// Server-side only (Netlify Function), never sent to the browser.

const SUPABASE_URL = "https://mavxlbtbczebeydfcael.supabase.co";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

// extraFilter is an optional raw "&key=op.value" string for guarding against
// overwriting a status we don't want to touch (e.g. don't flip a cancelled
// row back to active just because Stripe sent a stray "updated" event).
async function updateSignupBySubscriptionId(subscriptionId, patch, extraFilter = "") {
  if (!SUPABASE_SECRET_KEY) {
    console.error("SUPABASE_SECRET_KEY not set -- skipping signups update");
    return null;
  }
  if (!subscriptionId) return null;

  const url =
    `${SUPABASE_URL}/rest/v1/signups?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}` +
    extraFilter;

  try {
    const resp = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("Supabase signups PATCH failed:", resp.status, text);
      return null;
    }
    const rows = await resp.json().catch(() => []);
    return rows; // array of the updated row(s), usually 0 or 1
  } catch (err) {
    console.error("Could not reach Supabase:", err && err.message, err);
    return null;
  }
}

module.exports = { updateSignupBySubscriptionId };
