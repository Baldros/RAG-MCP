import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const serverPath = fileURLToPath(new URL("../src/server.js", import.meta.url));

function transport(overrides: Record<string, string>) {
  return new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, ...overrides } as Record<string, string>,
  });
}

test("stdio lists tools without invoking Python or loading models", async () => {
  const client = new Client({ name: "stdio-test", version: "0.1.0" });
  await client.connect(transport({ RAG_PROJECT_DIR: "Z:\\nonexistent-rag", RAG_PYTHON: "Z:\\nonexistent-python" }));
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 26);
    const result = await client.callTool({ name: "rag_session", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /BRIDGE_CONFIG/);
  } finally {
    await client.close();
  }
});

test("stdio reads real RAG CLI metadata without starting a session", {
  skip: !process.env.RAG_PROJECT_DIR || !process.env.RAG_PYTHON ||
    !existsSync(path.join(process.env.RAG_PROJECT_DIR || "", "kb", "cli.py")),
}, async () => {
  const client = new Client({ name: "stdio-real-cli-test", version: "0.1.0" });
  const peer = new Client({ name: "stdio-real-cli-peer", version: "0.1.0" });
  await client.connect(transport({
    RAG_PROJECT_DIR: process.env.RAG_PROJECT_DIR!,
    RAG_PYTHON: process.env.RAG_PYTHON!,
  }));
  await peer.connect(transport({
    RAG_PROJECT_DIR: process.env.RAG_PROJECT_DIR!,
    RAG_PYTHON: process.env.RAG_PYTHON!,
  }));
  try {
    const before = await client.callTool({ name: "rag_session", arguments: {} });
    assert.equal(before.isError, undefined);
    const models = await client.callTool({ name: "rag_models", arguments: {} });
    assert.equal(models.isError, undefined);
    const collections = await client.callTool({ name: "rag_collections_list", arguments: { limit: 1 } });
    assert.equal(collections.isError, undefined);
    const after = await peer.callTool({ name: "rag_session", arguments: {} });
    assert.deepEqual(after.structuredContent, before.structuredContent);
    if ((before.structuredContent as { data?: { active?: boolean } }).data?.active === false) {
      const search = await client.callTool({ name: "rag_search", arguments: { query: "teste" } });
      assert.equal(search.isError, true);
      assert.match(JSON.stringify(search.content), /SESSION_OFF/);
    }
  } finally {
    await client.close();
    await peer.close();
  }
});
