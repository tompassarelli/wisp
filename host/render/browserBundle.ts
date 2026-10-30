const bundles = new Map<string, Promise<string>>();

const bundleProblem = (cause: unknown) => {
  const details = cause instanceof AggregateError ? cause.errors.map((error) => (error instanceof Error ? error.message : String(error))) : [];
  return new Error([cause instanceof Error ? cause.message : String(cause), ...details].join("\n"));
};

const build = async (entry: string) => {
  const result = await Bun.build({ entrypoints: [entry], target: "browser", minify: true }).catch((cause) => { throw bundleProblem(cause); });
  if (!result.success || result.outputs[0] === undefined) throw new Error(result.logs.join("\n"));
  return result.outputs[0].text();
};

export const browserBundle = (entry: string): Promise<string> => {
  const cached = bundles.get(entry);
  if (cached !== undefined) return cached;
  const started = build(entry);
  bundles.set(entry, started);
  started.catch(() => bundles.delete(entry));
  return started;
};
