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
    return new Response(JSON.stringify({ error: "Missing or invalid 'note' field" }), { headers: { "Content-Type": "application/json" }, status: 400 });
  }

  try {
    const result = await analyzeOrderNote(note, orderId ?? `demo-${Date.now()}`);
    return new Response(JSON.stringify({ type: "analyze", note, orderId: orderId ?? null, ...result }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[AfterFlow] /api/analyze error:", message);
    return new Response(JSON.stringify({ error: message }), { headers: { "Content-Type": "application/json" }, status: 500 });
  }
};
