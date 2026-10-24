use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{self, ErrorKind};
use std::net::{SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

use relay_proto::agent::{Agent, AgentConfig, AgentError, Fed};
use relay_proto::cadence::Cadence;
use relay_proto::control::{self, Control, KIND_CHALLENGE};
use relay_proto::stream::{self, RoomStream, KIND_STREAM};
use relay_proto::wire::{UpAction, KIND_DOWN, MAX_PACKET};
use relay_proto::Micros;

pub const HANDSHAKE_TRIES: u32 = 20;
pub const HANDSHAKE_RETRY: Duration = Duration::from_millis(250);
pub const LEAVE_COPIES: usize = 3;
const MIN_WAIT: Duration = Duration::from_micros(50);

#[derive(Debug)]
pub struct Link {
    socket: UdpSocket,
    server: SocketAddr,
    origin: Instant,
    agent: Agent,
    room: u64,
    slot: u8,
    players: u8,
    token: u64,
    challenges: u64,
    stream: RoomStream,
    inbox: Vec<Vec<u8>>,
}

fn bind_for(server: SocketAddr) -> io::Result<UdpSocket> {
    if server.is_ipv4() {
        UdpSocket::bind("0.0.0.0:0")
    } else {
        UdpSocket::bind("[::]:0")
    }
}

fn quiet(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        ErrorKind::WouldBlock
            | ErrorKind::TimedOut
            | ErrorKind::ConnectionReset
            | ErrorKind::ConnectionRefused
            | ErrorKind::Interrupted
    )
}

fn recv(
    socket: &UdpSocket,
    wait: Duration,
    buf: &mut [u8],
) -> io::Result<Option<(usize, SocketAddr)>> {
    socket.set_read_timeout(Some(wait.max(MIN_WAIT)))?;
    match socket.recv_from(buf) {
        Ok(got) => Ok(Some(got)),
        Err(e) if quiet(&e) => Ok(None),
        Err(e) => Err(e),
    }
}

impl Link {
    pub fn create(server: SocketAddr, players: u8) -> io::Result<Link> {
        Self::connect(server, |cookie, request| Control::Create {
            cookie,
            request,
            players,
        })
    }

    pub fn join(server: SocketAddr, room: u64) -> io::Result<Link> {
        Self::connect(server, |cookie, request| Control::Join {
            cookie,
            request,
            room,
        })
    }

    fn connect(server: SocketAddr, ask: impl Fn(u64, u64) -> Control) -> io::Result<Link> {
        let socket = bind_for(server)?;
        let request = RandomState::new().build_hasher().finish();
        let mut cookie = 0;
        let mut buf = [0u8; MAX_PACKET + 1];
        for _ in 0..HANDSHAKE_TRIES {
            socket.send_to(&control::encode(&ask(cookie, request)), server)?;
            let deadline = Instant::now() + HANDSHAKE_RETRY;
            while let Some(wait) = deadline.checked_duration_since(Instant::now()) {
                let Some((n, from)) = recv(&socket, wait, &mut buf)? else {
                    break;
                };
                if from != server {
                    continue;
                }
                match control::decode(&buf[..n]) {
                    Ok(Control::Challenge { cookie: c }) => {
                        cookie = c;
                        break;
                    }
                    Ok(Control::Room {
                        request: r,
                        room,
                        token,
                        players,
                        slot,
                        steps,
                    }) if r == request => {
                        if steps.is_empty() || steps.contains(&0) {
                            return Err(io::Error::new(
                                ErrorKind::InvalidData,
                                "room without steps",
                            ));
                        }
                        let origin = Instant::now();
                        let cfg = AgentConfig::new(token, Cadence::new(&steps));
                        return Ok(Link {
                            socket,
                            server,
                            origin,
                            agent: Agent::new(cfg, 0),
                            room,
                            slot,
                            players,
                            token,
                            challenges: 0,
                            stream: RoomStream::new(token),
                            inbox: Vec::new(),
                        });
                    }
                    Ok(Control::Refused { request: r, reason }) if r == request => {
                        return Err(io::Error::other(format!("relay refused: {reason:?}")));
                    }
                    _ => {}
                }
            }
        }
        Err(io::Error::new(ErrorKind::TimedOut, "relay did not answer"))
    }

    pub fn room(&self) -> u64 {
        self.room
    }

    pub fn slot(&self) -> u8 {
        self.slot
    }

    pub fn players(&self) -> u8 {
        self.players
    }

    pub fn token(&self) -> u64 {
        self.token
    }

    pub fn challenges(&self) -> u64 {
        self.challenges
    }

    pub fn agent(&self) -> &Agent {
        &self.agent
    }

    pub fn local_addr(&self) -> io::Result<SocketAddr> {
        self.socket.local_addr()
    }

    pub fn origin(&self) -> Instant {
        self.origin
    }

    pub fn now(&self) -> Micros {
        self.origin.elapsed().as_micros() as Micros
    }

    pub fn send_action(&mut self, action: UpAction) -> Result<(), AgentError> {
        let now = self.now();
        self.agent.send_action(now, action)
    }

    pub fn push_room(&mut self, message: Vec<u8>) {
        self.stream.push(message);
    }

    pub fn take_room(&mut self) -> Vec<Vec<u8>> {
        std::mem::take(&mut self.inbox)
    }

    pub fn record_checksum(&mut self, value: u32) {
        self.agent.record_checksum(value);
    }

    pub fn rebind(&mut self) -> io::Result<()> {
        self.socket = bind_for(self.server)?;
        Ok(())
    }

    pub fn leave(&self) -> io::Result<()> {
        let bytes = control::encode(&Control::Leave { token: self.token });
        for _ in 0..LEAVE_COPIES {
            self.send(&bytes)?;
        }
        Ok(())
    }

    fn send(&self, bytes: &[u8]) -> io::Result<()> {
        match self.socket.send_to(bytes, self.server) {
            Err(e) if !quiet(&e) => Err(e),
            _ => Ok(()),
        }
    }

    pub fn step(&mut self, until: Instant) -> io::Result<Vec<Fed>> {
        self.step_tapped(until, |_, _| {})
    }

    pub fn step_tapped(
        &mut self,
        until: Instant,
        mut tap: impl FnMut(Micros, &[u8]),
    ) -> io::Result<Vec<Fed>> {
        let mut fed = Vec::new();
        let mut buf = [0u8; MAX_PACKET + 1];
        loop {
            let (got, packets) = self.agent.poll(self.now());
            fed.extend(got);
            for p in packets {
                self.send(&p)?;
            }
            if let Some(p) = self.stream.poll(self.now()) {
                self.send(&p)?;
            }
            let now = Instant::now();
            if now >= until {
                return Ok(fed);
            }
            let next = self.stream.next_wake().map_or(self.agent.next_wake(), |w| w.min(self.agent.next_wake()));
            let wake = self.origin + Duration::from_micros(next.max(0) as u64);
            let wait = wake.min(until).saturating_duration_since(now);
            if let Some((n, from)) = recv(&self.socket, wait, &mut buf)? {
                if from == self.server {
                    tap(self.now(), &buf[..n]);
                    self.on_datagram(&buf[..n])?;
                }
            }
        }
    }

    fn on_datagram(&mut self, bytes: &[u8]) -> io::Result<()> {
        match control::kind(bytes) {
            Some(KIND_DOWN) => {
                let now = self.now();
                if self.agent.on_packet(now, bytes).is_ok()
                    && self.agent.choice().is_none()
                    && self.agent.started()
                {
                    self.agent.choose_depth();
                }
            }
            Some(KIND_STREAM) => {
                if let Ok(packet) = stream::decode(bytes) {
                    let fresh = self.stream.receive(&packet);
                    self.inbox.extend(fresh);
                }
            }
            Some(KIND_CHALLENGE) => {
                if let Ok(Control::Challenge { cookie }) = control::decode(bytes) {
                    self.challenges += 1;
                    let verify = control::encode(&Control::Verify {
                        token: self.token,
                        cookie,
                    });
                    self.send(&verify)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_server() -> (UdpSocket, SocketAddr) {
        let s = UdpSocket::bind("127.0.0.1:0").unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let a = s.local_addr().unwrap();
        (s, a)
    }

    fn recv_control(s: &UdpSocket) -> (Control, SocketAddr) {
        let mut buf = [0u8; 2048];
        let (n, from) = s.recv_from(&mut buf).unwrap();
        (control::decode(&buf[..n]).unwrap(), from)
    }

    #[test]
    fn the_handshake_echoes_the_cookie_and_a_challenge_mid_match_is_answered() {
        let (server, addr) = fake_server();
        let client = std::thread::spawn(move || Link::create(addr, 2).unwrap());
        let (first, from) = recv_control(&server);
        assert!(matches!(
            first,
            Control::Create {
                cookie: 0,
                players: 2,
                ..
            }
        ));
        server
            .send_to(&control::encode(&Control::Challenge { cookie: 77 }), from)
            .unwrap();
        let (second, from) = recv_control(&server);
        let Control::Create {
            cookie: 77,
            request,
            ..
        } = second
        else {
            panic!("{second:?}");
        };
        let room = Control::Room {
            request,
            room: 5,
            token: 9,
            players: 2,
            slot: 0,
            steps: vec![8],
        };
        server.send_to(&control::encode(&room), from).unwrap();
        let mut link = client.join().unwrap();
        assert_eq!((link.room(), link.token(), link.slot()), (5, 9, 0));

        link.rebind().unwrap();
        let rebound = link.local_addr().unwrap().port();
        assert_ne!(rebound, from.port());
        link.step(Instant::now() + Duration::from_millis(20))
            .unwrap();
        let mut buf = [0u8; 2048];
        let (_, up_from) = server.recv_from(&mut buf).unwrap();
        assert_eq!(up_from.port(), rebound);
        assert_eq!(control::token(&buf), Some(9));
        server
            .send_to(
                &control::encode(&Control::Challenge { cookie: 31 }),
                up_from,
            )
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while link.challenges() == 0 && Instant::now() < deadline {
            link.step(Instant::now() + Duration::from_millis(5))
                .unwrap();
        }
        assert_eq!(link.challenges(), 1);
        loop {
            let (n, _) = server.recv_from(&mut buf).unwrap();
            if let Ok(c) = control::decode(&buf[..n]) {
                assert_eq!(
                    c,
                    Control::Verify {
                        token: 9,
                        cookie: 31
                    }
                );
                break;
            }
        }
    }

    #[test]
    fn a_refusal_is_an_error() {
        let (server, addr) = fake_server();
        let client = std::thread::spawn(move || Link::join(addr, 4));
        let (ask, from) = recv_control(&server);
        let Control::Join {
            request, room: 4, ..
        } = ask
        else {
            panic!("{ask:?}");
        };
        let refused = Control::Refused {
            request,
            reason: control::Refusal::NoRoom,
        };
        server.send_to(&control::encode(&refused), from).unwrap();
        let err = client.join().unwrap().unwrap_err();
        assert!(err.to_string().contains("NoRoom"));
    }
}
