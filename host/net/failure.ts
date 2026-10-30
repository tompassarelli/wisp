import { Schema } from "effect";

export class NetFailure extends Schema.TaggedError<NetFailure, { readonly brand: unique symbol }>()("NetFailure", { problem: Schema.String }) {
  override get message(): string {
    return this.problem;
  }
}
