var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// index.ts
var index_exports = {};
__export(index_exports, {
  default: () => register
});
module.exports = __toCommonJS(index_exports);
var import_fs = require("fs");
var import_path = require("path");
var DEFAULT_FILE = "shared/core-rules.md";
function log(msg) {
  console.log(`[shared-rules-injector] ${msg}`);
}
function warn(msg) {
  console.log(`[shared-rules-injector] WARN: ${msg}`);
}
function resolveOpenClawDefaultWorkspaceRoot() {
  const env = process.env;
  const home = env.HOME || env.USERPROFILE;
  if (!home) return null;
  const profile = env.OPENCLAW_PROFILE?.trim();
  const sub = profile && profile.toLowerCase() !== "default" ? `workspace-${profile}` : "workspace";
  return (0, import_path.join)(home, ".openclaw", sub);
}
var fileCache = /* @__PURE__ */ new Map();
function readFileCached(filePath) {
  try {
    const st = (0, import_fs.statSync)(filePath);
    const cached = fileCache.get(filePath);
    if (cached && cached.mtimeMs === st.mtimeMs) return cached.content;
    const content = (0, import_fs.readFileSync)(filePath, "utf-8");
    fileCache.set(filePath, { mtimeMs: st.mtimeMs, content });
    return content;
  } catch {
    return null;
  }
}
function register(api) {
  const anyApi = api;
  const config = anyApi.pluginConfig ?? (anyApi.id && anyApi.config?.plugins?.entries?.[anyApi.id]?.config) ?? api.getConfig?.() ?? {};
  const hostRoot = anyApi.runtime?.workspaceRoot ?? anyApi.runtime?.workspaceDir ?? api.getWorkspaceRoot?.() ?? null;
  const validHostRoot = hostRoot && hostRoot !== "/" ? hostRoot : null;
  const workspaceRoot = validHostRoot ?? (config.workspaceRoot && (0, import_path.isAbsolute)(config.workspaceRoot) ? config.workspaceRoot : null) ?? resolveOpenClawDefaultWorkspaceRoot();
  if (!workspaceRoot) {
    warn(
      "no workspaceRoot resolved \u2014 host did not provide one, plugin config has none, and OpenClaw default could not be derived. Set `workspaceRoot` or run under a host that provides it."
    );
    return;
  }
  const fileRel = config.file ?? DEFAULT_FILE;
  const filePath = (0, import_path.isAbsolute)(fileRel) ? fileRel : (0, import_path.join)(workspaceRoot, fileRel);
  const mode = config.mode === "firstTurn" ? "firstTurn" : "everyTurn";
  const skipAgents = new Set(config.skipAgents ?? []);
  const onlyAgents = Array.isArray(config.onlyAgents) && config.onlyAgents.length > 0 ? new Set(config.onlyAgents) : null;
  const probe = readFileCached(filePath);
  if (probe === null) {
    warn(
      `shared rules file not found at ${filePath} \u2014 plugin will still register but return nothing until the file exists`
    );
  }
  if (typeof api.on !== "function") {
    warn("api.on not available on this host \u2014 plugin disabled");
    return;
  }
  api.on(
    "before_prompt_build",
    (event, ctx) => {
      const ev = event;
      const cx = ctx;
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
    { priority: 20 }
  );
  log(
    `v1.0.0 init: file=${filePath}, mode=${mode}, skipAgents=[${[...skipAgents].join(",")}]${onlyAgents ? `, onlyAgents=[${[...onlyAgents].join(",")}]` : ""}, fileExists=${probe !== null}`
  );
}
