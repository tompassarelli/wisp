use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

static STOP: AtomicBool = AtomicBool::new(false);

extern "C" {
    fn signal(signum: i32, handler: extern "C" fn(i32)) -> usize;
}

extern "C" fn on_signal(_: i32) {
    STOP.store(true, Ordering::Relaxed);
}

pub fn on_signals() {
    // SIGINT is 2 and SIGTERM is 15 on Linux, macOS and Windows' C runtime
    for signum in [2, 15] {
        unsafe { signal(signum, on_signal) };
    }
}

pub fn requested() -> bool {
    STOP.load(Ordering::Relaxed)
}

#[derive(Clone, Debug, Default)]
pub struct StopHandle(Arc<AtomicBool>);

impl StopHandle {
    pub fn stop(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    pub fn stopped(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}
