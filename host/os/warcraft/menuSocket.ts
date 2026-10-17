import { type Effect, Schema } from "effect";

export class MenuFailure extends Schema.TaggedError<MenuFailure>()("MenuFailure", {
  operation: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.operation}: ${this.problem}`;
  }
}

export interface MenuEvent {
  readonly messageType: string;
  readonly payload: unknown;
}

export type Outcome<A> = { readonly done: A } | { readonly failed: string } | undefined;

export interface MenuSocket {
  readonly buildId?: string;

  readonly send: (message: string, payload?: Readonly<Record<string, unknown>>) => Effect.Effect<void, MenuFailure>;

  readonly expect: <A>(what: string, seconds: number, decide: (event: MenuEvent) => Outcome<A>) => Effect.Effect<A, MenuFailure>;

  readonly forget: Effect.Effect<void>;
}
