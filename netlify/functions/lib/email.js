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

// Brand colors, matching styles.css on the main site.
const COLORS = {
  bg: "#f4f7fc",
  ink: "#05060a",
  muted: "#4a5266",
  blue: "#5fb1fb",
  deep: "#1c47b5",
  line: "#e2e8f3",
};

// Wraps body content in a branded card matching the site's wordmark/style.
// All styles are inline -- email clients don't load external stylesheets.
function renderEmail({ preheader, bodyHtml }) {
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${COLORS.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader || ""}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${COLORS.line};border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 36px 20px 36px;text-align:center;border-bottom:1px solid ${COLORS.line};">
                <div style="font-size:26px;font-weight:700;letter-spacing:.01em;color:${COLORS.ink};">
                  SUB<span style="color:${COLORS.blue};">ELO</span>
                </div>
                <div style="font-size:11px;font-weight:600;letter-spacing:.22em;color:${COLORS.muted};margin-top:2px;">
                  DISTRO
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 36px;color:${COLORS.ink};font-size:16px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 36px 28px 36px;border-top:1px solid ${COLORS.line};text-align:center;">
                <div style="font-size:12px;color:${COLORS.muted};">Subelo Distro &middot; Upload it. Turn it up.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

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
  const label = planLabel(plan);
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `New ${label} signup -- ${email}`,
    html: renderEmail({
      preheader: `New ${label} signup from ${email}`,
      bodyHtml: `
        <p style="margin:0 0 18px 0;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${COLORS.blue};">New signup</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid ${COLORS.line};color:${COLORS.muted};font-size:14px;">Email</td>
            <td style="padding:10px 0;border-bottom:1px solid ${COLORS.line};text-align:right;font-weight:600;">${email}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid ${COLORS.line};color:${COLORS.muted};font-size:14px;">Plan</td>
            <td style="padding:10px 0;border-bottom:1px solid ${COLORS.line};text-align:right;font-weight:600;">${label}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:${COLORS.muted};font-size:14px;">Royalty</td>
            <td style="padding:10px 0;text-align:right;font-weight:600;">${royaltyPct}%</td>
          </tr>
        </table>
        <p style="margin:0;color:${COLORS.muted};font-size:15px;">Check Supabase for the full record, then create their Sonosuite account.</p>
      `,
    }),
  });
}

async function sendSignupConfirmation({ email, plan }) {
  const label = planLabel(plan);
  await sendEmail({
    to: email,
    subject: "You're signed up with Subelo Distro",
    html: renderEmail({
      preheader: `You're signed up for the ${label} plan.`,
      bodyHtml: `
        <p style="margin:0 0 16px 0;font-size:19px;font-weight:700;">You're in.</p>
        <p style="margin:0 0 16px 0;">Thanks for signing up for the <strong>${label}</strong> plan with Subelo Distro.</p>
        <p style="margin:0 0 24px 0;">We're setting up your account now -- you'll hear from us shortly with your login details.</p>
        <p style="margin:0;color:${COLORS.muted};">-- Subelo Distro</p>
      `,
    }),
  });
}

module.exports = { notifyAdminOfSignup, sendSignupConfirmation };
