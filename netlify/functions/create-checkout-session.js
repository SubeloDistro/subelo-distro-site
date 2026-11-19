// Creates a Stripe Checkout Session for a paid plan (Solo / Plus / Label).
// The browser posts { plan, email } here; we map plan -> Stripe Price ID,
// create a subscription-mode Checkout Session, and hand back the URL to
// redirect the browser to Stripe's hosted checkout page.
//
// This file is server-side only (Netlify Function) -- never sent to the
// browser. The Stripe key lives in a Netlify environment variable
// (Site settings > Environment variables > STRIPE_SECRET_KEY) instead of
// being hardcoded here, since GitHub's secret scanning blocks pushes
// that contain a recognizable live Stripe key.

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

// Where the browser lands after a successful / cancelled checkout.
const SITE_URL = "https://subelodistro.com";

const PRICE_IDS = {
  solo: "price_1UdbKkRAm1RLKvQNlvaBElx4",
  plus: "price_1UdbOfRAm1RLKvQNbH8l080G",
  label: "price_1UdbQVRAm1RLKvQNEiFfdWu4",
};

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

  const { plan, email } = body;
  const priceId = PRICE_IDS[plan];

  if (!priceId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Unknown plan" }) };
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Valid email required" }) };
  }

  const params = new URLSearchParams();
  params.append("mode", "subscription");
  params.append("line_items[0][price]", priceId);
  params.append("line_items[0][quantity]", "1");
  params.append("customer_email", email);
  params.append("success_url", `${SITE_URL}/join-success.html?plan=${encodeURIComponent(plan)}&session_id={CHECKOUT_SESSION_ID}`);
  params.append("cancel_url", `${SITE_URL}/pricing.html`);
  // Carry the plan through to the webhook via metadata on the session.
  params.append("metadata[plan]", plan);
  params.append("subscription_data[metadata][plan]", plan);

  try {
    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(STRIPE_SECRET_KEY + ":").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await resp.json();

    if (!resp.ok) {
      console.error("Stripe checkout session creation failed:", resp.status, JSON.stringify(session));
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: session.error?.message || "Stripe error" }) };
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error("Could not reach Stripe:", err && err.message, err);
    return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: "Could not reach Stripe" }) };
  }
};
