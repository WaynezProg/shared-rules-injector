/**
 * shared-rules-injector — OpenClaw plugin
 *
 * Injects a single shared markdown file into every agent's system prompt
 * via the `before_prompt_build` hook. The content is returned under
 * `appendSystemContext` so providers that support prompt caching can treat
 * it as a stable suffix.
 *
 * Intended to replace the pattern where the same rule blocks (e.g.
 * "思考準則", "Agent 間溝通") are duplicated verbatim into every
 * agent's AGENTS.md. Put the canonical copy once in
 * `workspace/shared/core-rules.md`, register this plugin, and delete the
 * duplicated blocks from each AGENTS.md.
 */

import { readFileSync, statSync } from "fs";
import { isAbsolute, join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PluginConfig {
  file?: string;
  skipAgents?: string[];
  onlyAgents?: string[];
  mode?: "everyTurn" | "firstTurn";
  workspaceRoot?: string;
}

interface PromptEvent {
  prompt?: string;
  messages?: unknown[];
}

interface PromptCtx {
  agentId?: string;
  [key: string]: unknown;
}

interface OpenClawApi {
  on(
    event: string,
    handler: (...args: unknown[]) => unknown,
    opts?: { priority?: number },
  ): void;
  getConfig?(): PluginConfig;
  getWorkspaceRoot?(): string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FILE = "shared/core-rules.md";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[shared-rules-injector] ${msg}`);
}
function warn(msg: string): void {
  console.log(`[shared-rules-injector] WARN: ${msg}`);
}

function resolveOpenClawDefaultWorkspaceRoot(): string | null {
  const env = process.env;
  const home = env.HOME || env.USERPROFILE;
  if (!home) return null;
  const profile = env.OPENCLAW_PROFILE?.trim();
  const sub =
    profile && profile.toLowerCase() !== "default"
      ? `workspace-${profile}`
      : "workspace";
  return join(home, ".openclaw", sub);
}

/**
 * mtime-keyed cache so hot edits to the shared file are picked up without
 * restarting the gateway.
 */
const fileCache = new Map<string, { mtimeMs: number; content: string }>();

function readFileCached(filePath: string): string | null {
  try {
    const st = statSync(filePath);
    const cached = fileCache.get(filePath);
    if (cached && cached.mtimeMs === st.mtimeMs) return cached.content;
    const content = readFileSync(filePath, "utf-8");
    fileCache.set(filePath, { mtimeMs: st.mtimeMs, content });
    return content;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export default function register(api: OpenClawApi): void {
  const anyApi = api as Record<string, unknown> & {
    pluginConfig?: PluginConfig;
    config?: {
      plugins?: { entries?: Record<string, { config?: PluginConfig }> };
    };
    runtime?: { workspaceRoot?: string; workspaceDir?: string };
    id?: string;
  };

  const config: PluginConfig =
    anyApi.pluginConfig ??
    (anyApi.id && anyApi.config?.plugins?.entries?.[anyApi.id]?.config) ??
    api.getConfig?.() ??
    {};

  const hostRoot =
    anyApi.runtime?.workspaceRoot ??
    anyApi.runtime?.workspaceDir ??
    api.getWorkspaceRoot?.() ??
    null;
  const validHostRoot = hostRoot && hostRoot !== "/" ? hostRoot : null;
  const workspaceRoot =
    validHostRoot ??
    (config.workspaceRoot && isAbsolute(config.workspaceRoot)
      ? config.workspaceRoot
      : null) ??
    resolveOpenClawDefaultWorkspaceRoot();

  if (!workspaceRoot) {
    warn(
      "no workspaceRoot resolved — host did not provide one, plugin config has none, and OpenClaw default could not be derived. Set `workspaceRoot` or run under a host that provides it.",
    );
    return;
  }

  const fileRel = config.file ?? DEFAULT_FILE;
  const filePath = isAbsolute(fileRel) ? fileRel : join(workspaceRoot, fileRel);
  const mode: "everyTurn" | "firstTurn" =
    config.mode === "firstTurn" ? "firstTurn" : "everyTurn";
  const skipAgents = new Set(config.skipAgents ?? []);
  const onlyAgents =
    Array.isArray(config.onlyAgents) && config.onlyAgents.length > 0
      ? new Set(config.onlyAgents)
      : null;

  // Probe the file once at startup so the operator sees a clear error if it
  // is missing. Content is re-read (with mtime cache) on every hook fire.
  const probe = readFileCached(filePath);
  if (probe === null) {
    warn(
      `shared rules file not found at ${filePath} — plugin will still register but return nothing until the file exists`,
    );
  }

  if (typeof api.on !== "function") {
    warn("api.on not available on this host — plugin disabled");
    return;
  }

  api.on(
    "before_prompt_build",
    (event: unknown, ctx: unknown) => {
      const ev = event as PromptEvent;
      const cx = ctx as PromptCtx;
      const agentId = cx?.agentId;
      if (!agentId) return;
      if (onlyAgents && !onlyAgents.has(agentId)) return;
      if (!onlyAgents && skipAgents.has(agentId)) return;
      if (mode === "firstTurn") {
        const isFirstTurn = !ev?.messages || ev.messages.length <= 1;
        if (!isFirstTurn) return;
      }
      const content = readFileCached(filePath);
      if (!content) return;
      return { appendSystemContext: content };
    },
    { priority: 20 },
  );

  log(
    `v1.0.0 init: file=${filePath}, mode=${mode}, skipAgents=[${[...skipAgents].join(",")}]${onlyAgents ? `, onlyAgents=[${[...onlyAgents].join(",")}]` : ""}, fileExists=${probe !== null}`,
  );
}
