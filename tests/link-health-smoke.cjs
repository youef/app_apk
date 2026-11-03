#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const admin = read("admin/admin.js");
const css = read("admin/admin.css");
const agent = read("supabase/functions/aseel-link-health/index.ts");
const workflow = read(".github/workflows/link-health-agent.yml");
const sql = read("supabase/migrations/20261101193000_aseel_link_health_agent_v1.sql");
const youtubeSql = read("supabase/migrations/20261101204000_aseel_youtube_health_agent_v1.sql");
for(const table of ["aseel_channels","aseel_movies","aseel_episodes","aseel_series"]) {
  assert.ok(sql.includes(table), "Link health missing table: " + table);
}
assert.ok(youtubeSql.includes("aseel_youtube_videos"), "YouTube links must also be monitored");
assert.ok(sql.includes("link_health_status <> ''broken''"), "RLS must prevent public access to broken records");
assert.ok(sql.includes("aseel_reset_link_health_on_edit"), "Changing the link must reset health");
assert.ok(youtubeSql.includes("aseel_reset_youtube_health_on_edit"));
assert.ok(agent.includes("failed>=3"), "Require at least 3 repeated definitive failures");
assert.ok(agent.includes("response.status===404||response.status===410"), "Only hard HTTP failure can hide content");
assert.ok(agent.includes('Deno.resolveDns'), "SSRF safety must validate remote DNS");
assert.ok(agent.includes('claims.iss'), "Agent must authenticate GitHub OIDC");
assert.ok(agent.includes('crypto.subtle.verify'), "OIDC signature verification is mandatory");
assert.ok(agent.includes('verifyAdmin'), "Manual checks require an authorized administrator");
assert.ok(agent.includes("mediaList"), "Check media variants as fallback");
assert.ok(agent.includes('updateSeries'), "Series health must derive from episodes");
assert.ok(!agent.includes("console.warn(\"OIDC_DIAG\""), "Never log identity token details");
for(const token of ["health-row--broken","health-label--broken","healthOnly","runLinkHealthScan","link_health_reason"]) assert.ok(admin.includes(token), "Missing admin feature: "+token);
assert.ok(css.includes(".health-row--broken") && css.includes(".health-label--broken"));
assert.ok(workflow.includes("id-token: write") && workflow.includes("schedule:") && workflow.includes("cron:"));
assert.ok(workflow.includes("aseel-link-health"));
assert.ok(workflow.includes("23 */6 * * *"), "Health agent must run every six hours");
assert.ok(workflow.includes("for table in aseel_channels aseel_movies aseel_episodes aseel_youtube_videos"), "Sweep all playable kinds");
assert.ok(workflow.includes("mode"), "Recalculate series health after episodes");
assert.ok(workflow.includes("before"), "Use cutoff so each item is checked once per sweep");
assert.ok(agent.includes('probes.length===0'), "Missing playback links count as definite failures");
assert.ok(agent.includes('body.mode==="series"'), "Series health aggregation endpoint must exist");
assert.ok(agent.includes("timeFilter"), "Full scanner must support per-sweep incremental batches");
assert.ok(agent.includes("newlyHidden"), "Report automatically hidden content");

assert.ok(!workflow.includes("secrets.SUPABASE_SERVICE_ROLE_KEY"), "Do not transfer long-lived service credentials");
console.log("PASS: media health monitoring, owner-only broken items, OIDC cron, and admin repair alerts.");
