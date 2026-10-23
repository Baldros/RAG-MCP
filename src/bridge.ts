import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type CliError = { code: string; message: string; hint?: string };
/** Paginação que a CLI imprime ao lado de data nas listagens. */
export type CliPage = { limit: number | null; offset: number; has_more: boolean };
export type CliResult =
  | { ok: true; data: unknown; page?: CliPage }
  | { ok: false; error: CliError };
export type CliRunner = (args: string[]) => Promise<CliResult>;
export type SpawnCli = (
  executable: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_ERROR_BYTES = 8 * 1024;

function failure(code: string, message: string, hint?: string): CliResult {
  return { ok: false, error: { code, message, ...(hint ? { hint } : {}) } };
}

function timeoutFor(command: string): number {
  if (command === "on" || command === "switch") return 390_000;
  if (command === "off") return 90_000;
  if (command === "search" || command === "doctor") return 120_000;
  return 60_000;
}

export function createCliRunner(
  config: { projectDir?: string; pythonPath?: string },
  spawnCli: SpawnCli = spawn,
): CliRunner {
  return async (args) => {
    if (!config.projectDir) {
      return failure("BRIDGE_CONFIG", "Configure RAG_PROJECT_DIR com a raiz do RAG-Project");
    }
    if (!path.isAbsolute(config.projectDir)) {
      return failure("BRIDGE_CONFIG", "RAG_PROJECT_DIR deve ser um caminho absoluto");
    }
    const projectDir = path.resolve(config.projectDir);
    if (!existsSync(path.join(projectDir, "kb", "cli.py"))) {
      return failure("BRIDGE_CONFIG", `CLI do RAG não encontrada em ${projectDir}`);
    }
    const python = config.pythonPath || path.join(
      projectDir, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    if (!path.isAbsolute(python)) {
      return failure("BRIDGE_CONFIG", "RAG_PYTHON deve ser um caminho absoluto");
    }
    if (!existsSync(python)) {
      return failure("BRIDGE_CONFIG", `Python do RAG não encontrado em ${python}`);
    }

    return new Promise<CliResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let exceeded = false;
      let timedOut = false;
      let settled = false;
      let timer: NodeJS.Timeout;
      const finish = (result: CliResult) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      };
      let child: ChildProcess;
      try {
        child = spawnCli(python, ["-m", "kb.cli", ...args], {
          cwd: projectDir,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        resolve(failure("BRIDGE_SPAWN", `Falha ao iniciar a CLI: ${String(error)}`));
        return;
      }
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutFor(args[0] || ""));

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
          exceeded = true;
          child.kill();
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-MAX_ERROR_BYTES);
      });
      child.on("error", (error) => {
        finish(failure("BRIDGE_SPAWN", `Falha ao iniciar a CLI: ${error.message}`));
      });
      child.on("close", (code) => {
        if (timedOut) {
          finish(failure("BRIDGE_TIMEOUT", "A CLI excedeu o tempo de execução",
            "Consulte rag_session antes de repetir a operação"));
          return;
        }
        if (exceeded) {
          finish(failure("BRIDGE_OUTPUT_TOO_LARGE", "Resposta da CLI excedeu 32 MiB"));
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(stdout.trim());
        } catch {
          finish(failure("BRIDGE_PROTOCOL", "A CLI não retornou um único objeto JSON",
            stderr || undefined));
          return;
        }
        if (!parsed || typeof parsed !== "object" || !("ok" in parsed)) {
          finish(failure("BRIDGE_PROTOCOL", "Envelope JSON inválido da CLI"));
          return;
        }
        const result = parsed as CliResult;
        if (result.ok === false && result.error && typeof result.error.code === "string"
          && typeof result.error.message === "string") {
          finish(result);
        } else if (result.ok === true && code === 0 && "data" in result) {
          finish(result);
        } else {
          finish(failure("BRIDGE_PROTOCOL", `CLI encerrou com código ${code} e resposta inconsistente`,
            stderr || undefined));
        }
      });
    });
  };
}

export function runnerFromEnvironment(): CliRunner {
  return createCliRunner({
    projectDir: process.env.RAG_PROJECT_DIR,
    pythonPath: process.env.RAG_PYTHON,
  });
}
