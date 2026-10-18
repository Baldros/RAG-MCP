import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { runnerFromEnvironment } from "./bridge.js";
import { createServer } from "./tools.js";

const runCli = runnerFromEnvironment();
serveStdio(() => createServer(runCli));
