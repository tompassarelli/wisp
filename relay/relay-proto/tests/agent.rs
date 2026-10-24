use relay_proto::agent::{Agent, AgentConfig, Fed};
use relay_proto::cadence::Cadence;
use relay_proto::wire::{encode_down, Down, Turn, MAX_PACKET, NOT_STARTED};
use relay_proto::Micros;

const TOKEN: u64 = 42;
const DELAY: Micros = 40_000;
const LOBBY_PACKETS: u32 = 1200;
const BASE: Micros = 30_000_000;

struct Bench {
    agent: Agent,
    cadence: Cadence,
    base: Micros,
    seq: u32,
    now: Micros,
    fed: Vec<Fed>,
}

impl Bench {
    fn new() -> Self {
        let cadence = Cadence::new(&[17, 17, 16]);
        let mut agent = Agent::new(AgentConfig::new(TOKEN, cadence.clone()), 0);
        let period = cadence.period_us();
        for i in 0..LOBBY_PACKETS {
            let sent = i as Micros * period;
            let bytes = down(i, sent, NOT_STARTED, 0, &[]);
            agent.on_packet(sent + DELAY, &bytes).unwrap();
        }
        let choice = agent.choose_depth();
        assert!(!choice.too_poor);
        Bench {
            agent,
            cadence,
            base: BASE,
            seq: LOBBY_PACKETS,
            now: 0,
            fed: Vec::new(),
        }
    }

    fn turns(&self, from: u32, to: u32) -> Vec<Turn> {
        (from..to)
            .map(|k| Turn {
                step_ms: self.cadence.step_ms(k),
                actions: vec![],
            })
            .collect()
    }

    fn deliver(&mut self, at: Micros, from: u32, to: u32) {
        let turns = self.turns(from, to);
        let sent = self.base + self.cadence.relay_time(to - 1);
        let bytes = down(self.seq, sent, self.base as u64, from, &turns);
        self.seq += 1;
        self.run_until(at);
        self.now = at;
        self.agent.on_packet(at, &bytes).unwrap();
        self.run_until(at);
    }

    fn run_until(&mut self, t: Micros) {
        loop {
            let wake = self.agent.next_wake().max(self.now);
            if wake > t {
                break;
            }
            self.now = wake;
            let (fed, _) = self.agent.poll(wake);
            self.fed.extend(fed);
        }
    }

    fn depth(&self) -> Micros {
        self.agent.choice().unwrap().turns as Micros * self.cadence.period_us()
    }

    fn nominal(&self, k: u32) -> Micros {
        self.base + self.cadence.relay_time(k) + DELAY + self.depth()
    }
}

fn down(seq: u32, sent: Micros, base: u64, from: u32, turns: &[Turn]) -> Vec<u8> {
    let head = Down {
        token: TOKEN,
        seq,
        sent_us: sent as u64,
        base_us: base,
        action_ack: 0,
        checksum_ack: 0,
        turn_from: from,
        turns: vec![],
    };
    let (bytes, n) = encode_down(&head, turns, MAX_PACKET);
    assert_eq!(n, turns.len());
    bytes
}

fn on_time(b: &mut Bench, from: u32, to: u32) {
    for k in from..to {
        b.deliver(b.base + b.cadence.relay_time(k) + DELAY, k, k + 1);
    }
}

#[test]
fn turns_feed_at_the_anchored_schedule_with_the_relays_steps() {
    let mut b = Bench::new();
    on_time(&mut b, 0, 300);
    b.run_until(b.nominal(299));
    assert_eq!(b.fed.len(), 300);
    for f in &b.fed {
        assert_eq!(f.at, b.nominal(f.index), "turn {}", f.index);
    }
    let gaps: Vec<Micros> = b
        .fed
        .windows(2)
        .take(3)
        .map(|w| w[1].at - w[0].at)
        .collect();
    assert_eq!(gaps, vec![17_000, 17_000, 16_000]);
    assert!(b.agent.stats().underrun_at.is_empty());
}

#[test]
fn an_underrun_waits_and_keeps_at_most_one_turn_of_added_depth() {
    let mut b = Bench::new();
    on_time(&mut b, 0, 10);
    let late = b.nominal(10) + 5_000;
    b.deliver(late, 10, 11);
    assert_eq!(b.agent.stats().underrun_at.len(), 1);
    assert_eq!(b.fed.last().unwrap().at, late);
    assert_eq!(b.agent.extra_us(), 5_000);
    on_time(&mut b, 11, 40);
    b.run_until(b.nominal(39) + 5_000);
    assert_eq!(b.fed[20].at, b.nominal(20) + 5_000);

    let mut c = Bench::new();
    on_time(&mut c, 0, 10);
    let late = c.nominal(10) + 30_000;
    c.deliver(late, 10, 11);
    on_time(&mut c, 11, 60);
    c.run_until(c.nominal(59) + 30_000);
    assert!(!c.agent.catching_up());
    assert_eq!(c.agent.extra_us(), c.cadence.period_us());
}

#[test]
fn added_depth_slews_back_a_millisecond_a_turn_after_thirty_quiet_seconds() {
    let mut b = Bench::new();
    on_time(&mut b, 0, 10);
    b.deliver(b.nominal(10) + 5_000, 10, 11);
    let quiet = 30 * 60;
    on_time(&mut b, 11, quiet + 20);
    b.run_until(b.nominal(quiet + 19) + 5_000);
    assert_eq!(b.agent.extra_us(), 0);
    let first_shift = 11
        + b.fed[11..]
            .iter()
            .position(|f| f.at - b.nominal(f.index) < 5_000)
            .unwrap();
    assert!(b.fed[first_shift].at - b.fed[10].at >= 30_000_000);
    let shifts: Vec<Micros> = b.fed[first_shift..first_shift + 6]
        .iter()
        .map(|f| f.at - b.nominal(f.index))
        .collect();
    assert_eq!(shifts, vec![4_000, 3_000, 2_000, 1_000, 0, 0]);
}

#[test]
fn a_blackout_backlog_drains_at_four_milliseconds_a_turn() {
    let mut b = Bench::new();
    on_time(&mut b, 0, 100);
    let resume = BASE + b.cadence.relay_time(160) + DELAY;
    b.deliver(resume, 100, 161);
    assert_eq!(b.agent.stats().underrun_at.len(), 1);
    on_time(&mut b, 161, 400);
    b.run_until(b.nominal(399) + 20_000);
    assert_eq!(b.agent.stats().catch_ups, 1);
    let burst: Vec<Micros> = b.fed[101..110]
        .windows(2)
        .map(|w| w[1].at - w[0].at)
        .collect();
    assert!(burst.iter().all(|&g| g == 4_000), "{burst:?}");
    let drained = b
        .fed
        .iter()
        .skip(100)
        .find(|f| f.at - b.nominal(f.index) <= b.cadence.period_us())
        .unwrap();
    assert!(
        drained.at - resume < 2_000_000,
        "drained {} ms after the backlog arrived",
        (drained.at - resume) / 1000
    );
    assert!(!b.agent.catching_up());
    assert!(b.fed.windows(2).all(|w| w[1].index == w[0].index + 1));
}

#[test]
fn a_rebased_relay_clock_moves_the_feed_schedule_without_a_catch_up() {
    let mut b = Bench::new();
    on_time(&mut b, 0, 100);
    b.base += 500_000;
    on_time(&mut b, 100, 200);
    b.run_until(b.nominal(199));
    assert_eq!(b.fed.len(), 200);
    assert_eq!(b.agent.stats().catch_ups, 0);
    for f in &b.fed[100..] {
        assert_eq!(f.at, b.nominal(f.index), "turn {}", f.index);
    }
}
