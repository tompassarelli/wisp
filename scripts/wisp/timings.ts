// Wisp measures itself with Effect spans. A step is a span marked as one;
// when it ends, the tracer prints its end time from the start of its outermost
// step and its own duration. Span times come from the Effect Clock, so a test
// clock drives them too.
import { Cause, Effect, Exit, Layer, Option, Tracer } from "effect";

const STEP = "wisp.step";

/**
 * Runs `effect` as a step. A root step starts its own timeline, as each hot
 * reload does inside the long-running `hot` command.
 */
export const step = (name: string, options: { readonly root?: boolean } = {}) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.withSpan(effect, name, { attributes: { [STEP]: true }, ...(options.root === true ? { root: true } : {}) });

const isStep = (span: Tracer.AnySpan): span is Tracer.Span => span._tag === "Span" && span.attributes.get(STEP) === true;

/** The outermost step around `span`, or `span` itself. */
function outermostStep(span: Tracer.Span): Tracer.Span {
  let outermost = span;
  for (let parent = span.parent; Option.isSome(parent) && parent.value._tag === "Span"; parent = parent.value.parent) {
    if (isStep(parent.value)) outermost = parent.value;
  }
  return outermost;
}

const seconds = (nanos: bigint) => (Number(nanos) / 1e9).toFixed(3);

function outcome(exit: Exit.Exit<unknown, unknown>): string {
  if (Exit.isSuccess(exit)) return "";
  return Cause.hasInterruptsOnly(exit.cause) ? " interrupted" : " failed";
}

/** A tracer that prints each step as it ends: `END s  NAME (DURATION s)`. */
export function timings(print: (line: string) => void): Tracer.Tracer {
  class StepSpan extends Tracer.NativeSpan {
    override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
      super.end(endTime, exit);
      if (!isStep(this)) return;
      const from = outermostStep(this).status.startTime;
      print(`${seconds(endTime - from).padStart(8)} s  ${this.name}${outcome(exit)} (${seconds(endTime - this.startTime)} s)`);
    }
  }
  return Tracer.make({ span: (options) => new StepSpan(options) });
}

export const timingsLayer = (print: (line: string) => void) => Layer.succeed(Tracer.Tracer, timings(print));
