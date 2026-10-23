import { McpServer, type ToolAnnotations } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { CliResult, CliRunner } from "./bridge.js";
import { param } from "./params.js";

const readOnly: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const additive: ToolAnnotations = { destructiveHint: false, openWorldHint: false };
const modifying: ToolAnnotations = { destructiveHint: true, openWorldHint: false };

function option(name: string, value: string | number | undefined): string[] {
  return value === undefined ? [] : [`${name}=${value}`];
}

function enabled(name: string, value: boolean | undefined): string[] {
  return value ? [name] : [];
}

function repeated(name: string, values: string[] | undefined): string[] {
  return values?.map((value) => `${name}=${value}`) || [];
}

function resultForMcp(result: CliResult) {
  const envelope = JSON.stringify(result);
  if (!result.ok) {
    return { content: [{ type: "text" as const, text: envelope }], isError: true };
  }
  return {
    content: [{ type: "text" as const, text: envelope }],
    structuredContent: result,
  };
}

export function createServer(runCli: CliRunner): McpServer {
  const server = new McpServer({ name: "rag-mcp", version: "0.1.0" });

  function register<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    build: (args: z.infer<z.ZodObject<S>>) => string[],
    annotations: ToolAnnotations,
  ) {
    server.registerTool(name, {
      description,
      inputSchema: z.object(shape),
      annotations,
    }, async (args) => resultForMcp(await runCli(build(args))));
  }

  register("rag_on", "Liga explicitamente a sessão RAG no modo escolhido e carrega os modelos desse modo.",
    { mode: param.mode },
    ({ mode }) => ["on", "--mode", mode], modifying);
  register("rag_off", "Desliga a sessão RAG. Se houver job ativo, retorna BUSY; cancel=true interrompe o job e a sessão.",
    { cancel: param.cancel.optional() },
    ({ cancel }) => ["off", ...(cancel ? ["--cancel"] : ["--no-wait"])], modifying);
  register("rag_switch", "Troca explicitamente o modo da sessão RAG. Se houver job ativo, retorna BUSY ou o cancela quando solicitado.",
    { mode: param.mode, cancel: param.cancel.optional() },
    ({ mode, cancel }) => ["switch", "--mode", mode,
      ...(cancel ? ["--cancel"] : ["--no-wait"])], modifying);
  register("rag_session", "Consulta a sessão RAG compartilhada sem carregar modelos.",
    {}, () => ["session"], readOnly);

  register("rag_search", "Busca híbrida em documentos. Requer sessão em modo interaction; não a liga automaticamente.",
    {
      query: param.query,
      collections: param.collections.optional(),
      doc_ids: param.docIds.optional(),
      top_k: param.topK.optional(),
      expand: param.expand.optional(),
      rerank: param.rerank.optional(),
    },
    ({ query, collections, doc_ids, top_k, expand, rerank }) => ["search",
      ...repeated("--collection", collections), ...repeated("--doc-id", doc_ids),
      ...option("--top-k", top_k), ...option("--expand", expand),
      ...(rerank === false ? ["--no-rerank"] : []), "--", query], readOnly);
  register("rag_fetch_section", "Lê texto e metadados de uma seção pelo ID, sem ligar modelos.",
    { section_id: param.sectionId },
    ({ section_id }) => ["fetch", ...option("--section-id", section_id)], readOnly);
  register("rag_fetch_pages", "Lê um intervalo de páginas de um documento pelo ID, sem ligar modelos.",
    { doc_id: param.docId, page_start: param.pageStart, page_end: param.pageEnd.optional() },
    ({ doc_id, page_start, page_end }) => ["fetch", ...option("--doc-id", doc_id),
      ...option("--page-start", page_start), ...option("--page-end", page_end)], readOnly);
  register("rag_outline", "Obtém sumário navegável e metadados de um documento, sem ligar modelos.",
    { doc_id: param.docId, max_depth: param.maxDepth.optional() },
    ({ doc_id, max_depth }) => ["outline", ...option("--max-depth", max_depth), "--", doc_id], readOnly);

  register("rag_ingest", "Inicia ingestão de PDFs e devolve job_id. Requer sessão em modo ingestion; os caminhos devem ser permitidos pelo RAG.",
    {
      paths: param.paths,
      collection: param.collectionTarget.optional(),
      collection_name: param.collectionName.optional(),
      force: param.force.optional(),
      enrich: param.enrich.optional(),
    },
    ({ paths, collection, collection_name, force, enrich }) => ["ingest", "--background",
      ...option("--collection", collection), ...option("--collection-name", collection_name),
      ...enabled("--force", force), ...(enrich === false ? ["--no-enrich"] : []),
      "--", ...paths], modifying);
  register("rag_reindex", "Inicia reconstrução dos vetores e devolve job_id. Requer modo ingestion; reset invalida os vetores existentes.",
    { collection: param.collectionId.optional(), reset: param.reset.optional() },
    ({ collection, reset }) => ["reindex", "--background", ...option("--collection", collection),
      ...enabled("--reset", reset)], modifying);
  register("rag_jobs_list", "Lista jobs paginados, inclusive concluídos e com falha.",
    { limit: param.limit.optional(), offset: param.offset.optional() },
    ({ limit, offset }) => ["jobs", "list", ...option("--limit", limit ?? 10),
      ...option("--offset", offset ?? 0)], readOnly);
  register("rag_jobs_show", "Mostra progresso, estado e erro de um job pelo ID.",
    { job_id: param.jobId },
    ({ job_id }) => ["jobs", "show", "--", job_id], readOnly);
  register("rag_jobs_cancel", "Cancela o job ativo pelo ID e encerra a sessão RAG, conforme a CLI.",
    { job_id: param.jobId },
    ({ job_id }) => ["jobs", "cancel", "--", job_id], modifying);

  register("rag_collections_list", "Lista collections e contagens de documentos, páginas e chunks, com paginação.",
    { limit: param.limit.optional(), offset: param.offset.optional() },
    ({ limit, offset }) => ["collections", "list", ...option("--limit", limit ?? 50),
      ...option("--offset", offset ?? 0)], readOnly);
  register("rag_collections_show", "Mostra os metadados de uma collection pelo ID.",
    { collection: param.collectionId },
    ({ collection }) => ["collections", "show", "--", collection], readOnly);
  register("rag_collections_create", "Cria uma collection; se o ID já existir, a CLI devolve a existente.",
    { collection: param.collectionId, name: param.name.optional(),
      description: param.description.optional() },
    ({ collection, name, description }) => ["collections", "create",
      ...option("--name", name), ...option("--description", description), "--", collection], additive);
  register("rag_collections_update", "Atualiza nome e/ou descrição de uma collection existente.",
    { collection: param.collectionId, name: param.name.optional(),
      description: param.description.optional() },
    ({ collection, name, description }) => ["collections", "update",
      ...option("--name", name), ...option("--description", description), "--", collection], modifying);
  register("rag_collections_delete", "Exclui uma collection. delete_documents também remove documentos que ficariam sem collection.",
    { collection: param.collectionId, delete_documents: param.deleteDocuments.optional() },
    ({ collection, delete_documents }) => ["collections", "delete",
      ...enabled("--delete-documents", delete_documents), "--", collection], modifying);
  register("rag_collections_add_docs", "Associa documentos existentes a uma collection.",
    { collection: param.collectionId, doc_ids: param.documentIds },
    ({ collection, doc_ids }) => ["collections", "add-docs", "--", collection, ...doc_ids], additive);
  register("rag_collections_remove_docs", "Remove associações de documentos com uma collection; não exclui os documentos.",
    { collection: param.collectionId, doc_ids: param.documentIds },
    ({ collection, doc_ids }) => ["collections", "remove-docs", "--", collection, ...doc_ids], modifying);

  register("rag_documents_list", "Lista metadados de documentos, opcionalmente por collection, com paginação.",
    { collection: param.collectionId.optional(), limit: param.limit.optional(),
      offset: param.offset.optional() },
    ({ collection, limit, offset }) => ["documents", "list", ...option("--collection", collection),
      ...option("--limit", limit ?? 50), ...option("--offset", offset ?? 0)], readOnly);
  register("rag_documents_show", "Mostra todos os metadados de um documento pelo ID.",
    { doc_id: param.docId },
    ({ doc_id }) => ["documents", "show", "--", doc_id], readOnly);
  register("rag_documents_delete", "Exclui documento, seções, chunks e vetores. purge_artifacts também remove artefatos de parse.",
    { doc_id: param.docId, purge_artifacts: param.purgeArtifacts.optional() },
    ({ doc_id, purge_artifacts }) => ["documents", "delete",
      ...enabled("--purge-artifacts", purge_artifacts), "--", doc_id], modifying);

  register("rag_status", "Obtém estado, contagens, collections, avisos e memória GPU sem carregar modelos.",
    { collection: param.collectionId.optional() },
    ({ collection }) => ["status", ...option("--collection", collection)], readOnly);
  register("rag_doctor", "Confere consistência entre SQLite, vetores e artefatos, sem carregar modelos.",
    {}, () => ["doctor"], readOnly);
  register("rag_models", "Mostra providers e modelos configurados e o estado da sessão, sem carregá-los.",
    {}, () => ["models"], readOnly);

  return server;
}
