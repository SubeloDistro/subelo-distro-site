// Stripe webhook handler. Listens for "checkout.session.completed" --
// fired once a Solo/Plus/Label customer finishes paying on Stripe's
// hosted checkout page -- and logs the signup into Supabase so the admin
// can see it and create the matching Sonosuite account (at 100% royalties).
//
// Server-side only (Netlify Function), never sent to the browser.

const crypto = require("crypto");

const SUPABASE_URL = "https://mavxlbtbczebeydfcael.supabase.co";
// Server-side secret key (Project Settings > API Keys > Secret keys in
// Supabase), stored in Netlify's environment variables as SUPABASE_SECRET_KEY.
// Safe here because this code only runs server-side (Netlify Function).
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

// Set in Netlify's environment variables (Site settings > Environment
// variables > STRIPE_WEBHOOK_SECRET) after creating the webhook endpoint
// in the Stripe dashboard (Developers > Webhooks > Add endpoint). Stripe
// shows this once as "Signing secret", starts with whsec_.
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const { notifyAdminOfSignup, sendSignupConfirmation } = require("./lib/email");
const { createAccountSetupLink } = require("./lib/account");

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    })
  );
  if (!parts.t || !parts.v1) return false;

  const signedPayload = `${parts.t}.${payload}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}

async function logSignup(row) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/signups`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("Supabase insert failed:", resp.status, text);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Could not reach Supabase:", err && err.message, err);
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const valid = verifyStripeSignature(event.body, sig, STRIPE_WEBHOOK_SECRET);

  if (!valid) {
    return { statusCode: 400, body: "Invalid signature" };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid payload" };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const plan = session.metadata?.plan || "unknown";
    const email = session.customer_details?.email || session.customer_email;

    const logged = await logSignup({
      email,
      plan,
      royalty_pct: 100,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
      status: "pending",
    });

    if (logged && email) {
      const setupLink = await createAccountSetupLink(email);
      await Promise.all([
        notifyAdminOfSignup({ email, plan, royaltyPct: 100 }),
        sendSignupConfirmation({ email, plan, setupLink }),
      ]);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
