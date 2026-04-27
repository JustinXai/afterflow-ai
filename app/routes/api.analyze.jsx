import { json } from "@react-router/node";
import { authenticate } from "../shopify.server";
import { analyzeOrderNote } from "../models/ai.server";

/**
 * POST /api/analyze
 * Body: { note: string, orderId?: string }
 * Returns DeepSeek AI parsed result: { urgency, tags, summary, error? }
 */
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const body = await request.json();
  const { note, orderId } = body;

  if (!note || typeof note !== "string") {
    return json({ error: "Missing or invalid 'note' field" }, { status: 400 });
  }

  try {
    const result = await analyzeOrderNote(note, orderId ?? `demo-${Date.now()}`);
    return json({ type: "analyze", note, orderId: orderId ?? null, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[AfterFlow] /api/analyze error:", message);
    return json({ error: message }, { status: 500 });
  }
};
