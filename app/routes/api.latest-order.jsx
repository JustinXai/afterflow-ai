import { authenticate } from "../shopify.server";

/**
 * GET /api/latest-order
 * Returns the most recent order that has a customer note.
 * Falls back to demo data when no Shopify session is available (standalone mode).
 */
export async function loader({ request }) {
  let order = null;

  try {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
      `#graphql
      query GetLatestNoteOrder {
        orders(first: 1, query: "note_filled:true", sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              note
              tags
              createdAt
              financialStatus
              fulfillmentStatus
            }
          }
        }
      }`
    );
    const data = await response.json();
    order = data?.data?.orders?.edges?.[0]?.node ?? null;
  } catch (err) {
    // No Shopify session in standalone mode — return demo order
    order = {
      id: "demo-order-1",
      name: "#DEMO-001",
      note: "Gift wrapping needed, please include a card",
      tags: [],
      createdAt: new Date().toISOString(),
      financialStatus: "PAID",
      fulfillmentStatus: "UNFULFILLED",
    };
  }

  return new Response(JSON.stringify({ order }), {
    headers: { "Content-Type": "application/json" },
  });
}
