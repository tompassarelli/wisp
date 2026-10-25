use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::{Duration, Instant};

use relay_proto::control::{self, Control};
use relay_proto::wire::{self, Down, Turn, MAX_PACKET, NOT_STARTED};

extern "C" {
    fn kill(pid: i32, signum: i32) -> i32;
}

const SIGINT: i32 = 2;
const TOKEN: u64 = 9;
const STEP: Duration = Duration::from_millis(8);
const LOBBY: Duration = Duration::from_millis(1200);
const PLAY: Duration = Duration::from_secs(4);
const HOLDS: [(Duration, Duration); 2] = [(Duration::from_millis(1000), Duration::from_millis(250)), (Duration::from_millis(2500), Duration::from_millis(500))];
const ONE_HOLD: [(Duration, Duration); 1] = [(Duration::from_millis(1000), Duration::from_millis(250))];
const CLEAN_RUNS: usize = 20;
const CLEAN_WAVE: usize = 4;
const RESEND: u32 = 100;
const CATCH_UP_GAP_US: i64 = 4_000;
const STEP_US: i64 = 8_000;
const CALLBACK_HZ: i64 = 60;
const SECOND_US: i64 = 1_000_000;
static MACHINE: RwLock<()> = RwLock::new(());

struct Agent(Child);

impl Drop for Agent {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn answer_join(server: &UdpSocket) -> SocketAddr {
    let mut buf = [0u8; 2048];
    loop {
        let (n, from) = server.recv_from(&mut buf).unwrap();
        if let Ok(Control::Join { request, .. }) = control::decode(&buf[..n]) {
            let room = Control::Room { request, room: 1, token: TOKEN, players: 1, slot: 0, steps: vec![8] };
            server.send_to(&control::encode(&room), from).unwrap();
            return from;
        }
    }
}

fn held(holds: &[(Duration, Duration)], played: Duration) -> bool {
    holds.iter().any(|&(at, length)| played >= at && played < at + length)
}

fn down(seq: u32, sent: Duration, base: Option<Duration>, emitted: u32) -> Vec<u8> {
    let from = emitted.saturating_sub(RESEND);
    let base_us = base.map_or(NOT_STARTED, |b| b.as_micros() as u64);
    let head = Down { token: TOKEN, seq, sent_us: sent.as_micros() as u64, base_us, action_ack: 0, checksum_ack: 0, turn_from: from, turns: Vec::new() };
    let turns: Vec<Turn> = (from..emitted).map(|_| Turn { step_ms: 8, actions: Vec::new() }).collect();
    wire::encode_down(&head, &turns, MAX_PACKET).0
}

fn relay_with_stalls(server: &UdpSocket, agent: SocketAddr, holds: &[(Duration, Duration)]) {
    let origin = Instant::now();
    let mut seq = 0;
    while origin.elapsed() < LOBBY + PLAY {
        let now = origin.elapsed();
        let played = now.checked_sub(LOBBY);
        let emitted = played.map_or(0, |p| (p.as_micros() / STEP.as_micros()) as u32 + 1);
        if !played.is_some_and(|p| held(holds, p)) {
            server.send_to(&down(seq, now, played.map(|_| LOBBY), emitted), agent).unwrap();
            seq += 1;
        }
        std::thread::sleep(STEP);
    }
}

fn run(extra: &[&str], trace: &PathBuf, holds: &[(Duration, Duration)]) -> (String, String) {
    let server = UdpSocket::bind("127.0.0.1:0").unwrap();
    server.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let mut agent = Agent(
        Command::new(env!("CARGO_BIN_EXE_relay-agent"))
            .args(["--relay", &server.local_addr().unwrap().to_string(), "--name", "g", "--join", "1", "--trace"])
            .arg(trace)
            .args(extra)
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let stdout = agent.0.stdout.take().unwrap();
    let peer = answer_join(&server);
    relay_with_stalls(&server, peer, holds);
    assert_eq!(unsafe { kill(agent.0.id() as i32, SIGINT) }, 0);
    let summary = BufReader::new(stdout).lines().map_while(Result::ok).find(|l| l.starts_with("agent summary:")).expect("an agent summary");
    assert!(agent.0.wait().unwrap().success());
    let text = std::fs::read_to_string(trace).unwrap();
    std::fs::remove_file(trace).unwrap();
    (summary, text)
}

fn shared() -> RwLockReadGuard<'static, ()> {
    MACHINE.read().unwrap_or_else(|e| e.into_inner())
}

fn exclusive() -> RwLockWriteGuard<'static, ()> {
    MACHINE.write().unwrap_or_else(|e| e.into_inner())
}

fn field<'a>(summary: &'a str, name: &str) -> &'a str {
    let words: Vec<&str> = summary.split_whitespace().collect();
    words.iter().position(|w| *w == name).and_then(|i| words.get(i + 1)).copied().unwrap_or_else(|| panic!("{name} in {summary:?}"))
}

fn trace_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("relay-agent-{name}-{}.trace", std::process::id()))
}

#[test]
fn two_visible_stalls_within_a_minute_raise_the_floor_when_headroom_is_given() {
    let _machine = shared();
    let (summary, trace) = run(&["--raise-headroom-ms", "100"], &trace_path("raise"), &HOLDS);
    assert!(summary.starts_with("agent summary: turns 0 underruns "), "{summary:?}");
    assert_eq!(field(&summary, "spiky"), "true", "{summary:?}");
    assert!(field(&summary, "stalls").parse::<u64>().unwrap() >= 2, "{summary:?}");
    assert!(field(&summary, "raise_ms").parse::<f64>().unwrap() > 0.0, "{summary:?}");
    let raise: Vec<&str> = trace.lines().filter(|l| l.starts_with("raise ")).collect();
    assert_eq!(raise.len(), 1, "{raise:?}");
    let words: Vec<i64> = raise[0].split_whitespace().skip(1).map(|w| w.parse().unwrap()).collect();
    assert!(words.len() == 2 && words[0] > 0 && words[1] > 0, "{raise:?}");
    assert_eq!(trace.lines().filter(|l| l.starts_with("spiky ")).count(), 1);
}

#[test]
fn without_headroom_the_agent_never_raises_even_on_a_spiky_path() {
    let _machine = shared();
    let (summary, trace) = run(&[], &trace_path("flat"), &HOLDS);
    assert_eq!(field(&summary, "spiky"), "true", "{summary:?}");
    assert!(field(&summary, "stalls").parse::<u64>().unwrap() >= 2, "{summary:?}");
    assert_eq!(field(&summary, "raise_ms"), "0.0", "{summary:?}");
    assert!(!trace.lines().any(|l| l.starts_with("raise ")));
}

fn fed(trace: &str) -> Vec<[i64; 5]> {
    let rows = trace.lines().filter_map(|l| l.strip_prefix("fed "));
    rows.map(|l| {
        let v: Vec<i64> = l.split_whitespace().map(|w| w.parse().unwrap()).collect();
        [v[0], v[1], v[2], v[3], v[4]]
    })
    .collect()
}

fn stalls(rows: &[[i64; 5]]) -> u64 {
    let (mut last, mut stalled, mut count) = (None, false, 0);
    for (n, row) in rows.iter().enumerate() {
        let frame = |turns: i64| turns * STEP_US * CALLBACK_HZ / SECOND_US;
        for _ in frame(n as i64)..frame(n as i64 + 1) {
            if let Some(at) = last.replace(row[1]) {
                let long = (row[1] - at) * CALLBACK_HZ >= 2 * SECOND_US;
                count += u64::from(long && !stalled);
                stalled = long;
            }
        }
    }
    count
}

#[test]
fn a_clean_loopback_path_is_flagged_only_on_stalls_of_2_frames_in_its_own_feeds() {
    let _machine = exclusive();
    let mut results = Vec::new();
    for wave in (0..CLEAN_RUNS).collect::<Vec<_>>().chunks(CLEAN_WAVE) {
        let runs: Vec<_> = wave.iter().map(|&i| std::thread::spawn(move || run(&["--raise-headroom-ms", "100"], &trace_path(&format!("clean{i}")), &[]))).collect();
        results.extend(runs.into_iter().map(|r| r.join().unwrap()));
    }
    assert_eq!(results.len(), CLEAN_RUNS);
    for (summary, trace) in results {
        let own = stalls(&fed(&trace));
        assert_eq!(field(&summary, "stalls"), own.to_string(), "{summary:?}");
        if own < 2 {
            assert_eq!(field(&summary, "spiky"), "false", "{summary:?}");
            assert_eq!(field(&summary, "raise_ms"), "0.0", "{summary:?}");
        }
    }
}

#[test]
fn after_one_hold_catch_up_feeds_by_its_rule_until_extra_delay_is_back_within_a_turn_inside_2_s() {
    let _machine = shared();
    let (_, trace) = run(&[], &trace_path("catchup"), &ONE_HOLD);
    let underrun: i64 = trace.lines().find_map(|l| l.strip_prefix("underrun ")).and_then(|l| l.split_whitespace().next()).unwrap().parse().unwrap();
    let rows = fed(&trace);
    let resumed = rows.iter().position(|r| r[0] == underrun).unwrap();
    let before = rows[resumed - 1][4];
    assert!(rows[resumed][4] >= 200_000, "{:?}", rows[resumed]);
    let back = rows[resumed..].iter().position(|r| r[4] <= before + STEP_US).map_or(rows.len() - 1, |i| resumed + i);
    assert!(rows[back][4] <= before + STEP_US, "extra {:?} before {before}", rows[back]);
    assert!(rows[back][1] - rows[resumed][1] <= 2_000_000, "{:?} after {:?}", rows[back], rows[resumed]);
    for w in rows[resumed..=back].windows(2) {
        assert!(w[1][1] - w[0][1] >= CATCH_UP_GAP_US, "{w:?}");
        assert_eq!(w[0][4] - w[1][4], w[1][2] - w[1][1], "{w:?}");
    }
}
