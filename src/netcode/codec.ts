import type { WireReader } from "./wire";

export interface RowCodec<Row> {
  neutral(this: void): Row;
  copy(this: void, target: Row, source: Readonly<Row>): void;
  same(this: void, a: Readonly<Row>, b: Readonly<Row>): boolean;
  hold(this: void, target: Row, previous: Readonly<Row>): void;
  urgent(this: void, row: Readonly<Row>): boolean;
  write(this: void, row: Readonly<Row>, previous: Readonly<Row>): string;
  read(this: void, reader: WireReader, previous: Readonly<Row>, target: Row): boolean;
}

export function holds<Row>(codec: RowCodec<Row>, row: Readonly<Row>, previous: Readonly<Row>, scratch: Row): boolean {
  codec.hold(scratch, previous);
  return codec.same(row, scratch);
}
