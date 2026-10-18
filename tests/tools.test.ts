import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { ChildProcess } from "node:child_process";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createCliRunner, type CliResult, type CliRunner, type SpawnCli } from "../src/bridge.js";
import { createServer } from "../src/tools.js";

async function connected(runCli: CliRunner) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(runCli);
  const client = new Client({ name: "rag-mcp-test", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("every functional CLI operation has a typed MCP tool and fixed argv mapping", async () => {
  const calls: string[][] = [];
  const { client, server } = await connected(async (args) => {
    calls.push(args);
    return { ok: true, data: { args } };
  });
  try {
    const cases: Array<[string, Record<string, unknown>, string[]]> = [
      ["rag_on", { mode: "interaction" }, ["on", "--mode", "interaction"]],
      ["rag_off", {}, ["off", "--no-wait"]],
      ["rag_switch", { mode: "ingestion" }, ["switch", "--mode", "ingestion", "--no-wait"]],
      ["rag_session", {}, ["session"]],
      ["rag_search", { query: "--strange;$(echo x)", collections: ["Physics A"],
        doc_ids: ["doc 1"], top_k: 3, expand: "chunk", rerank: false },
        ["search", "--collection=Physics A", "--doc-id=doc 1", "--top-k=3",
          "--expand=chunk", "--no-rerank", "--", "--strange;$(echo x)"]],
      ["rag_fetch_section", { section_id: "--section" }, ["fetch", "--section-id=--section"]],
      ["rag_fetch_pages", { doc_id: "doc", page_start: 2, page_end: 4 },
        ["fetch", "--doc-id=doc", "--page-start=2", "--page-end=4"]],
      ["rag_outline", { doc_id: "doc" }, ["outline", "--", "doc"]],
      ["rag_ingest", { paths: ["E:\\Estudo\\Meu Livro;$(echo x).pdf"] },
        ["ingest", "--background", "--", "E:\\Estudo\\Meu Livro;$(echo x).pdf"]],
      ["rag_reindex", { reset: true }, ["reindex", "--background", "--reset"]],
      ["rag_jobs_list", {}, ["jobs", "list", "--limit=10", "--offset=0"]],
      ["rag_jobs_show", { job_id: "j" }, ["jobs", "show", "--", "j"]],
      ["rag_jobs_cancel", { job_id: "j" }, ["jobs", "cancel", "--", "j"]],
      ["rag_collections_list", {}, ["collections", "list", "--limit=50", "--offset=0"]],
      ["rag_collections_show", { collection: "c" }, ["collections", "show", "--", "c"]],
      ["rag_collections_create", { collection: "c", name: "Name" },
        ["collections", "create", "--name=Name", "--", "c"]],
      ["rag_collections_update", { collection: "c", description: "Description" },
        ["collections", "update", "--description=Description", "--", "c"]],
      ["rag_collections_delete", { collection: "c", delete_documents: true },
        ["collections", "delete", "--delete-documents", "--", "c"]],
      ["rag_collections_add_docs", { collection: "c", doc_ids: ["d1", "d2"] },
        ["collections", "add-docs", "--", "c", "d1", "d2"]],
      ["rag_collections_remove_docs", { collection: "c", doc_ids: ["d1"] },
        ["collections", "remove-docs", "--", "c", "d1"]],
      ["rag_documents_list", {}, ["documents", "list", "--limit=50", "--offset=0"]],
      ["rag_documents_show", { doc_id: "d" }, ["documents", "show", "--", "d"]],
      ["rag_documents_delete", { doc_id: "d", purge_artifacts: true },
        ["documents", "delete", "--purge-artifacts", "--", "d"]],
      ["rag_status", {}, ["status"]],
      ["rag_doctor", {}, ["doctor"]],
      ["rag_models", {}, ["models"]],
    ];

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(),
      cases.map(([name]) => name).sort());
    for (const [name, input, expected] of cases) {
      const result = await client.callTool({ name, arguments: input });
      assert.equal(result.isError, undefined, name);
      assert.deepEqual(calls.at(-1), expected, name);
      assert.deepEqual(result.structuredContent, { ok: true, data: { args: expected } }, name);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test("two MCP clients share one RAG session; no tool implicitly starts it", async () => {
  let mode: "interaction" | "ingestion" | undefined;
  const commands: string[] = [];
  const runCli: CliRunner = async (args) => {
    commands.push(args[0]);
    if (args[0] === "on") mode = args[2] as typeof mode;
    if (args[0] === "off") mode = undefined;
    if (args[0] === "session") return { ok: true, data: { active: !!mode, ...(mode ? { mode } : {}) } };
    if (args[0] === "search" && !mode) return { ok: false, error: {
      code: "SESSION_OFF", message: "RAG desligado", hint: "Use rag_on",
    } };
    return { ok: true, data: { active: !!mode } };
  };
  const first = await connected(runCli);
  const second = await connected(runCli);
  let firstClosed = false;
  try {
    const off = await first.client.callTool({ name: "rag_search", arguments: { query: "x" } });
    assert.equal(off.isError, true);
    assert.match(JSON.stringify(off.content), /SESSION_OFF/);
    assert.match(JSON.stringify(off.content), /rag_on/);
    assert.deepEqual(commands, ["search"]);
    await first.client.callTool({ name: "rag_on", arguments: { mode: "interaction" } });
    await first.client.close();
    await first.server.close();
    firstClosed = true;
    const shared = await second.client.callTool({ name: "rag_session", arguments: {} });
    assert.deepEqual(shared.structuredContent, {
      ok: true, data: { active: true, mode: "interaction" },
    });
    await second.client.callTool({ name: "rag_off", arguments: {} });
    const ended = await second.client.callTool({ name: "rag_session", arguments: {} });
    assert.deepEqual(ended.structuredContent, { ok: true, data: { active: false } });
  } finally {
    if (!firstClosed) {
      await first.client.close();
      await first.server.close();
    }
    await second.client.close();
    await second.server.close();
  }
});

test("bridge spawns only Python module arguments, never a shell", async () => {
  let executable = "";
  let argv: string[] = [];
  let shell: unknown;
  let cwd = "";
  const fakeSpawn: SpawnCli = (command, args, options) => {
    executable = command;
    argv = args;
    shell = options.shell;
    cwd = String(options.cwd);
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdout, stderr, kill: () => true,
    }) as unknown as ChildProcess;
    queueMicrotask(() => {
      stdout.write(JSON.stringify({ ok: true, data: { accepted: true } }));
      child.emit("close", 0);
    });
    return child;
  };
  const projectDir = process.env.RAG_PROJECT_DIR || path.resolve(process.cwd(), "..", "..", "Rag-Project");
  const run = createCliRunner({ projectDir, pythonPath: process.execPath }, fakeSpawn);
  const output: CliResult = await run(["search", "--", "x;$(echo injected)"]);
  assert.equal(output.ok, true);
  assert.equal(executable, process.execPath);
  assert.deepEqual(argv, ["-m", "kb.cli", "search", "--", "x;$(echo injected)"]);
  assert.equal(shell, false);
  assert.equal(cwd, projectDir);
});
