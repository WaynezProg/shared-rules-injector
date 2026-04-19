#!/usr/bin/env node
"use strict";
const { mkdirSync, writeFileSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const { join } = require("path");

const mod = require("./index.js");
const register = mod.default;

const tmp = join(tmpdir(), `srl-test-${Date.now()}`);
mkdirSync(join(tmp, "shared"), { recursive: true });
writeFileSync(join(tmp, "shared", "core-rules.md"), "# rules\nbody");

let pass = 0, fail = 0;
function eq(name, got, want) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) pass++; else { fail++; console.error(`FAIL ${name}`, got, want); }
}
function truthy(name, v) { if (v) pass++; else { fail++; console.error(`FAIL ${name} (falsy)`); } }

function makeApi(cfg = {}, wsRoot = tmp) {
  const hooks = {};
  const api = {
    on: (n, fn) => { hooks[n] = fn; },
    getConfig: () => cfg,
    getWorkspaceRoot: () => wsRoot,
  };
  register(api);
  return hooks;
}

// default path
{
  const hooks = makeApi();
  truthy("hook registered", typeof hooks.before_prompt_build === "function");
  const r = hooks.before_prompt_build({ messages: [] }, { agentId: "main" });
  truthy("returns appendSystemContext", r && typeof r.appendSystemContext === "string");
  truthy("contains content", r.appendSystemContext.includes("rules"));
}
// skipAgents
{
  const hooks = makeApi({ skipAgents: ["skipme"] });
  eq("skipAgents suppresses", hooks.before_prompt_build({ messages: [] }, { agentId: "skipme" }), undefined);
  truthy("skipAgents does not affect other", hooks.before_prompt_build({ messages: [] }, { agentId: "main" }));
}
// onlyAgents
{
  const hooks = makeApi({ onlyAgents: ["special"] });
  eq("onlyAgents excludes everyone else", hooks.before_prompt_build({ messages: [] }, { agentId: "main" }), undefined);
  truthy("onlyAgents allows listed", hooks.before_prompt_build({ messages: [] }, { agentId: "special" }));
}
// firstTurn mode
{
  const hooks = makeApi({ mode: "firstTurn" });
  truthy("firstTurn on empty session", hooks.before_prompt_build({ messages: [] }, { agentId: "main" }));
  eq("firstTurn skip subsequent", hooks.before_prompt_build({ messages: [1, 2, 3] }, { agentId: "main" }), undefined);
}
// missing agentId
{
  const hooks = makeApi();
  eq("no agentId → no inject", hooks.before_prompt_build({ messages: [] }, {}), undefined);
}
// missing file
{
  const hooks = makeApi({}, tmpdir() + "/nonexistent-" + Date.now());
  // In missing-file mode hook still registers but returns nothing.
  eq("missing file → no inject", hooks.before_prompt_build({ messages: [] }, { agentId: "main" }), undefined);
}

rmSync(tmp, { recursive: true, force: true });
console.log(`${pass + fail} total | ${pass} pass | ${fail} fail`);
if (fail > 0) process.exit(1);
