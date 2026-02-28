# Architecture - kagami-plugin

> Updated: 2026-02-28T20:16:38Z | Type: node | Frameworks: N/A

## Structure

```text
/Users/thkt/GitHub/kagami-plugin/src
├── __tests__
│   ├── parser.test.ts
│   ├── real-session.test.ts
│   └── startup-send.test.ts
├── api.ts
├── backfill.ts
├── cost.ts
├── parser.ts
├── startup-send.ts
├── stdin.ts
├── stop-hook.ts
└── types.ts

2 directories, 11 files
```

## Entry Points



## Key Exports

```text
function categorize
function estimateCost
function extractSkillName
function findRecentJsonlFiles
function sendPayload
interface EventPayload
interface MessageSummary
interface ModelTokens
interface TokenSummary
interface ToolEventInput
interface TranscriptLine
type ContentBlock
```
