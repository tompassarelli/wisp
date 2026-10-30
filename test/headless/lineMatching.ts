/** The first match of `pattern` in a child's output stream, read until it appears; the stream stays readable afterwards. */
export async function lineMatching(stream: ReadableStream<Uint8Array>, pattern: RegExp, what: string): Promise<RegExpMatchArray> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`${what} ended before it printed ${pattern}: ${seen}`);
    seen += decoder.decode(value, { stream: true });
    const found = pattern.exec(seen);
    if (found !== null) {
      reader.releaseLock();
      return found;
    }
  }
}
