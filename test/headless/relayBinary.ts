import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

/** The relay binary a test runs: `WISP_RELAY_BIN` when set, else a release build of relay/. */
export async function relayBinary(): Promise<string> {
  const override = process.env["WISP_RELAY_BIN"];
  if (override !== undefined) return override;
  const build = Bun.spawn(["cargo", "build", "--release", "-p", "relay"], { cwd: join(root, "relay"), stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const [code, stderr] = await Promise.all([build.exited, new Response(build.stderr).text()]);
  if (code !== 0) throw new Error(`cargo build -p relay failed: ${stderr}`);
  const binary = join(root, "relay/target/release/relay");
  if (!existsSync(binary)) throw new Error(`${binary} was not built`);
  return binary;
}
