# PCD Access Request — AfterFlow AI

## Overview

AfterFlow AI is an order-intent intelligence layer for Shopify merchants. When a customer adds a note at checkout — like *"Red L, no red cancel, gift packaging please"* — our engine parses that natural-language signal into structured metadata (urgency level, intent tags, a one-sentence summary) that the merchant's team can act on instantly without manual reading.

## What We Are Requesting

**Webhook:** `orders/create`
**Access scope:** `read_orders`

## Why We Need `orders/create` in Real-Time

### The Problem We're Solving

Shopify order notes are unstructured free text. By the time a fulfillment team member reads a note — often while handling dozens of orders — urgency signals are already buried. A note like *"if this doesn't arrive by Friday cancel it"* needs to surface as a red-flag before the order moves to picking, not after.

### How We Use the Webhook

When `orders/create` fires, we receive the order payload. We immediately extract:

- `id` — to write metadata back to the order record via Metafields
- `note` — the raw customer text we analyze
- `created_at` — to timestamp our processing

We **do not** read or store customer PII from the order object. We do not touch shipping addresses, customer names, emails, or payment data.

### What We Store (Metadata Only)

After parsing, we persist a single structured record per order:

| Field | Example | Stored As |
|---|---|---|
| `orderId` | `#4821` | string |
| `urgency` | `high` | enum: low / medium / high |
| `tags` | `["Urgent", "Gift"]` | JSON array |
| `summary` | `"Size swap with gift packaging"` | plain text |
| `processedAt` | `2026-04-26T10:00:00Z` | ISO timestamp |

This record is written to our own database (hosted exclusively by the merchant). It contains **zero** personal information.

## Privacy Architecture

We deliberately operate on a **zero-PII surface**:

- No customer name, email, phone, or address ever enters our analysis pipeline.
- We analyze only the `note` field — a field the merchant already controls.
- Our stored data is scoped to order-level intent metadata, not individual profiles.
- All processing happens in memory; raw notes are not retained beyond the single analysis pass (except the structured output above).

## Why This Justifies PCD Approval

Protected Customer Data (PCD) approval is required because `orders/create` payloads historically include customer PII. However, AfterFlow implements architectural guardrails that ensure our app never reads, processes, or stores that data:

1. **Scope discipline** — we request `read_orders` only to access the note. We do not request `read_customers` or any write scope to customer records.
2. **Field-level filtering** — in our webhook handler, we explicitly destructure only `{ id, note, created_at }` from the incoming payload. All other fields are explicitly ignored.
3. **Data minimization** — our Prisma schema only defines these columns: `orderId`, `urgency`, `tags`, `summary`, `processedAt`. There is no schema path to customer PII.
4. **No downstream sharing** — parsed metadata is surfaced only inside the merchant's own Shopify admin. It is never shared with third parties or used for analytics.

## Summary for Shopify Review

| Question | Answer |
|---|---|
| Which webhook? | `orders/create` |
| Why real-time? | Intent must be flagged before fulfillment picks the order |
| What PII do you access? | **None.** We never read customer name, email, address, or phone |
| What do you store? | Non-PII metadata: intent tags, urgency score, plain-text summary |
| Who owns the data? | The merchant, stored in their own database |
| Can customers opt out? | Yes — merchants can disable the app at any time; all stored records are deleted on uninstall |

---

*Submitted by AfterFlow AI · @JustinXai · V1 pricing: $19/mo*
