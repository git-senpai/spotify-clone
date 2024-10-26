import Stripe from "stripe";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { stripe } from "@/libs/stripe";
import { upsertProductRecord, upsertPriceRecord, manageSubscriptionStatusChange } from "@/libs/supabaseAdmin";

const relevantEvents = new Set([
    'product.created',
    'product.updated',
    'price.created',
    'price.updated',
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
]);

export async function POST(request: Request): Promise<Response> {
    const body = await request.text();
    const sig = headers().get("stripe-signature");

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event: Stripe.Event;

    try {
        if (!sig || !webhookSecret) return new NextResponse('Webhook secret or signature missing', { status: 400 });
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (error: unknown) {
        // Specify the error type instead of using 'any'
        if (error instanceof Error) {
            console.log(error.message);
        }
        return new NextResponse('Webhook error: ' + error, {
            status: 400
        });
    }

    if (relevantEvents.has(event.type)) {
        try {
            switch (event.type) {
                case "product.created":
                case "product.updated":
                    const product = event.data.object as Stripe.Product;
                    await upsertProductRecord(product);
                    break;
                case "price.created":
                case "price.updated":
                    const price = event.data.object as Stripe.Price;
                    await upsertPriceRecord(price);
                    break;
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                case 'customer.subscription.deleted':
                    const subscription = event.data.object as Stripe.Subscription;
                    await manageSubscriptionStatusChange(
                        subscription.id,
                        subscription.customer as string,
                        event.type === "customer.subscription.created"
                    );
                    break;
                case "checkout.session.completed":
                    const checkoutSession = event.data.object as Stripe.Checkout.Session;
                    if (checkoutSession.mode === "subscription") {
                        const subscriptionId = checkoutSession.subscription;
                        await manageSubscriptionStatusChange(
                            subscriptionId as string,
                            checkoutSession.customer as string,
                            true
                        );
                    }
                    break;
                default:
                    throw new Error('Unhandled relevant event!');
            }
        } catch (error) {
            console.log(error);
            return new NextResponse("Webhook Error", { status: 400 });
        }
    }

    return NextResponse.json({ received: true }, { status: 200 });
};
