use std::io::{self, ErrorKind};
use std::net::UdpSocket;
use std::time::{Duration, Instant};

use relay_proto::transport::Transport;
use relay_proto::Micros;

use crate::server::{Out, Server};

const MAX_WAIT_US: Micros = 50_000;
const MIN_WAIT_US: Micros = 100;

fn flush(socket: &UdpSocket, out: &mut Out) {
    for (peer, bytes) in out.drain(..) {
        if peer.via == Transport::Udp {
            let _ = socket.send_to(&bytes, peer.addr);
        }
    }
}

pub(crate) fn quiet(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        ErrorKind::WouldBlock
            | ErrorKind::TimedOut
            | ErrorKind::ConnectionReset
            | ErrorKind::ConnectionRefused
            | ErrorKind::Interrupted
    )
}

pub(crate) fn tick(server: &mut Server, t: Micros, once: bool, idle_us: Micros) -> Option<Micros> {
    for line in server.take_log() {
        println!("{:.3} {line}", t as f64 / 1e6);
    }
    if once && server.rooms() == 0 && (server.stats().rooms_closed > 0 || t >= idle_us) {
        return None;
    }
    Some(
        server
            .next_wake()
            .map_or(MAX_WAIT_US, |w| w - t)
            .clamp(MIN_WAIT_US, MAX_WAIT_US),
    )
}

pub fn serve(
    socket: &UdpSocket,
    server: &mut Server,
    once: bool,
    idle_us: Micros,
) -> io::Result<()> {
    let origin = Instant::now();
    let now = || origin.elapsed().as_micros() as Micros;
    let mut buf = [0u8; 2048];
    let mut out = Vec::new();
    loop {
        let t = now();
        server.poll(t, &mut out);
        flush(socket, &mut out);
        let Some(wait) = tick(server, t, once, idle_us) else {
            return Ok(());
        };
        socket.set_read_timeout(Some(Duration::from_micros(wait as u64)))?;
        match socket.recv_from(&mut buf) {
            Ok((n, from)) => {
                server.on_datagram(now(), from, &buf[..n], &mut out);
                flush(socket, &mut out);
            }
            Err(e) if quiet(&e) => {}
            Err(e) => return Err(e),
        }
    }
}
