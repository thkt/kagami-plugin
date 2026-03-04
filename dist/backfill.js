import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/backfill.ts
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// src/api.ts
function sendPayload(apiUrl, apiKey, payload, timeoutMs) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (apiKey)
    headers.Authorization = `Bearer ${apiKey}`;
  return fetch(`${apiUrl}/api/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
  });
}

// src/parser.ts
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

// src/cost.ts
var PRICING = {
  "claude-opus-4-6": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 }
};
var DEFAULT_PRICING = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
function normalizeModel(model) {
  return model.replace(/-\d{8}$/, "");
}
function estimateCost(model, tokens) {
  const normalized = normalizeModel(model);
  const pricing = PRICING[normalized] ?? DEFAULT_PRICING;
  const perMillion = 1e6;
  return tokens.inputTokens * pricing.input / perMillion + tokens.outputTokens * pricing.output / perMillion + tokens.cacheCreationTokens * pricing.cacheWrite / perMillion + tokens.cacheReadTokens * pricing.cacheRead / perMillion;
}

// src/parser.ts
var execFileAsync = promisify(execFile);
function categorize(name, input) {
  if (name === "Skill")
    return "skill";
  if (name === "Agent" && input.subagent_type)
    return "subagent";
  if (name.startsWith("mcp__"))
    return "mcp";
  return null;
}
function resolveToolName(name, input) {
  if (name === "Skill" && typeof input.skill === "string") {
    return input.skill;
  }
  if (name === "Agent" && typeof input.subagent_type === "string") {
    return input.subagent_type;
  }
  return name;
}
function extractSkillName(content) {
  for (const block of content) {
    if (block.type !== "text")
      continue;
    const match = block.text.match(/^#\s*\/(\S+)/);
    if (match)
      return match[1];
  }
  return null;
}
function extractToolUses(content) {
  return content.filter((block) => block.type === "tool_use").map((block) => ({ name: block.name, input: block.input }));
}
async function parseTranscript(filePath) {
  const events = [];
  const byModel = {};
  let sessionId = "";
  let agentId = "";
  let cwd = "";
  let gitBranch = null;
  let firstTimestamp = "";
  let lastTimestamp = "";
  let currentModel = "";
  let userMessages = 0;
  let assistantMessages = 0;
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Number.POSITIVE_INFINITY
  });
  for await (const rawLine of rl) {
    let line;
    try {
      line = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (line.sessionId && !sessionId)
      sessionId = line.sessionId;
    if (line.agentId && !agentId)
      agentId = line.agentId;
    if (line.cwd && !cwd)
      cwd = line.cwd;
    if (line.gitBranch !== undefined && gitBranch === null)
      gitBranch = line.gitBranch ?? null;
    if (line.timestamp) {
      if (!firstTimestamp)
        firstTimestamp = line.timestamp;
      lastTimestamp = line.timestamp;
    }
    if (line.type === "user" && !line.isMeta)
      userMessages++;
    if (line.type === "assistant")
      assistantMessages++;
    if (line.type === "user" && line.isMeta === true && line.message?.content && Array.isArray(line.message.content)) {
      const skillName = extractSkillName(line.message.content);
      if (skillName) {
        events.push({
          category: "skill",
          toolName: skillName,
          toolInput: null,
          model: currentModel,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          timestamp: line.timestamp ?? lastTimestamp
        });
      }
    }
    if (line.type !== "assistant" || !line.message)
      continue;
    const msg = line.message;
    const model = msg.model ?? currentModel;
    if (model)
      currentModel = model;
    if (msg.usage) {
      const u = msg.usage;
      if (!byModel[model]) {
        byModel[model] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 0
        };
      }
      const m = byModel[model];
      m.inputTokens += u.input_tokens ?? 0;
      m.outputTokens += u.output_tokens ?? 0;
      m.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
      m.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    }
    if (!msg.content)
      continue;
    const toolUses = extractToolUses(msg.content);
    const timestamp = line.timestamp ?? lastTimestamp;
    for (const tu of toolUses) {
      const category = categorize(tu.name, tu.input);
      if (!category)
        continue;
      const toolName = resolveToolName(tu.name, tu.input);
      events.push({
        category,
        toolName,
        toolInput: tu.input,
        model,
        inputTokens: msg.usage?.input_tokens ?? 0,
        outputTokens: msg.usage?.output_tokens ?? 0,
        cacheCreationTokens: msg.usage?.cache_creation_input_tokens ?? 0,
        cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0,
        timestamp
      });
    }
  }
  if (!sessionId || events.length === 0)
    return null;
  const effectiveSessionId = agentId ? `${sessionId}:${agentId}` : sessionId;
  let totalCost = 0;
  for (const [model, tokens] of Object.entries(byModel)) {
    tokens.estimatedCostUsd = estimateCost(model, tokens);
    totalCost += tokens.estimatedCostUsd;
  }
  const userId = await getGitUserEmail(cwd);
  return {
    sessionId: effectiveSessionId,
    userId,
    cwd,
    gitBranch,
    ccVersion: "",
    sessionStartedAt: firstTimestamp,
    sessionEndedAt: lastTimestamp,
    events,
    tokenSummary: {
      byModel,
      totalEstimatedCostUsd: totalCost
    },
    messageSummary: {
      userMessages,
      assistantMessages
    }
  };
}
async function getGitUserEmail(cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["config", "user.email"], {
      cwd
    });
    return stdout.trim() || getUserFallback();
  } catch {
    return getUserFallback();
  }
}
function getUserFallback() {
  return process.env.USER ?? process.env.USERNAME ?? "unknown";
}

// src/backfill.ts
var API_URL = process.env.KAGAMI_API_URL;
var API_KEY = process.env.KAGAMI_API_KEY;
function findJsonlFiles(dir) {
  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }
  walk(dir);
  return files;
}
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dirArg = args.find((a) => !a.startsWith("--"));
  const targetDir = dirArg ?? join(homedir(), ".claude", "projects");
  try {
    statSync(targetDir);
  } catch {
    console.error(`Directory not found: ${targetDir}`);
    process.exit(1);
  }
  if (!dryRun && !API_URL) {
    console.error("KAGAMI_API_URL is not set (required for live mode)");
    process.exit(1);
  }
  console.log(`Scanning: ${targetDir}`);
  console.log(`Mode: ${dryRun ? "dry-run (no POST)" : "live"}`);
  console.log();
  const files = findJsonlFiles(targetDir);
  console.log(`Found ${files.length} JSONL files`);
  console.log();
  let success = 0;
  let skipped = 0;
  let failed = 0;
  for (const file of files) {
    const size = statSync(file).size;
    const sizeMb = (size / 1024 / 1024).toFixed(1);
    process.stdout.write(`  ${file} (${sizeMb}MB) ... `);
    try {
      const payload = await parseTranscript(file);
      if (!payload) {
        console.log("skipped (no tool events)");
        skipped++;
        continue;
      }
      payload.ccVersion = "backfill";
      payload.source = "backfill";
      if (dryRun) {
        console.log(`OK (${payload.events.length} events, $${payload.tokenSummary.totalEstimatedCostUsd.toFixed(4)})`);
        success++;
        continue;
      }
      const res = await sendPayload(API_URL, API_KEY, payload);
      if (res.ok) {
        console.log(`sent (${payload.events.length} events)`);
        success++;
      } else {
        console.log(`HTTP ${res.status}`);
        failed++;
      }
    } catch (err) {
      console.log(`error: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }
  console.log();
  console.log(`Done: ${success} sent, ${skipped} skipped, ${failed} failed`);
}
main();
