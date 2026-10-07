import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startHost, type LanHost } from "./host";
import type { MapFacts } from "./map";

interface DummyOptions {
  readonly program: string;
  readonly map: MapFacts;
  readonly count: number;
  readonly output: string;
  readonly nativeVersion?: string;
  readonly joinNative: (host: LanHost, gameName: string) => Promise<void>;
  readonly announcePorts?: readonly number[];
}

const until = async (ready: () => boolean, description: string) => {
  const deadline = performance.now() + 10_000;
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await Bun.sleep(10);
  }
};
const residentKiB = (pid: number) => {
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  return Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0);
};

/** Runs the unmodified GoWarcraft3 command, never a map simulation. */
export async function checkDummy(options: DummyOptions) {
  mkdirSync(options.output, { recursive: true });
  const lines: string[] = [];
  const packets = join(options.output, "packets.log");
  const gameName = `wisp-dummy-${Date.now()}`;
  const host = startHost({
    map: options.map, clients: ["native", "dummy"], gameName, autoStart: false,
    ...(options.announcePorts === undefined ? {} : { announcePorts: options.announcePorts }),
    log: (line) => { lines.push(line); appendFileSync(join(options.output, "actions.log"), `${line}\n`); },
    onPacket: (direction, label, bytes) => appendFileSync(packets, `${performance.now().toFixed(3)} ${direction} ${label} ${Buffer.from(bytes).toString("hex")}\n`),
  });
  const runs: { joinMs: number; wallMs: number; cpuMs: number; cpuCores: number; rssKiB: number }[] = [];
  const nativePid = host.slots().slots.find((slot) => slot.status === 0)?.color;
  if (nativePid !== 0) { host.stop(); throw new Error("the upstream command requires the real player in player slot 1"); }
  let child: Bun.Subprocess<"pipe", "pipe", "pipe"> | undefined;
  try {
    await options.joinNative(host, gameName);
    await until(() => host.status().players[0]?.connected === true && lines.some((line) => line.includes("map native has it")), "the native player's map check");
    for (let index = 0; index < options.count; index++) {
      const before = lines.length;
      const started = performance.now();
      child = Bun.spawn([options.program, "-v", "10200", "-dial=false", "-n", `dummy${index + 1}`, "127.0.0.1", String(host.port)], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      const stdout = new Response(child.stdout).text();
      const stderr = new Response(child.stderr).text();
      try {
        await until(() => lines.slice(before).some((line) => line.includes("map dummy has it")), "the dummy's map check");
        const joinMs = performance.now() - started;
        const dummyPid = host.status().players[1]?.pid;
        if (dummyPid === undefined) throw new Error("the dummy has no player slot");
        host.say(1, dummyPid, ".handicap 90");
        await until(() => host.slots().slots.some((slot) => slot.playerId === dummyPid && slot.handicap === 90), "handicap 90");
        await Bun.sleep(250);
        const rssKiB = residentKiB(child.pid);
        host.say(1, dummyPid, ".leave");
        await until(() => host.status().players[1]?.connected === false, "the dummy to leave");
        child.stdin.end();
        await child.exited;
        const wallMs = performance.now() - started;
        const resources = child.resourceUsage();
        if (resources === undefined) throw new Error("the dummy's CPU usage is unavailable");
        const cpuMs = Number(resources.cpuTime.total) / 1000;
        const out = await stdout;
        const err = await stderr;
        writeFileSync(join(options.output, `dummy-${index + 1}.log`), out + err);
        if (err.includes("[ERROR]") || out.includes("[ERROR]")) throw new Error(`dummy ${index + 1} reported a protocol error; see its log and ${packets}`);
        runs.push({ joinMs, wallMs, cpuMs, cpuCores: cpuMs / wallMs, rssKiB });
        console.log(`dummy ${index + 1}/${options.count}: joined in ${joinMs.toFixed(1)} ms, handicap 90, left`);
      } finally {
        if (child.exitCode === null) child.kill("SIGTERM");
        await child.exited;
        const out = await stdout;
        const err = await stderr;
        writeFileSync(join(options.output, `dummy-${index + 1}.log`), out + err);
        child = undefined;
      }
    }
    const result = { protocolVersion: 10200, nativeVersion: options.nativeVersion, program: options.program, completed: runs.length, unexplainedFailures: 0, runs };
    writeFileSync(join(options.output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    child?.kill("SIGTERM");
    host.stop();
  }
}
