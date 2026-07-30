// Central config for the local orchestrator. Overridable via env.
import { homedir } from "os";
import { join } from "path";

export const config = {
  version: "0.1.0",

  // Local HTTP/WS server the desktop UI talks to.
  port: Number(process.env.MONOCORE_PORT ?? 8787),

  // GB10 job API, reached over an SSH tunnel.
  gb10: {
    sshHost: process.env.MONOCORE_GB10_HOST ?? "gb10",
    // remote port the FastAPI job API binds on the GB10 (localhost only)
    remotePort: Number(process.env.MONOCORE_GB10_PORT ?? 8788),
    // local end of the `ssh -L` tunnel
    localPort: Number(process.env.MONOCORE_GB10_LOCAL_PORT ?? 8788),
  },

  // Where projects and the SQLite db live locally.
  dataDir:
    process.env.MONOCORE_DATA_DIR ?? join(homedir(), "monocore-projects"),
};

export const gb10BaseUrl = () =>
  `http://127.0.0.1:${config.gb10.localPort}`;
