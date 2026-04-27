const AI_PROMPT = `Act as an e-commerce expert. Analyze this order note and return a JSON object with the following exact structure:
{
  "summary": "one sentence summary of the customer's intent",
  "tags": ["tag1", "tag2"],
  "urgency": "high" or "normal"
}
Focus on detecting: product swaps, delivery date requests, gift wrapping, special handling instructions, or any time-sensitive requests.
If no urgency signals are found, default urgency to "normal".
Return ONLY the JSON object, no markdown, no explanation.`;

function parseJsonFromResponse(text) {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return JSON.parse(cleaned);
}

export async function analyzeOrderNote(note, orderId) {
  const startTime = Date.now();

  let parsed;
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: AI_PROMPT },
          { role: "user", content: note },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("DeepSeek returned empty response content");
    }

    parsed = parseJsonFromResponse(content);

    if (
      !parsed.summary ||
      !Array.isArray(parsed.tags) ||
      !["high", "normal"].includes(parsed.urgency)
    ) {
      throw new Error(
        `DeepSeek response missing required fields: ${JSON.stringify(parsed)}`
      );
    }
  } catch (error) {
    // Log errors locally — Prisma writes are skipped in standalone mode (no DATABASE_URL)
    console.error(`[AI] Failed to analyze order ${orderId}:`, error instanceof Error ? error.message : String(error));
    return {
      summary: note.slice(0, 120),
      tags: ["manual-review"],
      urgency: "normal",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const duration = Date.now() - startTime;
  console.log(
    `[AI] Order ${orderId} analyzed in ${duration}ms — urgency=${parsed.urgency}, tags=${JSON.stringify(parsed.tags)}`
  );

  return {
    summary: parsed.summary,
    tags: parsed.tags,
    urgency: parsed.urgency,
  };
}

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
