import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent, UserJSON } from "@clerk/nextjs/server";
import { connectDB } from "@/db";
import { User } from "@/models/user.model";

export async function POST(req: Request) {
  await connectDB(); // Ensure MongoDB is connected

  const SIGNING_SECRET = process.env.SIGNING_SECRET;
  if (!SIGNING_SECRET) {
    throw new Error("Error: Please add SIGNING_SECRET from Clerk Dashboard to .env.local");
  }

  // Initialize Webhook verification
  const wh = new Webhook(SIGNING_SECRET);
  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Error: Missing Svix headers", { status: 400 });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);
  let evt: WebhookEvent;

  // Verify webhook payload
  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("❌ Webhook verification failed:", err);
    return new Response("Error: Verification error", { status: 400 });
  }

  const eventType = evt.type;
  console.log(`✅ Received webhook: ${eventType}`);

  // **Use Type Guard to Check if evt.data is a User Event**
  if (eventType === "user.created" || eventType === "user.updated") {
    const userData = evt.data as UserJSON; // Explicitly cast to UserJSON

    try {
      await User.findOneAndUpdate(
        { clerkUserId: userData.id }, // Find by Clerk ID
        {
          $set: {
            email: userData.email_addresses?.[0]?.email_address || null,
            username: userData.username || null,
          },
        },
        { upsert: true, new: true }
      );

      console.log("✅ User stored in database:", {
        id: userData.id,
        email: userData.email_addresses?.[0]?.email_address,
        username: userData.username,
      });
    } catch (dbError) {
      console.error("❌ Database update failed:", dbError);
      return new Response("Error: Database update failed", { status: 500 });
    }
  }

  return new Response("Webhook received", { status: 200 });
}
