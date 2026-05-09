// Re-export the unified analyzeOrderNote from the services layer.
// The services/ai.server.ts implementation provides DeepSeek primary + Gemini fallback
// with automatic Prisma logging to power the Dashboard monitoring panel.
export { analyzeOrderNote } from "../services/ai.server";

// Shopify GraphQL mutations for writing back to order records.
// These are NOT in services/ because they require the Shopify admin session (admin context).

export async function updateShopifyOrderTags(admin, orderId, newTags) {
  const existingTagsResponse = await admin.graphql(
    `#graphql
      query getOrderTags($id: ID!) {
        order(id: $id) {
          tags
        }
      }`,
    { variables: { id: orderId.toString() } }
  );

  const tagData = await existingTagsResponse.json();
  const existingTags = tagData?.data?.order?.tags ?? [];

  const allTags = [...new Set([...existingTags, ...newTags])];

  const mutationResponse = await admin.graphql(
    `#graphql
      mutation tagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node {
            ... on Order {
              id
              tags
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { variables: { id: orderId.toString(), tags: allTags } }
  );

  const result = await mutationResponse.json();
  if (result.errors) {
    throw new Error(`GraphQL tagsAdd error: ${JSON.stringify(result.errors)}`);
  }
  if (result.data?.tagsAdd?.userErrors?.length > 0) {
    throw new Error(
      `tagsAdd userErrors: ${JSON.stringify(result.data.tagsAdd.userErrors)}`
    );
  }

  console.log(
    `[Shopify] Tags added to order ${orderId}: ${JSON.stringify(newTags)}`
  );
  return result.data?.tagsAdd?.node;
}

export async function prependOrderNote(admin, orderId, aiSummary, originalNote) {
  const noteBlock = `[AfterFlow AI]: ${aiSummary}`;
  const fullNote = `${noteBlock}\n\nOriginal note: ${originalNote}`;

  const response = await admin.graphql(
    `#graphql
      mutation orderEditAddMetafield($orderId: ID!, $input: OrderInput!) {
        orderEditBegin(id: $orderId) {
          calculatedOrder {
            id
            note
          }
          userErrors {
            field
            message
          }
        }
        orderEditSetAttributes(id: $orderId, input: $input) {
          calculatedOrder {
            id
            note
          }
          userErrors {
            field
            message
          }
        }
        orderEditCommit(id: $orderId) {
          order {
            id
            note
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        orderId: orderId.toString(),
        input: {
          note: fullNote.slice(0, 2000),
        },
      },
    }
  );

  const result = await response.json();

  if (result.data?.orderEditCommit?.userErrors?.length > 0) {
    const errs = result.data.orderEditCommit.userErrors;
    throw new Error(`orderEditCommit userErrors: ${JSON.stringify(errs)}`);
  }

  console.log(`[Shopify] AI summary prepended to order ${orderId} note`);
  return result.data?.orderEditCommit?.order;
}

export async function updateShopifyOrderNote(admin, orderId, newNote) {
  const response = await admin.graphql(
    `#graphql
      mutation orderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
            note
          }
          userErrors {
            field
            message
          }
        }
        orderEditSetAttributes(id: $id, input: { note: $note }) {
          calculatedOrder {
            id
            note
          }
          userErrors {
            field
            message
          }
        }
        orderEditCommit(id: $id) {
          order {
            id
            note
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        id: orderId.toString(),
        note: newNote,
      },
    }
  );

  const result = await response.json();

  if (result.data?.orderEditCommit?.userErrors?.length > 0) {
    throw new Error(
      `orderEditCommit userErrors: ${JSON.stringify(result.data.orderEditCommit.userErrors)}`
    );
  }

  console.log(`[Shopify] Order ${orderId} note updated`);
  return result.data?.orderEditCommit?.order;
}
