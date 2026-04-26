import type { ActionFunctionArgs } from "react-router";
import { appSessionStorage } from "../session-storage.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = payload.current as string[];
  if (session) {
    await appSessionStorage.updateScope(session.id, current.toString());
  }

  return new Response();
};
