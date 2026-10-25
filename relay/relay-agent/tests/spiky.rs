use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
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
const RESEND: u32 = 100;

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

fn held(played: Duration) -> bool {
    HOLDS.iter().any(|&(at, length)| played >= at && played < at + length)
}

fn down(seq: u32, sent: Duration, base: Option<Duration>, emitted: u32) -> Vec<u8> {
    let from = emitted.saturating_sub(RESEND);
    let base_us = base.map_or(NOT_STARTED, |b| b.as_micros() as u64);
    let head = Down { token: TOKEN, seq, sent_us: sent.as_micros() as u64, base_us, action_ack: 0, checksum_ack: 0, turn_from: from, turns: Vec::new() };
    let turns: Vec<Turn> = (from..emitted).map(|_| Turn { step_ms: 8, actions: Vec::new() }).collect();
    wire::encode_down(&head, &turns, MAX_PACKET).0
}

fn relay_with_stalls(server: &UdpSocket, agent: SocketAddr) {
    let origin = Instant::now();
    let mut seq = 0;
    while origin.elapsed() < LOBBY + PLAY {
        let now = origin.elapsed();
        let played = now.checked_sub(LOBBY);
        let emitted = played.map_or(0, |p| (p.as_micros() / STEP.as_micros()) as u32 + 1);
        if !played.is_some_and(held) {
            server.send_to(&down(seq, now, played.map(|_| LOBBY), emitted), agent).unwrap();
            seq += 1;
        }
        std::thread::sleep(STEP);
    }
}

fn run(extra: &[&str], trace: &PathBuf) -> (String, String) {
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
    relay_with_stalls(&server, peer);
    assert_eq!(unsafe { kill(agent.0.id() as i32, SIGINT) }, 0);
    let summary = BufReader::new(stdout).lines().map_while(Result::ok).find(|l| l.starts_with("agent summary:")).expect("an agent summary");
    assert!(agent.0.wait().unwrap().success());
    let text = std::fs::read_to_string(trace).unwrap();
    std::fs::remove_file(trace).unwrap();
    (summary, text)
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
    let (summary, trace) = run(&["--raise-headroom-ms", "100"], &trace_path("raise"));
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
    let (summary, trace) = run(&[], &trace_path("flat"));
    assert_eq!(field(&summary, "spiky"), "true", "{summary:?}");
    assert!(field(&summary, "stalls").parse::<u64>().unwrap() >= 2, "{summary:?}");
    assert_eq!(field(&summary, "raise_ms"), "0.0", "{summary:?}");
    assert!(!trace.lines().any(|l| l.starts_with("raise ")));
}
