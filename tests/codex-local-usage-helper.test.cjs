const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const helper = require("../scripts/codex-local-usage-helper.cjs");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function requestJson(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, timeout: 5000, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(text) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", reject);
  });
}

async function waitForTurns(port) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await requestJson(port, "/cc-switch/turns");
    if (Array.isArray(response.body.turns) && response.body.turns.length) return response;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return requestJson(port, "/cc-switch/turns");
}

async function waitForTurnCount(port, count) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await requestJson(port, "/cc-switch/turns");
    if (Array.isArray(response.body.turns) && response.body.turns.length === count) return response;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return requestJson(port, "/cc-switch/turns");
}

async function waitForTurnId(port, turnId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await requestJson(port, "/cc-switch/turns");
    if (Array.isArray(response.body.turns) && response.body.turns.some((turn) => turn.turnId === turnId)) return response;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return requestJson(port, "/cc-switch/turns");
}

async function waitForCcSwitchError(port, errorText) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await requestJson(port, "/cc-switch/turns");
    if (response.body.error === errorText) return response;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return requestJson(port, "/cc-switch/turns");
}

(async () => {
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cltc-helper-test-"));
try {
  const codexHome = path.join(root, ".codex");
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "04");
  const pluginDir = path.join(codexHome, "plugins", "cache", "openai-curated", "github", "1", ".codex-plugin");
  const skillDir = path.join(codexHome, "skills", "systematic-debugging");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "session_index.jsonl"),
    [
      JSON.stringify({ id: "thread-a", thread_name: "A" }),
      JSON.stringify({ id: "thread-b", thread_name: "B" }),
      "",
    ].join("\n"),
  );
  const codexStateDb = path.join(codexHome, "state_5.sqlite");
  const createCodexStateDb = spawnSync(
    "python",
    ["-", codexStateDb],
    {
      input: String.raw`
import sqlite3, sys
db=sys.argv[1]
con=sqlite3.connect(db)
cur=con.cursor()
cur.execute("create table threads (id text primary key, archived integer default 0)")
cur.execute("create table thread_spawn_edges (parent_thread_id text not null, child_thread_id text primary key, status text not null)")
cur.executemany("insert into threads (id, archived) values (?, ?)", [("thread-a", 0), ("thread-b", 1), ("thread-child", 0)])
cur.execute("insert into thread_spawn_edges (parent_thread_id, child_thread_id, status) values ('thread-a', 'thread-child', 'done')")
con.commit()
con.close()
`,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(createCodexStateDb.status, 0, createCodexStateDb.stderr);

  fs.writeFileSync(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify({
      name: "github",
      interface: { displayName: "GitHub" },
      skills: "./skills/",
    }),
  );
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "---\nname: systematic-debugging\ndescription: Debugging workflow\n---\n",
  );
  fs.writeFileSync(
    path.join(sessionDir, "rollout-test.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-07-04T01:00:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "Get-Content C:\\Users\\ovo\\.skills-manager\\skills\\systematic-debugging\\SKILL.md -Raw" }),
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-04T01:01:00.000Z",
        type: "response_item",
        payload: { type: "custom_tool_call", name: "mcp__$github__get_issue", input: "{}" },
      }),
      JSON.stringify({
        timestamp: "2026-07-04T01:01:30.000Z",
        type: "response_item",
        payload: { type: "custom_tool_call", name: "mcp__$github__update_issue", input: "{}" },
      }),
      JSON.stringify({
        timestamp: "2026-07-04T01:02:00.000Z",
        type: "response_item",
        payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "Get-Content other.txt" }) },
      }),
      JSON.stringify({
        timestamp: "2026-07-04T01:03:00.000Z",
        type: "turn_context",
        payload: { threadId: "thread-content-a" },
      }),
      JSON.stringify({
        timestamp: "2026-07-04T01:03:02.000Z",
        type: "response_item",
        payload: { type: "message", role: "user", threadId: "thread-content-a", content: [{ type: "input_text", text: "hello" }] },
      }),
      JSON.stringify({
        timestamp: "2026-07-04T01:03:10.000Z",
        type: "event_msg",
        payload: { type: "token_count", threadId: "thread-content-a", info: { last_token_usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } },
      }),
      JSON.stringify({
        timestamp: "2026-07-04T01:04:00.000Z",
        type: "turn_context",
        payload: { threadId: "thread-empty-marker" },
      }),
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(sessionDir, "rollout-thread-file-only.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-07-04T01:05:00.000Z",
        type: "session_meta",
        payload: { id: "thread-file-only", session_id: "thread-file-only" },
      }),
      JSON.stringify({
        timestamp: "2026-07-04T01:05:10.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "file name carries thread id" },
      }),
      "",
    ].join("\n"),
  );

  const threadContent = helper.collectThreadContent({ codexHome, threadId: "thread-content-a" });
  assert.equal(threadContent.ok, true);
  assert.equal(threadContent.exists, true);
  assert.equal(threadContent.hasMessages, true);
  assert.equal(threadContent.hasUsage, true);
  assert.equal(threadContent.hasContent, true);
  assert.equal(threadContent.lastEventAt, "2026-07-04T01:03:10.000Z");
  const emptyThreadContent = helper.collectThreadContent({ codexHome, threadId: "thread-empty-marker" });
  assert.equal(emptyThreadContent.ok, true);
  assert.equal(emptyThreadContent.exists, true);
  assert.equal(emptyThreadContent.hasContent, false);
  const missingThreadContent = helper.collectThreadContent({ codexHome, threadId: "thread-missing" });
  assert.equal(missingThreadContent.ok, true);
  assert.equal(missingThreadContent.exists, false);
  const fileOnlyThreadContent = helper.collectThreadContent({ codexHome, threadId: "thread-file-only" });
  assert.equal(fileOnlyThreadContent.ok, true);
  assert.equal(fileOnlyThreadContent.exists, true);
  assert.equal(fileOnlyThreadContent.hasMessages, true);
  assert.equal(fileOnlyThreadContent.hasContent, true);

  const stats = helper.collectStats({
    codexHome,
    dbPath: path.join(root, "helper-db.json"),
    now: new Date("2026-07-04T02:00:00.000Z"),
  });
  assert.equal(stats.ok, true);
  assert.equal(stats.stats.unique_skills_used, 1);
  assert.equal(stats.stats.total_skills_used, 1);
  assert.equal(stats.stats.unique_plugins_used, 1);
  assert.equal(stats.stats.total_plugins_used, 2);
  assert.equal(stats.stats.total_threads, 2);
  assert.equal(stats.stats.codex_threads.source, "sqlite");
  assert.equal(stats.stats.codex_threads.total_thread_records, 3);
  assert.equal(stats.stats.codex_threads.subagent_threads, 1);
  assert.equal(stats.stats.codex_threads.session_index_threads, 2);
  assert.equal(stats.stats.installed_plugins.some((plugin) => plugin.id === "github" && plugin.name === "GitHub"), true);
  assert.equal(stats.stats.installed_plugins_count, 1);
  assert.deepEqual(stats.stats.top_plugins, [{ type: "plugin", plugin_id: "github", plugin_name: "GitHub", usage_count: 2 }]);
  assert.deepEqual(stats.stats.top_invocations, [
    { type: "plugin", plugin_id: "github", plugin_name: "GitHub", usage_count: 2 },
    {
      type: "skill",
      skill_id: "systematic-debugging",
      skill_name: "systematic-debugging",
      usage_count: 1,
    },
  ]);

  const ccSwitchDb = path.join(root, "cc-switch.db");
  const createDb = spawnSync(
    "python",
    ["-", ccSwitchDb],
    {
      input: String.raw`
import sqlite3, sys
db=sys.argv[1]
con=sqlite3.connect(db)
cur=con.cursor()
cur.execute("""create table proxy_request_logs (
  request_id text primary key,
  provider_id text not null,
  app_type text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_creation_tokens integer not null default 0,
  input_cost_usd text not null default '0',
  output_cost_usd text not null default '0',
  cache_read_cost_usd text not null default '0',
  cache_creation_cost_usd text not null default '0',
  total_cost_usd text not null default '0',
  latency_ms integer not null,
  first_token_ms integer,
  duration_ms integer,
  status_code integer not null,
  error_message text,
  session_id text,
  provider_type text,
  is_streaming integer not null default 0,
  cost_multiplier text not null default '1.0',
  created_at integer not null,
  request_model text,
  data_source text not null default 'proxy',
  pricing_model text
)""")
cur.execute("""create table usage_daily_rollups (
  date text not null,
  app_type text,
  provider_id text,
  model text,
  request_model text,
  pricing_model text,
  request_count integer,
  success_count integer,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_creation_tokens integer,
  total_cost_usd text,
  avg_latency_ms integer
)""")
rollups=[
 ('2026-07-03','codex','_codex_session','gpt-5.5','gpt-5.5','',4,4,1000,100,500,0,'10',100),
 ('2026-07-04','codex','_codex_session','gpt-5.5','gpt-5.5','',5,5,2000,200,1000,0,'20',100),
]
cur.executemany("insert into usage_daily_rollups values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rollups)
rows=[
 ('r1','_codex_session','codex','gpt-5.5',100,20,40,0,'0','0','0','0','1.5',0,None,None,200,None,'s1','codex_session',1,'1',1783152000,'gpt-5.5','codex_session',''),
 ('r2','_codex_session','codex','gpt-5.5',50,10,20,0,'0','0','0','0','0.5',0,None,None,200,None,'s1','codex_session',1,'1',1783155600,'gpt-5.5','codex_session',''),
 ('r4','_codex_session','codex','gpt-5.6-sol',70,15,25,10,'0','0','0','0','0.75',0,None,91000,200,None,'s1','codex_session',1,'1',1783238400,'gpt-5.6-sol','codex_session',''),
 ('r3','other','gemini','gemini-2.5-pro',999,999,0,0,'0','0','0','0','9',0,None,None,200,None,'s2','proxy',1,'1',1783155600,'','proxy',''),
]
cur.executemany("insert into proxy_request_logs values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
con.commit()
con.close()
`,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(createDb.status, 0, createDb.stderr);
  const ccSwitch = helper.collectCcSwitchTurns({ ccSwitchDbPath: ccSwitchDb });
  assert.equal(ccSwitch.ok, true);
  assert.equal(ccSwitch.imported, 3);
  assert.deepEqual(
    ccSwitch.turns.map((turn) => turn.turnId),
    [
      "cc-switch:2026-07-03:gpt-5.5:gpt-5.5:",
      "cc-switch:2026-07-04:gpt-5.5:gpt-5.5:",
      "cc-switch:2026-07-05T08:00:00.000Z:gpt-5.6-sol:gpt-5.6-sol:",
    ],
  );
  assert.equal(ccSwitch.turns[0].callCount, 4);
  assert.deepEqual(ccSwitch.turns[0].usage, { input: 1000, output: 100, cached: 500, total: 1100 });
  assert.equal(ccSwitch.turns[0].costUsd, 10);
  assert.equal(ccSwitch.turns[0].durationMs, 0);
  assert.equal(ccSwitch.turns[1].callCount, 5);
  assert.deepEqual(ccSwitch.turns[1].usage, { input: 2000, output: 200, cached: 1000, total: 2200 });
  assert.equal(ccSwitch.turns[1].costUsd, 20);
  assert.equal(ccSwitch.turns[2].callCount, 1);
  assert.deepEqual(ccSwitch.turns[2].usage, { input: 70, output: 15, cached: 25, cacheWriteTokens: 10, total: 85 });
  assert.equal(ccSwitch.turns[2].costUsd, 0.75);
  assert.equal(ccSwitch.turns[2].durationMs, 91000);
  assert.equal(ccSwitch.turns[2].durationSec, 91);
  assert.equal(ccSwitch.turns[2].timeGranularity, "hour");
  assert.equal(ccSwitch.turns[2].createdAt, "2026-07-05T08:00:00.000Z");
  assert.equal(ccSwitch.metadata.rollup_rows, 2);
  assert.equal(ccSwitch.metadata.proxy_rows, 1);
  assert.equal(ccSwitch.metadata.rollup_max_date, "2026-07-04");

  const serverDb = path.join(root, "server-helper-db.json");
  fs.writeFileSync(
    serverDb,
    JSON.stringify({
      ok: true,
      source: "codex-local-usage-helper",
      updated_at: "2026-07-04T02:00:00.000Z",
      stats: {
        unique_skills_used: 99,
        total_skills_used: 100,
        unique_plugins_used: 0,
        total_plugins_used: 0,
        top_invocations: [],
        top_plugins: [],
        installed_plugins: [],
        installed_plugins_count: 0,
        installed_skills_count: 0,
        scanned_session_files: 0,
        total_threads: 0,
        codex_threads: { total_threads: 0, source: "cached" },
      },
    }),
  );
  const port = await freePort();
  let ccSwitchRefreshCount = 0;
  const server = helper.startServer({
    codexHome,
    dbPath: serverDb,
    ccSwitchDbPath: ccSwitchDb,
    port,
    ccSwitchRefreshDelayMs: 25,
    onCcSwitchRefresh() {
      ccSwitchRefreshCount++;
    },
  });
  try {
    const refreshed = await requestJson(port, "/stats?refresh=1");
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.refreshing, true);
    assert.equal(refreshed.body.stats.unique_skills_used, 99);
    assert.equal((await requestJson(port, "/stats")).status, 200);
    assert.equal((await requestJson(port, "/stats", { Origin: "app://-" })).status, 200);
    assert.equal((await requestJson(port, "/stats", { Origin: "app://-/index.html" })).status, 200);
    assert.equal((await requestJson(port, "/stats", { Origin: "http://127.0.0.1:3000" })).status, 200);
    assert.equal((await requestJson(port, "/stats", { Origin: "http://localhost:3000" })).status, 200);
    const blockedNullStats = await requestJson(port, "/stats", { Origin: "null" });
    assert.equal(blockedNullStats.status, 403);
    assert.equal(blockedNullStats.body.error, "forbidden_origin");
    const blockedStats = await requestJson(port, "/stats", { Origin: "https://example.com" });
    assert.equal(blockedStats.status, 403);
    assert.equal(blockedStats.body.error, "forbidden_origin");
    const blockedCcSwitch = await requestJson(port, "/cc-switch/turns", { Origin: "https://example.com" });
    assert.equal(blockedCcSwitch.status, 403);
    assert.equal(blockedCcSwitch.body.error, "forbidden_origin");
    const blockedThreadContent = await requestJson(port, "/codex/thread-content?threadId=thread-content-a", { Origin: "https://example.com" });
    assert.equal(blockedThreadContent.status, 403);
    assert.equal(blockedThreadContent.body.error, "forbidden_origin");
    const serverThreadContent = await requestJson(port, "/codex/thread-content?threadId=thread-content-a", { Origin: "app://-" });
    assert.equal(serverThreadContent.status, 200);
    assert.equal(serverThreadContent.body.threadId, "thread-content-a");
    assert.equal(serverThreadContent.body.hasContent, true);
    assert.equal(serverThreadContent.body.hasUsage, true);
    const serverEmptyThreadContent = await requestJson(port, "/codex/thread-content?threadId=thread-empty-marker");
    assert.equal(serverEmptyThreadContent.status, 200);
    assert.equal(serverEmptyThreadContent.body.exists, true);
    assert.equal(serverEmptyThreadContent.body.hasContent, false);
    const serverMissingThreadContent = await requestJson(port, "/codex/thread-content?threadId=thread-missing");
    assert.equal(serverMissingThreadContent.status, 200);
    assert.equal(serverMissingThreadContent.body.exists, false);
    assert.equal(serverMissingThreadContent.body.hasContent, false);
    const firstCcSwitch = await requestJson(port, "/cc-switch/turns");
    assert.equal(firstCcSwitch.body.refreshing, true);
    assert.deepEqual(firstCcSwitch.body.turns, []);
    const cachedCcSwitch = await waitForTurns(port);
    assert.equal(cachedCcSwitch.status, 200);
    assert.equal(cachedCcSwitch.body.refreshing, false);
    assert.equal(cachedCcSwitch.body.turns.length, 3);
    assert.equal(cachedCcSwitch.body.turns[2].durationSec, 91);

    const updateDb = spawnSync(
      "python",
      ["-", ccSwitchDb],
      {
        input: String.raw`
import sqlite3, sys
db=sys.argv[1]
con=sqlite3.connect(db)
cur=con.cursor()
cur.execute("insert into usage_daily_rollups values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ('2026-07-06','codex','_codex_session','gpt-5.5','gpt-5.5','',2,2,300,30,60,0,'3',100))
con.commit()
con.close()
`,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(updateDb.status, 0, updateDb.stderr);
    assert.equal((await requestJson(port, "/cc-switch/turns")).body.turns.length, 3);
    const beforeConcurrentRefresh = ccSwitchRefreshCount;
    const concurrent = await Promise.all([requestJson(port, "/cc-switch/turns?refresh=1"), requestJson(port, "/cc-switch/turns?refresh=true")]);
    assert.equal(concurrent[0].body.refreshing, true);
    assert.equal(concurrent[1].body.refreshing, true);
    assert.equal(ccSwitchRefreshCount, beforeConcurrentRefresh + 1);
    const refreshedCcSwitch = await waitForTurnId(port, "cc-switch:2026-07-06:gpt-5.5:gpt-5.5:");
    assert.equal(refreshedCcSwitch.status, 200);
    assert.equal(refreshedCcSwitch.body.turns.length, 3);
    assert.equal(refreshedCcSwitch.body.turns[2].turnId, "cc-switch:2026-07-06:gpt-5.5:gpt-5.5:");
    assert.equal(refreshedCcSwitch.body.turns[2].usage.total, 330);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const missingCcSwitchDb = path.join(root, "missing-cc-switch.db");
  const missingPort = await freePort();
  const missingServer = helper.startServer({ codexHome, dbPath: serverDb, ccSwitchDbPath: missingCcSwitchDb, port: missingPort });
  try {
    const missingFirst = await requestJson(missingPort, "/cc-switch/turns?refresh=1");
    assert.equal(missingFirst.body.refreshing, true);
    const missingCached = await waitForCcSwitchError(missingPort, "missing_db");
    assert.equal(missingCached.body.error, "missing_db");
    fs.copyFileSync(ccSwitchDb, missingCcSwitchDb);
    await requestJson(missingPort, "/cc-switch/turns?refresh=1");
    const recovered = await waitForTurnId(missingPort, "cc-switch:2026-07-06:gpt-5.5:gpt-5.5:");
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.turns.length, 3);
  } finally {
    await new Promise((resolve) => missingServer.close(resolve));
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("codex-local-usage-helper tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
