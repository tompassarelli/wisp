// A dev-loop journey process (wisp:docs/dev.md): it loads the headless
// runtime and reads the native declarations, then waits for one line on stdin
// naming the game's headless project and journey. Only then does it load the
// game's modules, so it plays the code as saved. It prints one JSON line: the
// journey's report.
import { type HeadlessProject, type HeadlessReport, installHeadless, loadMapEntry, playHeadless, readNativeDeclarations } from "./headless";
import { printResult } from "./devResult";

export interface JourneyRequest {
  /** A module exporting the game's HeadlessProject. */
  readonly module: string;
  readonly export: string;
  readonly journey: string;
  readonly clients: number;
}

export type JourneyOutcome = HeadlessReport | { readonly stopped: string };

const describe = (error: unknown) => (error instanceof Error ? error.stack ?? error.message : String(error));

async function readRequest(): Promise<JourneyRequest> {
  for await (const line of console) return JSON.parse(line) as JourneyRequest;
  throw new Error("no request on stdin");
}

async function play(request: JourneyRequest, declarations: ReturnType<typeof readNativeDeclarations>): Promise<HeadlessReport> {
  const module = (await import(request.module)) as Record<string, unknown>;
  const project = module[request.export] as HeadlessProject | undefined;
  if (project === undefined) throw new Error(`${request.module} exports no ${request.export}`);
  const journey = project.journeys[request.journey];
  if (journey === undefined) throw new Error(`journeys: ${Object.keys(project.journeys).join(", ")}`);
  const entry = await loadMapEntry(project.entry);
  const runtime = installHeadless(project.map, declarations);
  try {
    const clients = runtime.clients(entry, Array.from({ length: request.clients }, (_, slot) => slot));
    // The dev loop decides on desyncs; checksums only fingerprint a run.
    return playHeadless(clients, journey, project.map.filePrefix, project.scene, { checksums: false });
  } finally {
    runtime.restore();
  }
}

if (import.meta.main) {
  const declarations = readNativeDeclarations();
  const request = await readRequest();
  let outcome: JourneyOutcome;
  try {
    outcome = await play(request, declarations);
  } catch (error) {
    outcome = { stopped: describe(error) };
  }
  printResult(outcome);
  process.exit(0);
}
