// Native expectations follow wisp:docs/warsmash-notes.md, Script rules outside the six families.

export const EXPECTED = [
  "r2s=1.000,0.100,-1.500,123456.789,0.000",
  "r2s-ties=0.063,0.313,-0.063,0.188",
  "r2sw=     1.50,-0.063,3.0,3.0",
  "i2s=0,-7,2147483647,-2147483648",
  "r2i=1,-1,0,0",
  "s2i=12,12,-7,5,0,0,2147483647,3,12,0",
  "s2r=192,64,-288,128,0,0,384",
  "player-controllers=user,user,none,none",
  "player-slot-states=playing,playing,empty,empty",
  "frame-children=3,ScriptRulesFirst,ScriptRulesSecond,0",
  "frame-enabled-default=true",
  "frame-text-read=abc",
  "frame-text-limit-default=-256",
  "frame-text-limit-on-set=abc",
  "frame-visible-under-hidden-parent=false,false",
];

export const EXPECTED_SYNC = [
  "sync-send-returns=1,1,1,1,1,1",
  "sync-order-from-p0=Aa0,Ba0,Ab0,Bb0",
  "sync-order-from-p1=Aa1,Ba1,Ab1,Bb1",
  "sync-lengths-from-p0=200,251,252,255",
  "sync-lengths-from-p1=200,251,252,255",
  "sync-sender-mismatches=",
  "trigger-destroyed-in-own-action=12",
];
