use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

use relay_agent::Link;
use relay_proto::agent::{Agent, AgentConfig, Fed};
use relay_proto::cadence::Cadence;
use relay_proto::control::{self, Control};
use relay_proto::transport::Deframer;
use relay_proto::wire::{frame, Turn, UpAction, KIND_DOWN, MAX_PACKET};
use relay_proto::Micros;

const MIN_WAIT: Duration = Duration::from_micros(50);

fn spawn_relay(extra: &[&str]) -> (Child, BufReader<ChildStdout>, SocketAddr) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_relay"))
        .args(["--bind", "127.0.0.1:0", "--once", "--lobby-ms", "300"])
        .args(extra)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut out = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    out.read_line(&mut line).unwrap();
    let addr = line.trim().strip_prefix("listening ").unwrap().parse().unwrap();
    (child, out, addr)
}

fn finish(mut child: Child, mut out: BufReader<ChildStdout>) -> String {
    assert!(child.wait().unwrap().success());
    let mut rest = String::new();
    out.read_to_string(&mut rest).unwrap();
    rest.lines().last().unwrap_or_default().to_string()
}

struct Framed {
    stream: TcpStream,
    rx: Deframer,
}

impl Framed {
    fn connect(server: SocketAddr) -> Framed {
        let stream = TcpStream::connect(server).unwrap();
        stream.set_nodelay(true).unwrap();
        Framed {
            stream,
            rx: Deframer::default(),
        }
    }

    fn send(&mut self, bytes: &[u8]) {
        self.stream.write_all(&frame(bytes)).unwrap();
    }

    fn recv(&mut self, wait: Duration) -> Option<Vec<u8>> {
        if let Some(f) = self.rx.next_frame().unwrap() {
            return Some(f.to_vec());
        }
        self.stream.set_read_timeout(Some(wait.max(MIN_WAIT))).unwrap();
        let mut buf = [0u8; 4096];
        match self.stream.read(&mut buf) {
            Ok(0) => panic!("relay closed the connection"),
            Ok(n) => self.rx.push(&buf[..n]),
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(e) => panic!("{e}"),
        }
        self.rx.next_frame().unwrap().map(<[u8]>::to_vec)
    }

    fn closed_within(&mut self, wait: Duration) -> bool {
        let deadline = Instant::now() + wait;
        let mut buf = [0u8; 4096];
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            self.stream.set_read_timeout(Some(left)).unwrap();
            match self.stream.read(&mut buf) {
                Ok(0) => return true,
                Ok(_) => {}
                Err(e) => return !matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut),
            }
        }
    }

    fn ask(&mut self, ask: impl Fn(u64) -> Control) -> Control {
        let mut cookie = 0;
        for _ in 0..4 {
            self.send(&control::encode(&ask(cookie)));
            let reply = self.recv(Duration::from_secs(2)).expect("no reply over tcp");
            match control::decode(&reply).unwrap() {
                Control::Challenge { cookie: c } => cookie = c,
                c => return c,
            }
        }
        panic!("relay kept challenging");
    }
}

struct TcpLink {
    io: Framed,
    origin: Instant,
    agent: Agent,
    token: u64,
    slot: u8,
}

impl TcpLink {
    fn join(server: SocketAddr, room: u64) -> TcpLink {
        let mut io = Framed::connect(server);
        let reply = io.ask(|cookie| Control::Join {
            cookie,
            request: 7,
            room,
        });
        let Control::Room {
            token, slot, steps, ..
        } = reply
        else {
            panic!("{reply:?}");
        };
        TcpLink {
            io,
            origin: Instant::now(),
            agent: Agent::new(AgentConfig::new(token, Cadence::new(&steps)), 0),
            token,
            slot,
        }
    }

    fn now(&self) -> Micros {
        self.origin.elapsed().as_micros() as Micros
    }

    fn step(&mut self, until: Instant) -> Vec<Fed> {
        let mut fed = Vec::new();
        loop {
            let (got, packets) = self.agent.poll(self.now());
            fed.extend(got);
            for p in packets {
                self.io.send(&p);
            }
            let now = Instant::now();
            if now >= until {
                return fed;
            }
            let wake = self.origin + Duration::from_micros(self.agent.next_wake().max(0) as u64);
            let Some(bytes) = self.io.recv(wake.min(until).saturating_duration_since(now)) else {
                continue;
            };
            if control::kind(&bytes) == Some(KIND_DOWN)
                && self.agent.on_packet(self.now(), &bytes).is_ok()
                && self.agent.choice().is_none()
                && self.agent.started()
            {
                self.agent.choose_depth();
            }
        }
    }
}

enum Side {
    Udp(Link),
    Tcp(TcpLink),
}

struct Player {
    side: Side,
    fed: Vec<Fed>,
    sent: u8,
}

fn digest(turn: &Turn) -> u32 {
    let mut h = DefaultHasher::new();
    turn.step_ms.hash(&mut h);
    for a in &turn.actions {
        (a.player, a.seq, &a.data).hash(&mut h);
    }
    h.finish() as u32
}

impl Player {
    fn slot(&self) -> u8 {
        match &self.side {
            Side::Udp(l) => l.slot(),
            Side::Tcp(l) => l.slot,
        }
    }

    fn step(&mut self, slice: Duration) {
        let until = Instant::now() + slice;
        let fed = match &mut self.side {
            Side::Udp(l) => l.step(until).unwrap(),
            Side::Tcp(l) => l.step(until),
        };
        for f in fed {
            let send = f.index % 25 == 0;
            let action = UpAction {
                release: true,
                data: vec![self.slot(), self.sent],
            };
            match &mut self.side {
                Side::Udp(l) => {
                    l.record_checksum(digest(&f.turn));
                    if send {
                        l.send_action(action).unwrap();
                    }
                }
                Side::Tcp(l) => {
                    let now = l.now();
                    l.agent.record_checksum(digest(&f.turn));
                    if send {
                        l.agent.send_action(now, action).unwrap();
                    }
                }
            }
            self.sent = self.sent.wrapping_add(u8::from(send));
            self.fed.push(f);
        }
    }

    fn leave(&mut self) {
        match &mut self.side {
            Side::Udp(l) => l.leave().unwrap(),
            Side::Tcp(l) => {
                let token = l.token;
                l.io.send(&control::encode(&Control::Leave { token }));
            }
        }
    }
}

fn actions_of(p: &Player, slot: u8) -> Vec<Vec<u8>> {
    p.fed
        .iter()
        .flat_map(|f| f.turn.actions.iter())
        .filter(|a| a.player == slot)
        .map(|a| a.data.clone())
        .collect()
}

fn play(server: SocketAddr, turns: usize) -> Vec<Player> {
    let host = Link::create(server, 2).unwrap();
    let guest = TcpLink::join(server, host.room());
    assert_eq!((host.slot(), guest.slot), (0, 1));
    let mut players: Vec<Player> = [Side::Udp(host), Side::Tcp(guest)]
        .into_iter()
        .map(|side| Player {
            side,
            fed: Vec::new(),
            sent: 0,
        })
        .collect();
    let deadline = Instant::now() + Duration::from_secs(30);
    while players.iter().any(|p| p.fed.len() < turns) {
        assert!(Instant::now() < deadline, "match stalled");
        for p in &mut players {
            p.step(Duration::from_millis(1));
        }
    }
    for p in &mut players {
        p.leave();
    }
    players
}

#[test]
fn a_udp_link_and_a_tcp_link_feed_the_same_turns_through_the_relay_binary() {
    let (child, out, server) = spawn_relay(&["--idle-s", "10"]);
    let players = play(server, 250);
    let shortest = players.iter().map(|p| p.fed.len()).min().unwrap();
    for p in &players {
        for (i, f) in p.fed.iter().enumerate() {
            assert_eq!(f.index as usize, i);
        }
    }
    let a: Vec<&Turn> = players[0].fed[..shortest].iter().map(|f| &f.turn).collect();
    let b: Vec<&Turn> = players[1].fed[..shortest].iter().map(|f| &f.turn).collect();
    assert_eq!(a, b);
    for (from, to) in [(0, 1), (1, 0)] {
        let heard = actions_of(&players[to], from as u8);
        assert!(heard.len() >= 8, "{heard:?}");
        for (i, d) in heard.iter().enumerate() {
            assert_eq!(d, &vec![from as u8, i as u8]);
        }
    }
    let stats = finish(child, out);
    assert!(stats.contains("rooms_closed: 1"), "{stats}");
    assert!(stats.contains("desyncs: 0"), "{stats}");
}

fn probe(io: &mut Framed) -> bool {
    io.send(&control::encode(&Control::Join {
        cookie: 0,
        request: 1,
        room: 1,
    }));
    matches!(
        io.recv(Duration::from_secs(2)).map(|r| control::decode(&r)),
        Some(Ok(Control::Challenge { .. }))
    )
}

#[test]
fn the_relay_holds_eight_tcp_connections_per_address_and_closes_the_ninth() {
    let (child, out, server) = spawn_relay(&["--idle-s", "3"]);
    let mut held: Vec<Framed> = (0..8).map(|_| Framed::connect(server)).collect();
    for io in &mut held {
        assert!(probe(io));
    }
    let mut ninth = Framed::connect(server);
    assert!(ninth.closed_within(Duration::from_secs(1)));
    assert!(!held[0].closed_within(Duration::from_millis(100)));
    drop(held);
    finish(child, out);
}

#[test]
fn a_frame_over_the_packet_ceiling_closes_its_connection() {
    let (child, out, server) = spawn_relay(&["--idle-s", "3"]);
    let mut io = Framed::connect(server);
    io.send(&vec![0xee; MAX_PACKET]);
    assert!(probe(&mut io));
    io.stream.write_all(&((MAX_PACKET + 1) as u16).to_le_bytes()).unwrap();
    assert!(io.closed_within(Duration::from_secs(1)));
    finish(child, out);
}

#[test]
fn a_tcp_connection_that_sends_no_frame_is_closed_after_the_idle_limit() {
    let (child, out, server) = spawn_relay(&["--idle-s", "3", "--tcp-idle-ms", "300"]);
    let mut io = Framed::connect(server);
    let reply = io.ask(|cookie| Control::Create {
        cookie,
        request: 1,
        players: 2,
    });
    assert!(matches!(reply, Control::Room { .. }), "{reply:?}");
    let opened = Instant::now();
    io.stream.write_all(&[1]).unwrap();
    assert!(io.closed_within(Duration::from_secs(1)));
    let waited = opened.elapsed();
    assert!(waited >= Duration::from_millis(250), "{waited:?}");
    finish(child, out);
}

#[test]
fn a_tcp_connection_that_holds_no_slot_is_closed_after_the_idle_limit_though_it_sends_frames() {
    let (child, out, server) = spawn_relay(&["--idle-s", "4", "--tcp-idle-ms", "300"]);
    let mut io = Framed::connect(server);
    let join = frame(&control::encode(&Control::Join {
        cookie: 0,
        request: 1,
        room: 1,
    }));
    let opened = Instant::now();
    let closed = loop {
        if opened.elapsed() > Duration::from_secs(2) {
            break false;
        }
        if io.stream.write_all(&join).is_err() || io.closed_within(Duration::from_millis(100)) {
            break true;
        }
    };
    let waited = opened.elapsed();
    assert!(closed && waited >= Duration::from_millis(250), "{waited:?}");
    finish(child, out);
}
