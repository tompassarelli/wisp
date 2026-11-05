use super::*;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::input::Input;
use crate::mailbox::Sample;
use crate::stepper::{self, Seam, Stepper};

const PERIOD_NS: u64 = 16_666_667;

struct Quiet;

impl Seam for Quiet {
    fn input(&mut self) -> Input {
        Input::default()
    }
}

#[test]
fn stop_wakes_a_blocked_consumer() {
    let mailbox = Arc::new(Mailbox::default());
    let consumer = {
        let mailbox = mailbox.clone();
        thread::spawn(move || {
            let began = Instant::now();
            (mailbox.next_event(Duration::from_secs(30)), began.elapsed())
        })
    };
    thread::sleep(Duration::from_millis(50));
    mailbox.stop();
    let (event, waited) = consumer.join().unwrap();
    assert_eq!(event, Event::Ended(End::Stopped), "the blocked consumer is told of the stop");
    assert!(waited < Duration::from_secs(5), "the consumer returned long before its 30 s timeout");
    mailbox.push_sample(Sample { frame: 0, sampled_ns: 0, input: Input::default() });
    assert_eq!(mailbox.next_event(Duration::from_secs(30)), Event::Ended(End::Stopped), "a stop outranks a queued sample");
}

#[test]
fn stop_during_submit_leaves_no_scene_behind() {
    let mailbox = Arc::new(Mailbox::default());
    let submitter = {
        let mailbox = mailbox.clone();
        thread::spawn(move || {
            let mut frame = 0;
            while !mailbox.is_stopping() {
                mailbox.submit(Submission { bytes: vec![0; 4096], step: 1, frame, arrived_ns: 0 });
                frame += 1;
            }
            mailbox.submit(Submission { bytes: b"{}".to_vec(), step: 2, frame, arrived_ns: 0 });
        })
    };
    thread::sleep(Duration::from_millis(20));
    mailbox.stop();
    submitter.join().unwrap();
    assert!(mailbox.take_scene().is_none(), "no scene survives a stop, however late its submit");
    assert!(!mailbox.wait_for_scene(0, Duration::from_secs(5)), "a stopped mailbox does not wait for a scene");
}

#[derive(Clone)]
struct RealClock;

impl Clock for RealClock {
    fn now_ns(&self) -> u64 {
        crate::clock::now_ns()
    }
}

/// A window the compositor does not show: no image, after the 4 ms the real surface sleeps for one.
struct Unshown;

impl Surface for Unshown {
    type Image = ();

    fn acquire(&mut self) -> Option<()> {
        thread::sleep(Duration::from_millis(4));
        None
    }

    fn draw(&mut self, _: &(), _: u64) {}

    fn present(&self, _: ()) {}
}

fn answer_every_sample(mailbox: &Arc<Mailbox>) -> JoinHandle<u32> {
    let mailbox = mailbox.clone();
    thread::spawn(move || {
        let mut stepped = 0;
        while let Event::Frame(sample) = mailbox.next_event(Duration::from_secs(10)) {
            stepped += 1;
            mailbox.submit(Submission { bytes: b"{}".to_vec(), step: sample.frame as u64 + 1, frame: sample.frame, arrived_ns: crate::clock::now_ns() });
        }
        stepped
    })
}

#[test]
fn the_step_clock_steps_sixty_times_a_second_on_its_own_thread_while_the_window_has_no_image() {
    const RUN: Duration = Duration::from_secs(2);
    let mailbox = Arc::new(Mailbox::default());
    let steps = Arc::new(Stepper::default());
    let consumer = answer_every_sample(&mailbox);
    let began = Instant::now();
    let clock_thread = {
        let (steps, mailbox) = (steps.clone(), mailbox.clone());
        thread::spawn(move || stepper::run(steps, RealClock, mailbox, || Some(Mode::Game), Quiet))
    };
    let mut frames = FrameLoop::new(Unshown, RealClock, mailbox.clone(), Arc::new(Mutex::new(Metrics::default())), steps.clone());
    while began.elapsed() < RUN {
        assert!(!frames.frame(Mode::Game), "nothing was drawn");
    }
    mailbox.stop();
    let elapsed = began.elapsed().as_secs_f64();
    clock_thread.join().unwrap();
    let stepped = consumer.join().unwrap();
    let dropped = steps.take().dropped;
    let expected = elapsed * 60.0;
    assert!(stepped as f64 <= expected + 2.0, "{stepped} steps in {elapsed:.3} s with no image, more than the {expected:.1} due");
    assert!(((stepped + dropped) as f64 - expected).abs() <= 2.0, "{stepped} steps and {dropped} dropped in {elapsed:.3} s with no image, {expected:.1} were due");
}

mod simulated;
