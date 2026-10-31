/** Where a finished file goes and where a stored file is read from: the host's side of the files family. */
export interface FileStore {
  write(path: string, lines: string[]): void;
  read(path: string): readonly string[] | undefined;
}

/** The lines a game is writing to a file in the data folder; the host's store receives them whole when the file ends. */
export class FileLines {
  private lines: string[] = [];

  constructor(private readonly store: FileStore) {}

  clear(): void {
    this.lines = [];
  }

  add(text: string): void {
    this.lines.push(text);
  }

  /** The chunks of the stored file at `path`, or undefined when no such file exists. */
  read(path: string): readonly string[] | undefined {
    return this.store.read(path);
  }

  end(path: string): void {
    this.store.write(path, [...this.lines]);
  }
}
