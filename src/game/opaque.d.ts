declare const brand: unique symbol;

/** A value the game API hands out and takes back whole: a game holds it, compares it and passes it on, and does not read it. */
export type Opaque<Name extends string> = { readonly [brand]: Name };
