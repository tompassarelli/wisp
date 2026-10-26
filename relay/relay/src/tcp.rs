use std::collections::HashMap;
use std::io::{self, ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv6Addr, Shutdown, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use relay_proto::transport::{Deframer, Transport};
use relay_proto::wire::frame;
use relay_proto::Micros;

use crate::send_log::SendLog;
use crate::server::{Out, Peer, Server};
use crate::udp;

pub const EVENTS: usize = 1024;
const TCP_EVENTS: usize = EVENTS / 2;
const READ_BUF: usize = 4096;
const STACK: usize = 64 * 1024;
const ACCEPT_BACKOFF: Duration = Duration::from_millis(10);
const SWEEP: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub per_ip: usize,
    pub total: usize,
    pub idle: Duration,
    pub write_timeout: Duration,
    pub queue: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            per_ip: 8,
            total: 256,
            idle: Duration::from_secs(15),
            write_timeout: Duration::from_secs(5),
            queue: 128,
        }
    }
}


struct Hold(Arc<AtomicUsize>);

impl Hold {
    fn take(count: &Arc<AtomicUsize>, cap: usize) -> Option<Hold> {
        if count.fetch_add(1, Ordering::AcqRel) >= cap {
            count.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        Some(Hold(count.clone()))
    }
}

impl Drop for Hold {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

enum Event {
    Datagram(SocketAddr, Vec<u8>),
    Accepted(TcpStream, SocketAddr, Hold, Hold),
    Frame(SocketAddr, u64, Vec<u8>, Hold),
    Closed(SocketAddr, u64),
    Failed(io::Error),
}

#[derive(Clone)]
struct Feed {
    events: SyncSender<Event>,
    queued: Arc<AtomicUsize>,
}

impl Feed {
    fn offer(&self, event: impl FnOnce(Hold) -> Event) -> bool {
        let Some(queued) = Hold::take(&self.queued, TCP_EVENTS) else {
            return true;
        };
        !matches!(self.events.try_send(event(queued)), Err(TrySendError::Disconnected(_)))
    }
}

struct Conn {
    id: u64,
    stream: TcpStream,
    tx: SyncSender<Vec<u8>>,
    opened: Instant,
}

impl Drop for Conn {
    fn drop(&mut self) {
        let _ = self.stream.shutdown(Shutdown::Both);
    }
}

fn bucket(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) if v6.to_ipv4_mapped().is_none() => {
            IpAddr::V6(Ipv6Addr::from(u128::from(v6) & !((1u128 << 64) - 1)))
        }
        IpAddr::V6(v6) => IpAddr::V4(v6.to_ipv4_mapped().unwrap()),
        v4 => v4,
    }
}

fn spawn(name: &str, f: impl FnOnce() + Send + 'static) -> io::Result<()> {
    thread::Builder::new()
        .name(name.into())
        .stack_size(STACK)
        .spawn(f)
        .map(|_| ())
}

fn read_datagrams(socket: UdpSocket, events: SyncSender<Event>) {
    let mut buf = [0u8; 2048];
    loop {
        let event = match socket.recv_from(&mut buf) {
            Ok((n, from)) => Event::Datagram(from, buf[..n].to_vec()),
            Err(e) if udp::quiet(&e) => continue,
            Err(e) => Event::Failed(e),
        };
        if events.send(event).is_err() {
            return;
        }
    }
}

fn accept(listener: TcpListener, feed: Feed, live: Arc<AtomicUsize>, total: usize) {
    for stream in listener.incoming() {
        let Ok(stream) = stream else {
            thread::sleep(ACCEPT_BACKOFF);
            continue;
        };
        let (Ok(addr), Some(conn)) = (stream.peer_addr(), Hold::take(&live, total)) else {
            continue;
        };
        if !feed.offer(|queued| Event::Accepted(stream, addr, conn, queued)) {
            return;
        }
    }
}

fn read_frames(mut stream: TcpStream, addr: SocketAddr, id: u64, idle: Duration, feed: Feed, _conn: Hold) {
    let mut deframer = Deframer::default();
    let mut buf = [0u8; READ_BUF];
    let mut heard = Instant::now();
    'read: while heard.elapsed() < idle {
        let n = match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        deframer.push(&buf[..n]);
        loop {
            match deframer.next_frame() {
                Ok(Some(f)) => {
                    heard = Instant::now();
                    let bytes = f.to_vec();
                    if !feed.offer(|queued| Event::Frame(addr, id, bytes, queued)) {
                        break 'read;
                    }
                }
                Ok(None) => break,
                Err(_) => break 'read,
            }
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
    let _ = feed.events.send(Event::Closed(addr, id));
}

fn write_frames(mut stream: TcpStream, rx: Receiver<Vec<u8>>) {
    for bytes in rx {
        if stream.write_all(&frame(&bytes)).is_err() {
            break;
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
}

struct Hub {
    conns: HashMap<SocketAddr, Conn>,
    next_id: u64,
    limits: Limits,
    feed: Feed,
    swept: Instant,
}

impl Hub {
    fn open(&mut self, stream: TcpStream, addr: SocketAddr, conn: Hold) -> io::Result<()> {
        let ip = bucket(addr.ip());
        let same = self.conns.keys().filter(|a| bucket(a.ip()) == ip).count();
        if same >= self.limits.per_ip {
            return Ok(());
        }
        stream.set_nodelay(true)?;
        stream.set_read_timeout(Some(self.limits.idle))?;
        stream.set_write_timeout(Some(self.limits.write_timeout))?;
        let (reader, writer) = (stream.try_clone()?, stream.try_clone()?);
        let (tx, rx) = mpsc::sync_channel(self.limits.queue);
        self.next_id += 1;
        let id = self.next_id;
        let opened = Instant::now();
        self.conns.insert(addr, Conn { id, stream, tx, opened });
        let (idle, feed) = (self.limits.idle, self.feed.clone());
        let spawned = spawn("tcp-write", move || write_frames(writer, rx))
            .and_then(|()| spawn("tcp-read", move || read_frames(reader, addr, id, idle, feed, conn)));
        if spawned.is_err() {
            self.conns.remove(&addr);
        }
        Ok(())
    }

    fn live(&self, addr: SocketAddr, id: u64) -> bool {
        self.conns.get(&addr).is_some_and(|c| c.id == id)
    }

    fn handle(&mut self, event: Event, now: Micros, server: &mut Server, out: &mut Out) -> io::Result<()> {
        match event {
            Event::Datagram(from, bytes) => server.on_datagram(now, from, &bytes, out),
            Event::Accepted(stream, addr, conn, _queued) => {
                if self.open(stream, addr, conn).is_err() {
                    self.conns.remove(&addr);
                }
            }
            Event::Frame(addr, id, bytes, _queued) if self.live(addr, id) => {
                server.on_packet(now, Peer::tcp(addr), &bytes, out)
            }
            Event::Frame(..) => {}
            Event::Closed(addr, id) if self.live(addr, id) => {
                self.conns.remove(&addr);
            }
            Event::Closed(..) => {}
            Event::Failed(e) => return Err(e),
        }
        Ok(())
    }

    fn sweep(&mut self, server: &Server) {
        if self.swept.elapsed() < SWEEP {
            return;
        }
        self.swept = Instant::now();
        let idle = self.limits.idle;
        self.conns
            .retain(|addr, c| c.opened.elapsed() < idle || server.holds(Peer::tcp(*addr)));
    }

    fn flush(&mut self, socket: &UdpSocket, out: &mut Out) {
        for (peer, bytes) in out.drain(..) {
            match peer.via {
                Transport::Udp => {
                    let _ = socket.send_to(&bytes, peer.addr);
                }
                Transport::Tcp => {
                    let sent = self.conns.get(&peer.addr).map(|c| c.tx.try_send(bytes));
                    if let Some(Err(_)) = sent {
                        self.conns.remove(&peer.addr);
                    }
                }
            }
        }
    }
}

pub fn serve(
    socket: &UdpSocket,
    listener: TcpListener,
    server: &mut Server,
    once: bool,
    idle_us: Micros,
    limits: Limits,
    mut sends: Option<&mut SendLog>,
) -> io::Result<()> {
    let (events, inbox) = mpsc::sync_channel(EVENTS);
    let udp_events = events.clone();
    let udp_socket = socket.try_clone()?;
    spawn("udp-read", move || read_datagrams(udp_socket, udp_events))?;
    let feed = Feed {
        events,
        queued: Arc::new(AtomicUsize::new(0)),
    };
    let (accept_feed, live) = (feed.clone(), Arc::new(AtomicUsize::new(0)));
    spawn("tcp-accept", move || accept(listener, accept_feed, live, limits.total))?;
    let mut hub = Hub {
        conns: HashMap::new(),
        next_id: 0,
        limits,
        feed,
        swept: Instant::now(),
    };
    let origin = Instant::now();
    let now = || origin.elapsed().as_micros() as Micros;
    let mut out = Vec::new();
    loop {
        let t = now();
        server.poll(t, &mut out);
        hub.flush(socket, &mut out);
        hub.sweep(server);
        let Some(wait) = udp::tick(server, t, once, idle_us, sends.as_deref_mut())? else {
            return sends.map_or(Ok(()), SendLog::flush);
        };
        match inbox.recv_timeout(Duration::from_micros(wait as u64)) {
            Ok(event) => {
                hub.handle(event, now(), server, &mut out)?;
                hub.flush(socket, &mut out);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return sends.map_or(Ok(()), SendLog::flush),
        }
    }
}
