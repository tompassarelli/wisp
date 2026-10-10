import { type HeadlessProject, type HeadlessReport, installHeadless, loadMapEntry, playHeadless, readNativeDeclarations } from "./headless";
import { printResult } from "./devResult";
import { describeStack } from "./command";

export interface JourneyRequest {

  readonly module: string;
  readonly export: string;
  readonly journey: string;
  readonly clients: number;
}

export type JourneyOutcome = HeadlessReport | { readonly stopped: string };

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
    outcome = { stopped: describeStack(error) };
  }
  printResult(outcome);
  process.exit(0);
}
