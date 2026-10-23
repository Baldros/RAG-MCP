import * as z from "zod/v4";

/**
 * Descrição de cada parâmetro das ferramentas, num lugar só.
 *
 * O schema zod é imutável, então `param.limit.optional()` devolve outro schema
 * e o mesmo parâmetro pode ser obrigatório numa ferramenta e opcional noutra
 * sem repetir o texto. O que vai aqui é o que o modelo não tem como adivinhar
 * do nome: que collection espera id e não nome, o que muda com expand, e que
 * ingest e reindex devolvem job_id em vez do resultado.
 */
export const param = {
  mode: z.enum(["interaction", "ingestion"]).describe(
    "interaction carrega embedding e reranker, exigido por rag_search; ingestion prepara o " +
    "parser, exigido por rag_ingest e rag_reindex."),
  cancel: z.boolean().describe(
    "true interrompe o job em andamento e encerra a sessão; sem isso, um job ativo faz a " +
    "chamada retornar BUSY sem interrompê-lo."),
  query: z.string().min(1).describe(
    "Pergunta em linguagem natural. Pedido de formato (\"responda em 3 frases\") é descartado " +
    "antes da busca, porque não existe em documento nenhum."),
  collections: z.array(z.string().min(1)).describe(
    "Ids de collection vindos de rag_collections_list, não nomes: nome ou id aproximado " +
    "retorna NOT_FOUND. Limita a busca aos documentos dessas collections."),
  docIds: z.array(z.string().min(1)).describe(
    "Ids de documento vindos de rag_documents_list. Somam-se a collections no escopo."),
  topK: z.int().positive().describe(
    "Quantas passagens devolver. Padrão 5; valor alto custa contexto e não melhora a ordem."),
  expand: z.enum(["section", "chunk"]).describe(
    "section devolve a seção-pai do acerto, que é o texto coerente para ler e citar; chunk " +
    "devolve o trecho cru, útil só para inspecionar a recuperação. Padrão section."),
  rerank: z.boolean().describe(
    "false pula o reranker: responde mais rápido e ordena pior. Padrão true."),
  sectionId: z.string().min(1).describe(
    "Id de seção, vindo de section_id numa passagem de rag_search ou de rag_outline. É o " +
    "caminho para ler a seção inteira quando a passagem vier com truncated true."),
  docId: z.string().min(1).describe(
    "Id de documento, vindo de rag_documents_list ou de doc_id numa passagem de rag_search."),
  pageStart: z.int().positive().describe(
    "Primeira página do intervalo, numerada como no PDF, a partir de 1."),
  pageEnd: z.int().positive().describe(
    "Última página do intervalo. Padrão: a mesma de page_start. Um intervalo longo volta " +
    "cortado, com truncated true e next_page_start para a chamada seguinte."),
  maxDepth: z.int().positive().describe(
    "Nível máximo de heading no sumário: 1 traz só os títulos de topo. Padrão 3."),
  paths: z.array(z.string().min(1)).min(1).describe(
    "Arquivos ou pastas de PDF no disco da máquina do RAG, dentro das raízes que ele permite; " +
    "pasta é varrida recursivamente."),
  collectionTarget: z.string().min(1).describe(
    "Id da collection de destino, criada se ainda não existir."),
  collectionId: z.string().min(1).describe(
    "Id da collection, como devolvido por rag_collections_list. Nome não serve."),
  collectionName: z.string().min(1).describe(
    "Nome legível da collection, usado só quando ela for criada agora."),
  force: z.boolean().describe(
    "true reprocessa documento já indexado em vez de pulá-lo."),
  enrich: z.boolean().describe(
    "false dispensa os resumos gerados pelo LLM, que são a parte mais lenta. Padrão true."),
  reset: z.boolean().describe(
    "true invalida os vetores existentes antes de reembedar. É o que se usa depois de trocar " +
    "o modelo de embedding, porque vetores de modelos diferentes não se comparam."),
  limit: z.int().positive().describe(
    "Itens por página. A resposta traz page.has_more quando ainda há itens além desta página."),
  offset: z.int().nonnegative().describe(
    "Itens a pular antes do primeiro desta página."),
  jobId: z.string().min(1).describe(
    "Id do job, devolvido por rag_ingest e rag_reindex."),
  name: z.string().min(1).describe("Nome legível da collection."),
  description: z.string().describe("Descrição livre da collection."),
  deleteDocuments: z.boolean().describe(
    "true também exclui, com seus vetores, os documentos que ficariam sem nenhuma collection."),
  documentIds: z.array(z.string().min(1)).min(1).describe(
    "Ids de documentos já na base, vindos de rag_documents_list."),
  purgeArtifacts: z.boolean().describe(
    "true também apaga os artefatos de parse em disco. Mantê-los torna uma reingestão futura " +
    "quase instantânea, então o padrão é preservá-los."),
};
