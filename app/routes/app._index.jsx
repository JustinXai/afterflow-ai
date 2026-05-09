import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import {
  Page,
  Card,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Banner,
  Spinner,
  EmptyState,
  IndexTable,
  useIndexResourceState,
  Badge,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { analyzeOrderNote } from "../models/ai.server";

// ─── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
  } catch (err) {
    if (err instanceof Response) throw err;
    console.warn("[AfterFlow][app:index] admin auth failed:", err instanceof Error ? err.message : String(err));
    return { analyses: [], recentErrors: [], pcdStatus: "unauthenticated" };
  }

  const [analyses, logs, pcdStatus] = await Promise.all([
    prisma.orderAnalysis.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.aiLog.findMany({
      where: { status: "error" },
      orderBy: { processedAt: "desc" },
      take: 5,
    }),
    Promise.resolve(
      process.env.AF_PCD_APPROVED === "true" ? "approved" : "pending",
    ),
  ]);

  return { analyses, recentErrors: logs, pcdStatus };
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const type = String(formData.get("type") ?? "analyze");

  if (process.env.AF_PCD_APPROVED !== "true") {
    return new Response(JSON.stringify({ type, error: "Feature not active (AF_PCD_APPROVED != true)" }), { headers: { "Content-Type": "application/json" }, status: 403 });
  }

  if (type === "fetchOrders") {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(
      `#graphql
      query GetRecentOrders {
        orders(first: 3, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id name createdAt note financialStatus fulfillmentStatus
            }
          }
        }
      }`,
    );
    const json = await response.json();
    const orders = json?.data?.orders?.edges?.map((e) => e.node) ?? [];
    return { type: "fetchOrders", orders };
  }

  const note = String(formData.get("note") ?? "");
  const result = await analyzeOrderNote(note, `demo-${Date.now()}`);
  return { type: "analyze", ...result };
};

// ─── Embedded App wrapper ───────────────────────────────────────────────────────

function EmbeddedApp({ children }) {
  useEffect(() => {
    if (window.self !== window.top) {
      const handleMessage = (event) => {
        if (event.origin === "https://admin.shopify.com") {
          const { path } = event.data || {};
          if (path) window.location.pathname = path;
        }
      };
      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }
  }, []);
  return children;
}

// ─── Tag badge ──────────────────────────────────────────────────────────────────

const URGENCY_MAP = {
  high:   { color: "critical", label: "High" },
  normal: { color: "info",     label: "Normal" },
  low:    { color: "warning",  label: "Low" },
};

const TAG_COLORS = {
  Urgent:        "#dc2626",
  Gift:          "#d97706",
  "Fragile":     "#2563eb",
  "No-Receipt":  "#16a34a",
  Rush:          "#9333ea",
  "manual-review": "#6b7280",
  default:       "#7c3aed",
};

function TagBadge({ tag }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: TAG_COLORS[tag] ?? TAG_COLORS.default,
        color: "white",
        padding: "0.2rem 0.6rem",
        borderRadius: "50px",
        fontWeight: 700,
        fontSize: "0.72rem",
        letterSpacing: "0.3px",
        boxShadow: `0 2px 6px ${(TAG_COLORS[tag] ?? TAG_COLORS.default)}33`,
      }}
    >
      {tag}
    </span>
  );
}

// ─── Permissions pending ─────────────────────────────────────────────────────────

function PermissionsPending() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "3rem 1rem",
        gap: "1rem",
      }}
    >
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="30" stroke="#a855f7" strokeWidth="3" />
        <path d="M22 28C22 22.477 26.477 18 32 18C37.523 18 42 22.477 42 28" stroke="#a855f7" strokeWidth="3" strokeLinecap="round" />
        <circle cx="32" cy="40" r="3" fill="#a855f7" />
      </svg>
      <Text as="h2" variant="headingLg" alignment="center">
        Waiting for Shopify Permissions
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
        AfterFlow needs access to <code>orders/create</code> webhook events to
        analyze order notes in real-time. We only read non-PII intent metadata.
      </Text>
      <Card background="bg-surface-dark" roundedAbove="sm">
        <BlockStack gap="300" align="center" padding="400">
          <InlineStack gap="300" wrap={false}>
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.4rem",
                background: "#a855f7", color: "white",
                padding: "0.35rem 0.9rem", borderRadius: "50px",
                fontWeight: 700, fontSize: "0.85rem",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Zero PII stored
            </span>
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.4rem",
                background: "#7c3aed", color: "white",
                padding: "0.35rem 0.9rem", borderRadius: "50px",
                fontWeight: 700, fontSize: "0.85rem",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Real-time only
            </span>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            PCD Access Request has been submitted. AfterFlow will process orders
            automatically once Shopify approves the scopes.
          </Text>
          <Button
            variant="primary"
            onClick={() => window.open("https://partners.shopify.com", "_blank", "noopener,noreferrer")}
          >
            Check Partner Dashboard
          </Button>
        </BlockStack>
      </Card>
    </div>
  );
}

// ─── Processed Orders table (last 10) ─────────────────────────────────────────

function ProcessedOrdersTable({ analyses }) {
  if (!analyses || analyses.length === 0) {
    return (
      <Card>
        <BlockStack gap="300" align="center" padding="800">
          <EmptyState
            heading="No orders analyzed yet"
            image=""
          >
            <Text as="p" tone="subdued">
              Orders with customer notes will appear here automatically after
              the webhook fires.
            </Text>
          </EmptyState>
        </BlockStack>
      </Card>
    );
  }

  const resourceName = { singular: "order", plural: "orders" };
  const { selectedResources, handleSelectionChange } = useIndexResourceState(analyses);

  const rowMarkup = analyses.map((record, index) => {
    const tags = (() => {
      try { return JSON.parse(record.tags); } catch { return []; }
    })();
    const urgency = URGENCY_MAP[record.urgency] ?? URGENCY_MAP.normal;
    const createdAt = record.createdAt
      ? new Date(record.createdAt).toLocaleString()
      : "—";

    return (
      <IndexTable.Row
        key={record.id}
        id={String(record.id)}
        selected={selectedResources.includes(String(record.id))}
        position={index}
      >
        <IndexTable.Cell>
          <Text as="span" fontWeight="medium" variant="bodyMd">
            {record.orderId.length > 20
              ? `#${record.orderId.slice(-8)}`
              : record.orderId}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="p" tone="subdued" variant="bodySm">
            {createdAt}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {tags.length > 0
              ? tags.map((t) => <TagBadge key={t} tag={t} />)
              : <Text as="span" tone="subdued" variant="bodySm">—</Text>}
          </div>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={urgency.color}>{urgency.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="p" variant="bodySm" tone="subdued" truncate>
            {record.summary}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Card padding="0">
      <IndexTable
        resourceName={resourceName}
        itemCount={analyses.length}
        selectedItemsCount={selectedResources.length}
        onSelectionChange={handleSelectionChange}
        headings={[
          { title: "Order" },
          { title: "Processed At" },
          { title: "Tags" },
          { title: "Urgency" },
          { title: "AI Summary" },
        ]}
        sortable={[false, true, false, false, false]}
      >
        {rowMarkup}
      </IndexTable>
    </Card>
  );
}

// ─── Live Orders Probe ─────────────────────────────────────────────────────────

function LiveOrdersTest({ fetcher, pcdStatus }) {
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (fetcher.data?.type === "fetchOrders" && fetcher.data?.orders) {
      setResults(fetcher.data.orders);
    }
  }, [fetcher.data]);

  return (
    <Card background="bg-surface-extralight" roundedAbove="sm">
      <BlockStack gap="400">
        <InlineStack gap="300" wrap={false} align="space-between">
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">Live Order Probe</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Fetches 3 most recent orders via Admin API — shows note fields.
            </Text>
          </BlockStack>
          <Button
            variant="primary"
            onClick={() => fetcher.submit({ type: "fetchOrders" }, { method: "POST" })}
            disabled={fetcher.state !== "idle" || pcdStatus !== "approved"}
          >
            {fetcher.state !== "idle" ? "Fetching..." : "Fetch Live Orders"}
          </Button>
        </InlineStack>

        {results.length > 0 && (
          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  {["Order", "Date", "Status", "Note"].map((h) => (
                    <th key={h} style={{ padding: "0.6rem 0.75rem", textAlign: "left", fontWeight: 600, color: "#374151" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((order, i) => (
                  <tr key={order.id} style={{ borderTop: "1px solid #e5e7eb", background: i % 2 === 0 ? "white" : "#fafafa" }}>
                    <td style={{ padding: "0.6rem 0.75rem" }}>
                      <Text as="span" fontWeight="medium">{order.name}</Text>
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem", color: "#6b7280" }}>
                      {new Date(order.createdAt).toLocaleString()}
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem" }}>
                      <span style={{
                        background: order.financialStatus === "PAID" ? "#dcfce7" : "#fef3c7",
                        color: order.financialStatus === "PAID" ? "#166534" : "#92400e",
                        padding: "0.15rem 0.5rem", borderRadius: "4px", fontSize: "0.8rem", fontWeight: 600,
                      }}>
                        {order.financialStatus}
                      </span>
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem", fontStyle: order.note ? "normal" : "italic", color: order.note ? "#111827" : "#9ca3af", maxWidth: "280px" }}>
                      {order.note ? `"${order.note}"` : "(no note)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {fetcher.data?.type === "fetchOrders" && results.length === 0 && (
          <Banner tone="info" title="No orders found">
            Your store has no orders yet — create a test order with a note!
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

// ─── AI Demo engine ────────────────────────────────────────────────────────────

const DEMO_NOTE = "Red L, no red cancel, gift packaging please";
const TAG_PALETTE = {
  Urgent:  "#dc2626",
  Gift:    "#d97706",
  Fragile: "#2563eb",
  default: "#7c3aed",
};

function DemoCard() {
  const fetcher = useFetcher();
  const [displayedTags, setDisplayedTags] = useState([]);
  const [summary, setSummary] = useState("");
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.type === "analyze" && fetcher.data?.tags) {
      setDisplayedTags([]);
      setSummary("");
      fetcher.data.tags.forEach((tag, i) => {
        setTimeout(() => setDisplayedTags((prev) => [...prev, tag]), i * 160);
      });
      setSummary(fetcher.data.summary ?? "");
    }
  }, [fetcher.data]);

  const handleRunDemo = () => {
    setDisplayedTags([]);
    setSummary("");
    fetcher.submit({ note: DEMO_NOTE, type: "analyze" }, { method: "POST" });
  };

  return (
    <Card background="bg-surface-dark" roundedAbove="sm">
      <BlockStack gap="400" inlineAlign="center" align="center">
        <div style={{ padding: "1.5rem 2rem 0", textAlign: "center" }}>
          <Text as="h1" variant="heading3xl" tone="magic">
            🧠 AfterFlow AI
          </Text>
          <Text as="p" variant="bodyLg" tone="subdued">
            AI-powered order intent parser
          </Text>
        </div>

        <div style={{
          background: "#13132a", padding: "1.2rem 1.6rem", borderRadius: "10px",
          maxWidth: "480px", borderLeft: "4px solid #a855f7", textAlign: "center",
        }}>
          <Text as="p" tone="subdued" fontWeight="medium">"{DEMO_NOTE}"</Text>
        </div>

        <Button variant="primary" size="large" onClick={handleRunDemo} disabled={isLoading}>
          {isLoading ? "AI Analyzing..." : "Run Live Demo 🚀"}
        </Button>

        {isLoading && <Spinner size="small" />}

        <div style={{
          display: "flex", gap: "0.65rem", flexWrap: "wrap", justifyContent: "center",
          minHeight: "52px",
        }}>
          {displayedTags.map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              style={{
                background: TAG_PALETTE[tag] ?? TAG_PALETTE.default,
                color: "white", padding: "0.5rem 1.2rem", borderRadius: "50px",
                fontWeight: 700, fontSize: "0.92rem",
                boxShadow: `0 4px 12px ${(TAG_PALETTE[tag] ?? TAG_PALETTE.default)}44`,
                animation: "fadeSlideIn 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
              }}
            >
              {tag}
            </span>
          ))}
        </div>

        {summary && (
          <Banner tone="success" title="AI parsed">
            <Text as="p">{summary}</Text>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

// ─── Recent errors panel ────────────────────────────────────────────────────────

function RecentErrorsPanel({ errors }) {
  if (!errors || errors.length === 0) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text as="h3" variant="headingMd">Recent Failures</Text>
          <Badge tone="critical">{errors.length}</Badge>
        </InlineStack>
        {errors.map((log) => (
          <div
            key={log.id}
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              padding: "0.75rem 1rem",
              fontSize: "0.82rem",
            }}
          >
            <InlineStack align="space-between" wrap={false}>
              <Text as="span" fontWeight="medium" tone="critical">
                Order: {log.orderId}
              </Text>
              <Text as="span" tone="subdued">
                {new Date(log.processedAt).toLocaleString()}
              </Text>
            </InlineStack>
            <Text as="p" tone="critical" variant="bodySm">
              {log.error?.slice(0, 160)}
            </Text>
          </div>
        ))}
      </BlockStack>
    </Card>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────

export default function AppIndex() {
  const { analyses, recentErrors, pcdStatus } = useLoaderData();
  const fetcher = useFetcher();

  return (
    <AppProvider i18n={enTranslations}>
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: scale(0.5) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        code {
          background: rgba(168,85,247,0.15);
          padding: 0.1rem 0.4rem;
          border-radius: 4px;
          font-size: 0.9em;
          color: #c084fc;
        }
      `}</style>

      <EmbeddedApp>
        <Page
          title="AfterFlow AI"
          subtitle={pcdStatus === "approved" ? "Your store's cognitive layer" : "Setup in progress"}
        >
          <BlockStack gap="400">

            {pcdStatus === "unauthenticated" && (
              <Card>
                <BlockStack gap="300" align="center" padding="800">
                  <Banner tone="warning" title="Not authenticated">
                    <Text as="p">
                      Please open this app from the Shopify Admin panel to authenticate.
                      This page requires an active Shopify admin session.
                    </Text>
                  </Banner>
                  <DemoCard />
                </BlockStack>
              </Card>
            )}

            {pcdStatus !== "approved" && pcdStatus !== "unauthenticated" && <PermissionsPending />}

            {pcdStatus === "approved" && (
              <>
                {/* ── Live Dashboard: last 10 ── */}
                <BlockStack gap="200">
                  <InlineStack align="space-between" wrap={false}>
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">Processed Orders</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Last 10 orders analyzed by AfterFlow AI via webhook
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        onClick={() => fetcher.submit({ type: "fetchOrders" }, { method: "POST" })}
                        loading={fetcher.state !== "idle"}
                      >
                        Refresh
                      </Button>
                    </InlineStack>
                  </InlineStack>
                  <ProcessedOrdersTable analyses={analyses} />
                </BlockStack>

                {/* ── Recent errors ── */}
                <RecentErrorsPanel errors={recentErrors} />

                {/* ── Live probe ── */}
                <LiveOrdersTest fetcher={fetcher} pcdStatus={pcdStatus} />

                {/* ── Demo ── */}
                <DemoCard />
              </>
            )}

            {/* ── Footer ── */}
            <Card>
              <InlineStack gap="200" wrap={false}>
                <Text as="p" variant="bodySm" tone="subdued">
                  V1 pricing: <strong>$19/mo</strong> · Building in public · Follow{" "}
                  <a href="https://x.com/JustinXai" target="_blank" rel="noreferrer">@JustinXai</a>
                </Text>
              </InlineStack>
            </Card>

          </BlockStack>
        </Page>
      </EmbeddedApp>
    </AppProvider>
  );
}
