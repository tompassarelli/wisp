#![cfg(unix)]

use std::io::{BufRead, BufReader};
use std::net::UdpSocket;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use relay_proto::control::{self, Control};

extern "C" {
    fn kill(pid: i32, signum: i32) -> i32;
}

const SIGINT: i32 = 2;
const BOUND: Duration = Duration::from_secs(20);

struct Agent(Child);

impl Drop for Agent {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

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

fn next_line(lines: &Receiver<String>, deadline: Instant) -> Option<String> {
    match lines.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(line) => Some(line),
        Err(RecvTimeoutError::Disconnected) => None,
        Err(RecvTimeoutError::Timeout) => panic!("the agent was still running {BOUND:?} after it started"),
    }
}

#[test]
fn sigint_still_writes_the_agent_summary_and_the_trace() {
    let deadline = Instant::now() + BOUND;
    let server = UdpSocket::bind("127.0.0.1:0").unwrap();
    server.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let trace = std::env::temp_dir().join(format!("relay-agent-stop-{}.trace", std::process::id()));
    let mut agent = Agent(
        Command::new(env!("CARGO_BIN_EXE_relay-agent"))
            .args(["--relay", &server.local_addr().unwrap().to_string(), "--name", "g", "--join", "1", "--trace"])
            .arg(&trace)
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let stdout = BufReader::new(agent.0.stdout.take().unwrap());
    let (send, lines) = mpsc::channel();
    thread::spawn(move || stdout.lines().map_while(Result::ok).try_for_each(|line| send.send(line)));
    answer_join(&server);
    while !next_line(&lines, deadline).expect("the agent exited before it listened").contains("listening on") {}
    assert_eq!(unsafe { kill(agent.0.id() as i32, SIGINT) }, 0);
    let mut rest = String::new();
    while let Some(line) = next_line(&lines, deadline) {
        rest.push_str(&line);
        rest.push('\n');
    }
    let status = agent.0.wait().unwrap();
    assert!(rest.contains("agent summary: turns 0 underruns 0 depth 0 releases 0"), "{rest:?}");
    assert!(status.success(), "{status:?}");
    assert!(trace.exists());
    std::fs::remove_file(&trace).unwrap();
}
