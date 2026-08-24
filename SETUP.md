---
port: 
start: pnpm --parallel -r dev
---

# Setup

## Prerequisites

### Supported versions

- Node.js 20.0.0 or newer
- pnpm 11.21.0, as pinned by the root `package.json` `packageManager` field

## Installation

```bash
git clone <repo-url>
cd MeshtasticForeman
pnpm install
```

## Configuration

```bash
cp .env.example .env
```

Update `.env` with your values.

## Running

```bash
pnpm --parallel -r dev
```



## Notes

(add project-specific notes here)
