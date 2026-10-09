export const NATIVE_ROWS = [
  [
    "config=cast-field-1 level=1 acas=1 initial=40 periodic=10 duration=6",
    "sample-unit=1/32-second damage-unit=1/256-life", "order-accepted=true",
    "change sample=17 elapsed-ms=531 damage256=10240 life256=245760",
    "change sample=49 elapsed-ms=1531 damage256=2560 life256=243200",
    "change sample=81 elapsed-ms=2531 damage256=2560 life256=240640",
    "change sample=113 elapsed-ms=3531 damage256=2560 life256=238080",
    "change sample=145 elapsed-ms=4531 damage256=2560 life256=235520",
    "change sample=177 elapsed-ms=5531 damage256=2560 life256=232960",
    "end sample=256 life256=232960",
  ],
  [
    "config=cast-field-2 level=1 acas=2 initial=40 periodic=10 duration=6",
    "sample-unit=1/32-second damage-unit=1/256-life", "order-accepted=true",
    "change sample=17 elapsed-ms=531 damage256=10240 life256=245760",
    "change sample=81 elapsed-ms=2531 damage256=2560 life256=243200",
    "change sample=145 elapsed-ms=4531 damage256=2560 life256=240640",
    "end sample=256 life256=240640",
  ],
] as const;
