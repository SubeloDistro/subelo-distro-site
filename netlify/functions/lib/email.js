// Shared helper for sending transactional emails via Resend.
// Called by free-signup.js and stripe-webhook.js whenever a new signup
// is successfully logged, to (a) notify the admin so they can create the
// matching Sonosuite account, and (b) confirm with the signee.
//
// Server-side only (Netlify Function), never sent to the browser.
// A missing/failed send never blocks the signup itself -- it only logs.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Must be an address on a domain verified in Resend (mail.subelodistro.com).
const FROM_ADDRESS = "Subelo Distro <notifications@mail.subelodistro.com>";
// Where new-signup notifications go. Override with the ADMIN_EMAIL env var
// in Netlify if this should point somewhere else.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@subelodistro.com";

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set -- skipping email send");
    return;
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("Resend send failed:", resp.status, text);
    }
  } catch (err) {
    console.error("Could not reach Resend:", err && err.message, err);
  }
}

function planLabel(plan) {
  const labels = { free: "Free", solo: "Solo", plus: "Plus", label: "Label" };
  return labels[plan] || plan;
}

async function notifyAdminOfSignup({ email, plan, royaltyPct }) {
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `New ${planLabel(plan)} signup -- ${email}`,
    html: `
      <p>A new signup just came in:</p>
      <ul>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Plan:</strong> ${planLabel(plan)}</li>
        <li><strong>Royalty %:</strong> ${royaltyPct}%</li>
      </ul>
      <p>Check Supabase for the full record, then create their Sonosuite account.</p>
    `,
  });
}

async function sendSignupConfirmation({ email, plan }) {
  await sendEmail({
    to: email,
    subject: "You're signed up with Subelo Distro",
    html: `
      <p>Thanks for signing up for the <strong>${planLabel(plan)}</strong> plan with Subelo Distro.</p>
      <p>We're setting up your account now -- you'll hear from us shortly with your login details.</p>
      <p>-- Subelo Distro</p>
    `,
  });
}

module.exports = { notifyAdminOfSignup, sendSignupConfirmation };
