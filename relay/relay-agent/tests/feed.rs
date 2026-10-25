use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use relay_agent::Link;
use relay_proto::control::{self, Control};
use relay_proto::depth;
use relay_proto::wire::{self, Down, Packet, Turn};
use relay_proto::Micros;

const STEP_MS: u8 = 8;
const FEEDS: usize = 200;
const ARRIVALS: usize = 40;
const PACED: usize = 7_500;
const CHUNK: usize = 250;

fn linked() -> (UdpSocket, Link, SocketAddr) {
    let server = UdpSocket::bind("127.0.0.1:0").unwrap();
    server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let addr = server.local_addr().unwrap();
    let client = thread::spawn(move || Link::create(addr, 2).unwrap());
    let mut buf = [0u8; 2048];
    let (n, from) = server.recv_from(&mut buf).unwrap();
    let Ok(Control::Create { request, .. }) = control::decode(&buf[..n]) else { panic!("create first") };
    let room = Control::Room { request, room: 1, token: 7, players: 2, slot: 0, steps: vec![STEP_MS] };
    server.send_to(&control::encode(&room), from).unwrap();
    let link = client.join().unwrap();
    let agent = SocketAddr::from(([127, 0, 0, 1], link.local_addr().unwrap().port()));
    (server, link, agent)
}

fn down(link: &Link, seq: u32, turn_from: u32, turns: Vec<Turn>) -> Vec<u8> {
    let now = link.now() as u64;
    let d = Down { token: 7, seq, sent_us: now, base_us: now, action_ack: 0, checksum_ack: 0, turn_from, turns };
    wire::encode(&Packet::Down(d)).unwrap()
}

fn median(mut late: Vec<Micros>) -> Micros {
    late.sort_unstable();
    late[late.len() / 2]
}

fn spread(mut late: Vec<Micros>) -> (Micros, Micros, Micros) {
    late.sort_unstable();
    (late[late.len() / 2], late[late.len() * 99 / 100], late[late.len() - 1])
}

fn sleeper_lateness(stop: &AtomicBool) -> Vec<Micros> {
    let mut late = Vec::new();
    while !stop.load(Ordering::Relaxed) {
        let wake = Instant::now() + Duration::from_millis(STEP_MS as u64);
        thread::sleep(wake.saturating_duration_since(Instant::now()));
        late.push(Instant::now().duration_since(wake).as_micros() as Micros);
    }
    late
}

#[test]
fn a_link_with_no_incoming_packets_feeds_as_promptly_as_a_sleeping_thread_wakes() {
    let (server, mut link, agent) = linked();
    let lobby = depth::min_packets(STEP_MS as Micros * 1000) as u32;
    for seq in 0..lobby {
        server.send_to(&down(&link, seq, 0, Vec::new()), agent).unwrap();
        link.step(Instant::now() + Duration::from_micros(200)).unwrap();
    }
    let turns = vec![Turn { step_ms: STEP_MS, actions: Vec::new() }; FEEDS + 20];
    server.send_to(&down(&link, lobby, 0, turns), agent).unwrap();
    let stop = AtomicBool::new(false);
    let (fed, sleeps) = thread::scope(|s| {
        let sleeper = s.spawn(|| sleeper_lateness(&stop));
        let mut fed = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(20);
        while fed.len() < FEEDS && Instant::now() < deadline {
            fed.extend(link.step(Instant::now() + Duration::from_millis(50)).unwrap());
        }
        stop.store(true, Ordering::Relaxed);
        (fed, sleeper.join().unwrap())
    });
    assert!(link.agent().choice().is_some());
    assert!(fed.len() >= FEEDS, "fed {}", fed.len());
    let feed = median(fed[..FEEDS].iter().map(|f| f.at - f.scheduled).collect());
    let sleep = median(sleeps);
    assert!(feed <= sleep + 500, "median feed {feed} us late, a sleeping thread {sleep} us");
}

#[test]
fn a_packet_arrival_wakes_the_link_as_promptly_as_a_sleeping_thread_wakes() {
    let (server, mut link, agent) = linked();
    let stop = AtomicBool::new(false);
    let (late, sleeps) = thread::scope(|s| {
        let sleeper = s.spawn(|| sleeper_lateness(&stop));
        let sender = s.spawn(|| {
            let challenge = control::encode(&Control::Challenge { cookie: 3 });
            let mut sent = Vec::new();
            for _ in 0..ARRIVALS {
                thread::sleep(Duration::from_millis(7));
                sent.push(Instant::now());
                server.send_to(&challenge, agent).unwrap();
            }
            sent
        });
        let mut arrived = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(5);
        while arrived.len() < ARRIVALS && Instant::now() < deadline {
            link.step_tapped(Instant::now() + Duration::from_millis(50), |_, _| arrived.push(Instant::now()))
                .unwrap();
        }
        stop.store(true, Ordering::Relaxed);
        let sent = sender.join().unwrap();
        let late = sent.iter().zip(&arrived).map(|(s, a)| a.duration_since(*s).as_micros() as Micros);
        (late.collect::<Vec<_>>(), sleeper.join().unwrap())
    });
    assert_eq!(late.len(), ARRIVALS, "{} of {ARRIVALS} challenges arrived", late.len());
    let (arrival, sleep) = (median(late), median(sleeps));
    assert!(arrival <= sleep + 500, "median arrival handled {arrival} us after its send, a sleeping thread {sleep} us");
}

#[test]
#[ignore = "runs 60 s; the Windows workflow's relay pacer job runs it on windows-latest and ubuntu-latest"]
fn sixty_seconds_of_8_ms_feeds_land_within_1_ms_of_their_deadlines_at_p99() {
    let (server, mut link, agent) = linked();
    let lobby = depth::min_packets(STEP_MS as Micros * 1000) as u32;
    for seq in 0..lobby {
        server.send_to(&down(&link, seq, 0, Vec::new()), agent).unwrap();
        link.step(Instant::now() + Duration::from_micros(200)).unwrap();
    }
    for (i, from) in (0..PACED + 20).step_by(CHUNK).enumerate() {
        let turns = vec![Turn { step_ms: STEP_MS, actions: Vec::new() }; CHUNK];
        server.send_to(&down(&link, lobby + i as u32, from as u32, turns), agent).unwrap();
    }
    let stop = AtomicBool::new(false);
    let (fed, sleeps) = thread::scope(|s| {
        let sleeper = s.spawn(|| sleeper_lateness(&stop));
        let mut fed = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(90);
        while fed.len() < PACED && Instant::now() < deadline {
            fed.extend(link.step(Instant::now() + Duration::from_millis(50)).unwrap());
        }
        stop.store(true, Ordering::Relaxed);
        (fed, sleeper.join().unwrap())
    });
    assert!(fed.len() >= PACED, "fed {}", fed.len());
    let (p50, p99, max) = spread(fed[..PACED].iter().map(|f| f.at - f.scheduled).collect());
    let (s50, s99, smax) = spread(sleeps);
    println!(
        "pacer {}: {PACED} feeds of {STEP_MS} ms turns, late p50 {p50} us, p99 {p99} us, max {max} us; a sleeping thread beside it p50 {s50} us, p99 {s99} us, max {smax} us",
        std::env::consts::OS
    );
    assert!(p99 <= 1_000, "p99 feed {p99} us late");
}
