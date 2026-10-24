use std::io::{self, ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::time::{Duration, Instant};

use relay_proto::room::{self, FromAgent, FromRelay, MapFacts};
use relay_proto::wire::UpAction;
use relay_proto::Micros;

use crate::game::{GameHost, Output, Phase};
use crate::link::Link;
use crate::w3gs::{PlayerAction, SockAddr, Splitter};

const ANNOUNCE_US: Micros = 250_000;
const PING_US: Micros = 3_000_000;
const STEP: Duration = Duration::from_millis(1);

#[derive(Clone, Debug)]
pub struct HostConfig {
    pub game_name: Vec<u8>,
    pub version: u32,
    pub listen_port: u16,
    pub announce_ports: Vec<u16>,
    pub host: Option<(MapFacts, u8)>,
}

#[derive(Debug, Default)]
pub struct HostSummary {
    pub turns: u64,
    pub underruns: usize,
    pub depth_turns: u32,
    pub releases: u64,
}

struct Client {
    stream: TcpStream,
    address: SockAddr,
    splitter: Splitter,
    outgoing: Vec<u8>,
}

impl Client {
    fn write(&mut self, packets: Vec<Vec<u8>>) {
        for p in packets {
            self.outgoing.extend_from_slice(&p);
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        while !self.outgoing.is_empty() {
            match self.stream.write(&self.outgoing) {
                Ok(n) => drop(self.outgoing.drain(..n)),
                Err(e) if e.kind() == ErrorKind::WouldBlock => break,
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
}

pub struct AgentHost<'a> {
    cfg: HostConfig,
    link: Link,
    log: &'a mut dyn FnMut(String),
    started: Instant,
    listener: TcpListener,
    discovery: UdpSocket,
    game: Option<GameHost>,
    client: Option<Client>,
    actions_sent: u32,
    next_announce: Micros,
    next_ping: Micros,
    summary: HostSummary,
}

impl<'a> AgentHost<'a> {
    pub fn new(cfg: HostConfig, mut link: Link, log: &'a mut dyn FnMut(String)) -> io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", cfg.listen_port))?;
        listener.set_nonblocking(true)?;
        let discovery = UdpSocket::bind(("127.0.0.1", 0))?;
        discovery.set_nonblocking(true)?;
        if let Some((map, computers)) = &cfg.host {
            link.push_room(room::encode_from_agent(&FromAgent::Host { map: map.clone(), computers: *computers }));
        }
        Ok(AgentHost {
            cfg,
            link,
            log,
            started: Instant::now(),
            listener,
            discovery,
            game: None,
            client: None,
            actions_sent: 0,
            next_announce: 0,
            next_ping: PING_US,
            summary: HostSummary::default(),
        })
    }

    pub fn port(&self) -> io::Result<u16> {
        Ok(self.listener.local_addr()?.port())
    }

    fn now(&self) -> Micros {
        self.started.elapsed().as_micros() as Micros
    }

    pub fn run(mut self) -> io::Result<HostSummary> {
        let line = format!("agent slot {} of room {:016x} listening on 127.0.0.1:{}", self.link.slot(), self.link.room(), self.port()?);
        (self.log)(line);
        loop {
            let now = self.now();
            self.accept()?;
            self.read_client()?;
            if self.relay_step()? {
                break;
            }
            self.lobby(now)?;
            if let Some(Err(e)) = self.client.as_mut().map(Client::flush) {
                self.client_gone(e)?;
            }
            if self.game.as_ref().is_some_and(|g| g.phase() == Phase::Over) {
                break;
            }
        }
        self.link.leave()?;
        self.summary.underruns = self.link.agent().stats().underrun_at.len();
        self.summary.depth_turns = self.link.agent().choice().map_or(0, |c| c.turns);
        Ok(self.summary)
    }

    fn accept(&mut self) -> io::Result<()> {
        if self.game.is_none() || self.client.is_some() {
            return Ok(());
        }
        match self.listener.accept() {
            Ok((stream, peer)) => {
                stream.set_nodelay(true)?;
                stream.set_nonblocking(true)?;
                let address = match peer {
                    SocketAddr::V4(v4) => SockAddr { ip: v4.ip().octets(), port: v4.port() },
                    SocketAddr::V6(_) => SockAddr { ip: [127, 0, 0, 1], port: peer.port() },
                };
                (self.log)(format!("client connected from {peer}"));
                self.client = Some(Client { stream, address, splitter: Splitter::default(), outgoing: Vec::new() });
                Ok(())
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => Ok(()),
            Err(e) => Err(e),
        }
    }

    fn client_gone(&mut self, cause: io::Error) -> io::Result<()> {
        if !matches!(cause.kind(), ErrorKind::UnexpectedEof | ErrorKind::BrokenPipe | ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted) {
            return Err(cause);
        }
        self.client = None;
        if let Some(game) = self.game.as_mut() {
            let out = game.closed();
            self.apply(out);
        }
        (self.log)(format!("client closed ({})", cause.kind()));
        Ok(())
    }

    fn read_client(&mut self) -> io::Result<()> {
        let Some(client) = self.client.as_mut() else { return Ok(()) };
        let mut buf = [0u8; 8192];
        let packets = match client.stream.read(&mut buf) {
            Ok(0) => return self.client_gone(io::Error::from(ErrorKind::UnexpectedEof)),
            Ok(n) => client.splitter.push(&buf[..n]).map_err(|e| io::Error::new(ErrorKind::InvalidData, e.to_string()))?,
            Err(e) if e.kind() == ErrorKind::WouldBlock => return Ok(()),
            Err(e) => return self.client_gone(e),
        };
        let address = client.address;
        for packet in packets {
            let acked = self.actions_sent - self.link.agent().unacked_actions() as u32;
            let Some(game) = self.game.as_mut() else { continue };
            let out = game.client(&packet, address, acked).map_err(|e| io::Error::new(ErrorKind::InvalidData, e.to_string()))?;
            self.apply(out);
        }
        Ok(())
    }

    fn apply(&mut self, out: Output) {
        if let Some(c) = self.client.as_mut() {
            c.write(out.to_client);
        }
        for message in out.to_relay {
            self.link.push_room(room::encode_from_agent(&message));
        }
        for (data, release) in out.actions {
            self.summary.releases += u64::from(release);
            if self.link.send_action(UpAction { release, data }).is_ok() {
                self.actions_sent += 1;
            }
        }
        for sum in out.checksums {
            self.link.record_checksum(sum);
        }
    }

    fn relay_step(&mut self) -> io::Result<bool> {
        let fed = self.link.step(Instant::now() + STEP)?;
        for message in self.link.take_room() {
            match room::decode_from_relay(&message) {
                Ok(event) => {
                    if self.on_room(event) {
                        return Ok(true);
                    }
                }
                Err(e) => (self.log)(format!("bad room message: {e:?}")),
            }
        }
        let Some(game) = self.game.as_mut() else { return Ok(false) };
        let pids = game.room().pids();
        for f in fed {
            let actions: Vec<PlayerAction> = f
                .turn
                .actions
                .into_iter()
                .filter_map(|a| pids.get(a.player as usize).map(|&pid| PlayerAction { player_id: pid, data: a.data }))
                .collect();
            if let Some(packet) = game.turn(f.turn.step_ms as u16, &actions) {
                self.summary.turns += 1;
                if let Some(c) = self.client.as_mut() {
                    c.write(vec![packet]);
                }
            }
        }
        Ok(false)
    }

    fn on_room(&mut self, event: FromRelay) -> bool {
        match event {
            FromRelay::Room(facts) => {
                (self.log)(format!("room: p{} of {}, seed {:08x}, map {}", facts.you, facts.players, facts.seed, String::from_utf8_lossy(&facts.map.path)));
                self.game.get_or_insert_with(|| GameHost::new(facts));
            }
            FromRelay::Refused { reason } => {
                (self.log)(format!("refused: {}", String::from_utf8_lossy(&reason)));
                return true;
            }
            event => {
                (self.log)(format!("room event {event:?}"));
                let Some(game) = self.game.as_mut() else { return false };
                let packets = game.relay(event);
                if let Some(c) = self.client.as_mut() {
                    c.write(packets);
                }
            }
        }
        false
    }

    fn lobby(&mut self, now: Micros) -> io::Result<()> {
        let Some(game) = self.game.as_ref() else { return Ok(()) };
        if now >= self.next_ping {
            self.next_ping = now + PING_US;
            if let (Some(packet), Some(c)) = (game.ping((now / 1000) as u32), self.client.as_mut()) {
                c.write(vec![packet]);
            }
        }
        if game.phase() != Phase::Lobby {
            return Ok(());
        }
        let port = self.listener.local_addr()?.port();
        let Some(listing) = game.listing(self.cfg.version, &self.cfg.game_name, port, (now / 1_000_000) as u32) else { return Ok(()) };
        let mut buf = [0u8; 512];
        while let Ok((n, from)) = self.discovery.recv_from(&mut buf) {
            if crate::listing::is_search_game(&buf[..n]) {
                let _ = self.discovery.send_to(&listing, from);
            }
        }
        if now >= self.next_announce {
            self.next_announce = now + ANNOUNCE_US;
            for &p in &self.cfg.announce_ports {
                let _ = self.discovery.send_to(&listing, ("127.0.0.1", p));
            }
        }
        Ok(())
    }
}
