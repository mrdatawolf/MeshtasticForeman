# Change Classification

Use the lightest workflow that preserves clarity and safety.

## Small change

A localized, low-risk change with clear behavior and no architectural effect may
use acceptance criteria directly in its task.

## Meaningful change

Work affecting behavior, multiple components, important user experience, data,
security, or operational risk requires design discussion before approval.

## Contract-required change

Use a separate contract for large, cross-cutting, externally consumed, ambiguous,
or high-risk behavior. When uncertain, propose a contract and let the human decide.

## Decision-required change

Create an ADR when choosing a durable architectural direction with meaningful
alternatives or consequences.
