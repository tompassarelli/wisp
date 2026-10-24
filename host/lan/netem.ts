export interface Impairment {
  readonly rtt: number;
  readonly loss: number;
  readonly jitter: number;
  readonly burst: boolean;
  readonly port?: number;
}

const BURST_RECOVERY = 25;

const decimal = (value: number) => String(Number(value.toFixed(4)));

export const perSendLoss = (roundTrip: number) => 100 * (1 - Math.sqrt(1 - roundTrip / 100));

export const burstModel = (perSend: number) => ({ enter: perSend * BURST_RECOVERY / (100 - perSend), leave: BURST_RECOVERY });

const lossArguments = ({ loss, burst }: Impairment) => {
  const perSend = perSendLoss(loss);
  if (!burst) return ["loss", `${decimal(perSend)}%`];
  const { enter, leave } = burstModel(perSend);
  return ["loss", "gemodel", `${decimal(enter)}%`, `${decimal(leave)}%`, "100%", "0%"];
};

const netemArguments = (impairment: Impairment) => [
  "netem", "delay", `${decimal(impairment.rtt / 2)}ms`,
  ...(impairment.jitter > 0 ? [`${decimal(impairment.jitter / 2)}ms`] : []),
  ...lossArguments(impairment),
];

export const CLEAR = ["tc", "qdisc", "del", "dev", "lo", "root"] as const;

export const clearedAlready = (stderr: string) => /No such file|handle of zero/.test(stderr);

const portFilter = (direction: "sport" | "dport", port: number) => [
  "tc", "filter", "add", "dev", "lo", "parent", "1:", "protocol", "ip", "prio", "1", "u32",
  "match", "ip", "protocol", "17", "0xff", "match", "ip", direction, String(port), "0xffff", "flowid", "1:2",
];

export const impairCommands = (impairment: Impairment): string[][] => impairment.port === undefined
  ? [["tc", "qdisc", "add", "dev", "lo", "root", ...netemArguments(impairment)]]
  : [
    ["tc", "qdisc", "add", "dev", "lo", "root", "handle", "1:", "prio", "bands", "2", "priomap", ...Array.from({ length: 16 }, () => "0")],
    ["tc", "qdisc", "add", "dev", "lo", "parent", "1:2", "handle", "20:", ...netemArguments(impairment)],
    portFilter("dport", impairment.port),
    portFilter("sport", impairment.port),
  ];

export const impairmentSummary = (impairment: Impairment) => {
  const perSend = perSendLoss(impairment.loss);
  const scope = impairment.port === undefined ? "all loopback traffic" : `UDP to or from port ${impairment.port} only`;
  const delay = `${decimal(impairment.rtt / 2)} ms${impairment.jitter > 0 ? ` ± ${decimal(impairment.jitter / 2)} ms` : ""} per send`;
  if (!impairment.burst) return `${scope}: ${delay}, ${decimal(perSend)}% of sends lost independently`;
  const { enter, leave } = burstModel(perSend);
  return `${scope}: ${delay}, bursty loss (gemodel p ${decimal(enter)}% r ${decimal(leave)}% 1-h 100% 1-k 0%: ${decimal(perSend)}% of sends, mean burst ${decimal(100 / leave)} sends)`;
};
