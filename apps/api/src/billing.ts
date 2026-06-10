// Stripe billing (#351) — Checkout + Webhook + Customer Portal for hotel
// subscriptions (3-month trial → monthly). Card data NEVER touches us: Stripe's
// hosted Checkout/Portal handle capture + PCI. We only persist the subscription
// status (see core/billing.ts). No prices stored or computed (rule #1).
//
// REWORK-FREE: all Stripe config comes from env. Until STRIPE_SECRET_KEY +
// STRIPE_PRICE_ID (and STRIPE_WEBHOOK_SECRET for the webhook) are set, the
// endpoints return 501 "billing_not_configured" and nothing else is affected.
// When you paste the keys in, it activates with no code change.

import { Hono } from "hono";
import Stripe from "stripe";
import { getSubscriptionRepo, mapStripeStatus, type HotelSubscription } from "@truerate/core";

const SECRET = () => process.env.STRIPE_SECRET_KEY?.trim();
const PRICE = () => process.env.STRIPE_PRICE_ID?.trim();
const WEBHOOK_SECRET = () => process.env.STRIPE_WEBHOOK_SECRET?.trim();
const TRIAL_DAYS = Number(process.env.STRIPE_TRIAL_DAYS ?? 90);
const SITE = () => process.env.PUBLIC_SITE_URL?.trim() || "https://customrates.online";

let _stripe: Stripe | null = null;
function stripe(): Stripe | null {
  const key = SECRET();
  if (!key) return null;
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}
/** Checkout/portal need the secret key + a price; the webhook needs its secret. */
const configured = () => !!SECRET() && !!PRICE();

const nowIso = () => new Date().toISOString();
const trialEndIso = (unixSeconds: number | null | undefined): string | undefined =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : undefined;

// Placeholder gate for the owner-only actions; replaced by claim-flow auth (#364).
function requireAdmin(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const expected = process.env.ADMIN_SECRET?.trim();
  return !!expected && c.req.header("x-admin-secret") === expected;
}

export const billingRoutes = new Hono();

// POST /billing/checkout  { hotelId, email } → { url } (redirect the owner here).
// Called AFTER the admin approves the claim (verify-first, then card + trial).
billingRoutes.post("/billing/checkout", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const s = stripe();
  if (!s || !configured()) return c.json({ error: "billing_not_configured" }, 501);
  const body = (await c.req.json().catch(() => ({}))) as { hotelId?: string; email?: string };
  if (!body.hotelId) return c.json({ error: "missing_hotelId" }, 400);
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: PRICE()!, quantity: 1 }],
    subscription_data: { trial_period_days: TRIAL_DAYS },
    customer_email: body.email,
    client_reference_id: body.hotelId, // ties the Stripe customer back to our hotel
    success_url: `${SITE()}/claim/done?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE()}/claim`,
  });
  return c.json({ url: session.url });
});

// POST /billing/portal  { customerId } → { url }  (self-serve manage/cancel).
billingRoutes.post("/billing/portal", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const s = stripe();
  if (!s || !configured()) return c.json({ error: "billing_not_configured" }, 501);
  const { customerId } = (await c.req.json().catch(() => ({}))) as { customerId?: string };
  if (!customerId) return c.json({ error: "missing_customerId" }, 400);
  const portal = await s.billingPortal.sessions.create({ customer: customerId, return_url: `${SITE()}/dashboard` });
  return c.json({ url: portal.url });
});

// POST /webhooks/stripe — Stripe → us. PUBLIC, but signature-verified. Uses the
// RAW body (must not be JSON-parsed first). Updates the subscription store.
billingRoutes.post("/webhooks/stripe", async (c) => {
  const s = stripe();
  const whSecret = WEBHOOK_SECRET();
  if (!s || !whSecret) return c.json({ error: "billing_not_configured" }, 501);
  const sig = c.req.header("stripe-signature");
  const raw = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await s.webhooks.constructEventAsync(raw, sig ?? "", whSecret);
  } catch {
    return c.json({ error: "bad_signature" }, 400);
  }

  const repo = await getSubscriptionRepo();
  const save = async (patch: Partial<HotelSubscription> & { hotelId: string }) => {
    const prev = (await repo.get(patch.hotelId)) ?? { hotelId: patch.hotelId, status: "none" as const, updatedAt: nowIso() };
    await repo.upsert({ ...prev, ...patch, updatedAt: nowIso() });
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const hotelId = session.client_reference_id ?? undefined;
      if (hotelId) {
        await save({
          hotelId,
          stripeCustomerId: typeof session.customer === "string" ? session.customer : (session.customer?.id ?? undefined),
          stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? undefined),
          status: TRIAL_DAYS > 0 ? "trialing" : "active",
        });
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const existing = (await repo.bySubscription(sub.id)) ?? (await repo.byStripeCustomer(typeof sub.customer === "string" ? sub.customer : sub.customer.id));
      if (existing) {
        await save({
          hotelId: existing.hotelId,
          status: event.type === "customer.subscription.deleted" ? "canceled" : mapStripeStatus(sub.status),
          trialEndsAt: trialEndIso(sub.trial_end),
        });
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const existing = customerId ? await repo.byStripeCustomer(customerId) : null;
      if (existing) await save({ hotelId: existing.hotelId, status: "past_due" });
      break;
    }
    default:
      break; // ignore other events
  }
  return c.json({ received: true });
});
