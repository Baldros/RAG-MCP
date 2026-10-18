# RAG-MCP

Servidor MCP local que expõe a CLI do [RAG-Project](https://github.com/Baldros/Rag-Project) como ferramentas tipadas. O MCP não acessa SQLite, Chroma, modelos ou o pipe privado do RAG. Cada chamada executa somente `python -m kb.cli` com um comando conhecido e devolve o envelope JSON da CLI.

O servidor usa **stdio**. Um cliente MCP local, como o Codex, inicia o processo Node quando se conecta e pode deixá-lo ativo. Não há porta ou serviço HTTP para subir separadamente. Esse processo não inicia Python nem carrega modelos ao abrir a conexão ou listar ferramentas. A sessão RAG é única e compartilhada entre clientes e só muda com as ferramentas explícitas `rag_on`, `rag_switch` e `rag_off`. Fechar o MCP não desliga a sessão: use `rag_off` quando terminar.

## Preparação

Requer Node.js 24 ou superior e uma instalação funcional do RAG-Project com sua `.venv`. O RAG-Project precisa incluir as opções de paginação e `--no-wait` da CLI entregues junto deste projeto.

```powershell
Set-Location E:\MCPs\RAG-MCP
npm ci
npm run build
```

Se o `npm` do PATH reclamar de `Cannot find module ...npm-cli.js`, use o executável instalado com Node diretamente, por exemplo:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' ci
& 'C:\Program Files\nodejs\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run build
```

Configure as variáveis de ambiente do processo MCP:

| Variável | Papel |
|---|---|
| `RAG_PROJECT_DIR` | Raiz absoluta do RAG-Project; obrigatória. |
| `RAG_PYTHON` | Caminho absoluto do Python da instalação do RAG; opcional. No Windows, o padrão é `<RAG_PROJECT_DIR>\.venv\Scripts\python.exe`. |

Um caminho inválido não impede o MCP de listar suas ferramentas, mas as chamadas devolvem `BRIDGE_CONFIG`. O processo usa `spawn` com `shell: false`; entradas como consulta, IDs e caminhos são argumentos separados, nunca comandos de shell.

## Ferramentas

| Grupo | Ferramentas |
|---|---|
| Sessão | `rag_on`, `rag_off`, `rag_switch`, `rag_session` |
| Recuperação | `rag_search`, `rag_fetch_section`, `rag_fetch_pages`, `rag_outline` |
| Ingestão | `rag_ingest`, `rag_reindex`, `rag_jobs_list`, `rag_jobs_show`, `rag_jobs_cancel` |
| Collections | `rag_collections_list`, `rag_collections_show`, `rag_collections_create`, `rag_collections_update`, `rag_collections_delete`, `rag_collections_add_docs`, `rag_collections_remove_docs` |
| Documentos | `rag_documents_list`, `rag_documents_show`, `rag_documents_delete` |
| Diagnóstico | `rag_status`, `rag_doctor`, `rag_models` |

Busca requer o modo `interaction`; ingestão e reindexação requerem `ingestion`. Nenhuma dessas ferramentas liga ou troca o modo automaticamente: `SESSION_OFF` e `WRONG_MODE` retornam com a sugestão da CLI. `rag_ingest` e `rag_reindex` sempre iniciam em segundo plano e devolvem `job_id`; acompanhe com `rag_jobs_show`. As listagens usam páginas de 50 itens por padrão, exceto jobs (10), e aceitam `limit` e `offset`.

`rag_off` e `rag_switch` retornam `BUSY` se houver job ativo. O parâmetro `cancel: true` encerra o job antes da transição. `rag_jobs_cancel` também encerra a sessão, conforme a CLI. Exclusões e `reset` podem remover dados ou vetores; confira os argumentos antes de chamá-los.

As respostas bem-sucedidas preservam `{ "ok": true, "data": ... }` em texto e conteúdo estruturado MCP. Falhas preservam `{ "ok": false, "error": { "code", "message", "hint" } }` como erro de ferramenta.

## Exemplo de instalação no Codex

Você pode adicionar o trecho abaixo a `C:\Users\amori\.codex\config.toml` **quando quiser instalar o MCP**. Este repositório não altera essa configuração. Use caminhos absolutos e ajuste `command` caso seu Node esteja em outro local.

```toml
[mcp_servers.rag-mcp]
command = "C:\\Program Files\\nodejs\\node.exe"
args = ["E:\\MCPs\\RAG-MCP\\dist\\src\\server.js"]
startup_timeout_sec = 30
tool_timeout_sec = 420

[mcp_servers.rag-mcp.env]
RAG_PROJECT_DIR = "E:\\Rag-Project"
RAG_PYTHON = "E:\\Rag-Project\\.venv\\Scripts\\python.exe"
```

O tempo maior de ferramenta permite que `rag_on` e `rag_switch` aguardem o carregamento explícito dos modelos. O Codex inicia o servidor stdio ao conectar; não execute `node dist/src/server.js` separadamente como um serviço. O processo Node pode existir enquanto o RAG permanece desligado. A [documentação oficial do Codex](https://developers.openai.com/codex/mcp) descreve as opções `command`, `args`, `env` e os tempos de execução.

## Testes

```powershell
Set-Location E:\MCPs\RAG-MCP
$env:RAG_PROJECT_DIR = 'E:\Rag-Project'
$env:RAG_PYTHON = 'E:\Rag-Project\.venv\Scripts\python.exe'
npm test
```

Os testes usam o protocolo MCP por stdio, exercitam as 26 ferramentas e verificam chamadas reais de metadados na CLI sem carregar modelos. A integração com a CLI real roda quando ambas as variáveis acima estão definidas. Os testes não ligam a sessão RAG nem registram o MCP em cliente algum.
