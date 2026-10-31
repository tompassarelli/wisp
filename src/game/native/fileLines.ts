/** The lines a game is writing to a file in the data folder; the host's sink receives them whole when the file ends. */
export class FileLines {
  private lines: string[] = [];

  constructor(private readonly write: (this: void, path: string, lines: string[]) => void) {}

  clear(): void {
    this.lines = [];
  }

  add(text: string): void {
    this.lines.push(text);
  }

  end(path: string): void {
    this.write(path, [...this.lines]);
  }
}
