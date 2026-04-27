import { json } from "@react-router/node";
import { authenticate } from "../shopify.server";

/**
 * GET /api/latest-order
 * Returns the most recent order that has a customer note.
 * No authentication required — the Remix server-side loader already
 * runs behind the app's own session middleware in dev/prod.
 */
export const loader = async ({ request }) => {
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
    }`,
  );

  const data = await response.json();
  const order = data?.data?.orders?.edges?.[0]?.node ?? null;

  return json({ order });
};
