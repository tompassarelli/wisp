use std::io::{self, ErrorKind};
use std::net::UdpSocket;
use std::time::{Duration, Instant};

use relay_proto::Micros;

use crate::server::{Out, Server};

const MAX_WAIT_US: Micros = 50_000;
const MIN_WAIT_US: Micros = 100;

fn flush(socket: &UdpSocket, out: &mut Out) {
    for (addr, bytes) in out.drain(..) {
        let _ = socket.send_to(&bytes, addr);
    }
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
        if once && server.rooms() == 0 && (server.stats().rooms_closed > 0 || t >= idle_us) {
            return Ok(());
        }
        let wait = server
            .next_wake()
            .map_or(MAX_WAIT_US, |w| w - t)
            .clamp(MIN_WAIT_US, MAX_WAIT_US);
        socket.set_read_timeout(Some(Duration::from_micros(wait as u64)))?;
        match socket.recv_from(&mut buf) {
            Ok((n, from)) => {
                server.on_datagram(now(), from, &buf[..n], &mut out);
                flush(socket, &mut out);
            }
            Err(e)
                if matches!(
                    e.kind(),
                    ErrorKind::WouldBlock
                        | ErrorKind::TimedOut
                        | ErrorKind::ConnectionReset
                        | ErrorKind::ConnectionRefused
                        | ErrorKind::Interrupted
                ) => {}
            Err(e) => return Err(e),
        }
    }
}
