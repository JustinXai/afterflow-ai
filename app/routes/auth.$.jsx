import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import "../styles/app.css";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];
  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
            demoInfo: metafield(namespace: "$app", key: "demo_info") {
              jsonValue
            }
          }
        }
      }`,
    {
      variables: {
        product: {
          title: `${color} Snowboard`,
          metafields: [
            {
              namespace: "$app",
              key: "demo_info",
              value: "Created by AfterFlow AI",
            },
          ],
        },
      },
    }
  );
  const responseJson = await response.json();
  const product = responseJson.data.productCreate.product;
  const variantId = product.variants.edges[0].node.id;
  const variantResponse = await admin.graphql(
    `#graphql
    mutation shopifyReactRouterTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          barcode
          createdAt
        }
      }
    }`,
    {
      variables: {
        productId: product.id,
        variants: [{ id: variantId, price: "100.00" }],
      },
    }
  );
  const variantResponseJson = await variantResponse.json();
  const metaobjectResponse = await admin.graphql(
    `#graphql
    mutation shopifyReactRouterTemplateUpsertMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject {
          id
          handle
          title: field(key: "title") {
            jsonValue
          }
          description: field(key: "description") {
            jsonValue
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        handle: {
          type: "$app:example",
          handle: "demo-entry",
        },
        metaobject: {
          fields: [
            { key: "title", value: "Demo Entry" },
            {
              key: "description",
              value:
                "This metaobject was created by AfterFlow AI to demonstrate the metaobject API.",
            },
          ],
        },
      },
    }
  );
  const metaobjectResponseJson = await metaobjectResponse.json();

  return {
    product: responseJson.data.productCreate.product,
    variant: variantResponseJson.data.productVariantsBulkUpdate.productVariants,
    metaobject: metaobjectResponseJson.data.metaobjectUpsert.metaobject,
  };
};

const DEMO_STEPS = [
  {
    phase: "INPUT_RECEIVED",
    label: "Merchant Input",
    content:
      "Hey, this is for a birthday, please remove price tags and add a ribbon!",
    icon: "comment",
  },
  {
    phase: "AI_THINKING",
    label: "AI Thinking...",
    content: null,
    icon: "sparkles",
  },
  {
    phase: "ACTION_TAKEN",
    label: "Action Taken",
    content: null,
    icon: "checkmark",
  },
];

const TAG_STYLES = {
  Gift: { background: "#ec4899", color: "#ffffff" },
  Urgent: { background: "#f59e0b", color: "#ffffff" },
  "No-Price-Tag": { background: "#3b82f6", color: "#ffffff" },
};

export default function Dashboard() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [livePhase, setLivePhase] = useState("idle");
  const [showTags, setShowTags] = useState(false);
  const timerRef = useRef(null);
  const intervalRef = useRef(null);

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.product?.id) {
      shopify.toast.show("Product created");
    }
  }, [fetcher.data?.product?.id, shopify]);

  const startLiveDemo = () => {
    setLivePhase("idle");
    setShowTags(false);

    const phases = [
      { delay: 400, phase: "INPUT_RECEIVED" },
      { delay: 2000, phase: "AI_THINKING" },
      { delay: 4500, phase: "ACTION_TAKEN" },
    ];

    clearTimeout(timerRef.current);
    clearInterval(intervalRef.current);

    phases.forEach(({ delay, phase }) => {
      timerRef.current = setTimeout(() => {
        setLivePhase(phase);
        if (phase === "AI_THINKING") {
          let dot = 0;
          intervalRef.current = setInterval(() => {
            dot = (dot + 1) % 4;
            const el = document.getElementById("ai-thinking-dots");
            if (el) el.textContent = ".".repeat(dot || 1);
          }, 350);
        }
        if (phase === "ACTION_TAKEN") {
          clearInterval(intervalRef.current);
          const tagEl = document.getElementById("ai-thinking-dots");
          if (tagEl) tagEl.textContent = "";
          setTimeout(() => setShowTags(true), 100);
        }
      }, delay);
    });
  };

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      clearInterval(intervalRef.current);
    };
  }, []);

  const generateProduct = () => fetcher.submit({}, { method: "POST" });

  return (
    <s-page heading="AfterFlow AI - Order Automation Suite">
      <s-section>
        <div className="liveCard">
          <div className="cardHeader">
            <div className="brandRow">
              <img
                src="/app-icon.png"
                alt="AfterFlow AI"
                className="logo"
              />
              <span className="brandName">AfterFlow AI</span>
            </div>
            <div className="liveIndicator">
              <span className="liveDot" />
              <span className="liveText">LIVE</span>
            </div>
          </div>

          <div className="flowRow">
            {DEMO_STEPS.map((step, idx) => (
              <div key={step.phase} className="flowStep">
                {idx > 0 && (
                  <div className={`arrow ${livePhase !== "idle" && livePhase !== step.phase ? "arrowActive" : ""}`}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
                <div className={`stepBox ${livePhase === step.phase ? step.phase.replace("_", "-") : "stepIdle"}`}>
                  <div className="stepLabel">{step.label}</div>
                  {step.content ? (
                    <div className="stepContent">{step.content}</div>
                  ) : step.phase === "AI_THINKING" ? (
                    <div className="thinkingWrapper">
                      <div className="progressBar">
                        <div className="progressFill" />
                      </div>
                      <span id="ai-thinking-dots" className="thinkingDots">.</span>
                    </div>
                  ) : step.phase === "ACTION_TAKEN" ? (
                    showTags ? (
                      <div className="tagsWrapper">
                        {Object.keys(TAG_STYLES).map((tag) => (
                          <span
                            key={tag}
                            className="tag"
                            style={TAG_STYLES[tag]}
                          >
                            {tag}
                          </span>
                        ))}
                        <div className="successLine">
                          Tags applied to Shopify order
                        </div>
                      </div>
                    ) : (
                      <div className="waitingLine">Awaiting AI...</div>
                    )
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="cardActions">
            <s-button
              onClick={startLiveDemo}
              variant="primary"
            >
              Run Live Demo
            </s-button>
            <s-button
              onClick={generateProduct}
              {...(isLoading ? { loading: true } : {})}
              variant="secondary"
            >
              Connect to my Shopify Orders
            </s-button>
          </div>
        </div>
      </s-section>

      {fetcher.data?.product && (
        <s-section heading="productCreate mutation">
          <s-stack direction="block" gap="base">
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <pre style={{ margin: 0 }}>
                <code>{JSON.stringify(fetcher.data.product, null, 2)}</code>
              </pre>
            </s-box>

            <s-heading>productVariantsBulkUpdate mutation</s-heading>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <pre style={{ margin: 0 }}>
                <code>{JSON.stringify(fetcher.data.variant, null, 2)}</code>
              </pre>
            </s-box>

            <s-heading>metaobjectUpsert mutation</s-heading>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <pre style={{ margin: 0 }}>
                <code>
                  {JSON.stringify(fetcher.data.metaobject, null, 2)}
                </code>
              </pre>
            </s-box>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
