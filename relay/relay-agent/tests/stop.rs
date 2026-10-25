use std::io::{BufRead, BufReader, Read};
use std::net::UdpSocket;
use std::process::{Command, Stdio};
use std::time::Duration;

use relay_proto::control::{self, Control};

extern "C" {
    fn kill(pid: i32, signum: i32) -> i32;
}

const SIGINT: i32 = 2;

fn answer_join(server: &UdpSocket) {
    let mut buf = [0u8; 2048];
    loop {
        let (n, from) = server.recv_from(&mut buf).unwrap();
        if let Ok(Control::Join { request, .. }) = control::decode(&buf[..n]) {
            let room = Control::Room { request, room: 1, token: 9, players: 2, slot: 1, steps: vec![8] };
            server.send_to(&control::encode(&room), from).unwrap();
            return;
        }
    }
}

#[test]
fn sigint_still_writes_the_agent_summary_and_the_trace() {
    let server = UdpSocket::bind("127.0.0.1:0").unwrap();
    server.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let trace = std::env::temp_dir().join(format!("relay-agent-stop-{}.trace", std::process::id()));
    let mut child = Command::new(env!("CARGO_BIN_EXE_relay-agent"))
        .args(["--relay", &server.local_addr().unwrap().to_string(), "--name", "g", "--join", "1", "--trace"])
        .arg(&trace)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    answer_join(&server);
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    while !line.contains("listening on") {
        line.clear();
        assert_ne!(stdout.read_line(&mut line).unwrap(), 0, "the agent exited before it listened");
    }
    assert_eq!(unsafe { kill(child.id() as i32, SIGINT) }, 0);
    let mut rest = String::new();
    stdout.read_to_string(&mut rest).unwrap();
    let status = child.wait().unwrap();
    assert!(rest.contains("agent summary: turns 0 underruns 0 depth 0 releases 0"), "{rest:?}");
    assert!(status.success(), "{status:?}");
    assert!(trace.exists());
    std::fs::remove_file(&trace).unwrap();
}
