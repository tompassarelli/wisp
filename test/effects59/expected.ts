export const EXPECTED = [
  "created-at-point=12832,-6464,0",
  "position-read-in-same-call=96,-2592,38496",
  "axis-setters-independent=-1024,4096,576",
  "scale-zero-parked=8192,4096,-537088",
  "scale-orientation-time-keep-position=1280,2560,3840",
  "destroyed-frozen-reads=-25600,0,0",
  "held-after-quarter-second=96,6144,12288,96,6144,12288",
];

export const DEATH_TIMELINE = [0, 60, 118, 122, 299, 300, 600].flatMap(frame => {
  const drawn = frame < 300 ? "-200 death,200 death" : "";
  return [0, 1].map(slot => `p${slot} drawn@${frame}=${drawn}`);
});
