use std::sync::atomic::{AtomicBool, Ordering};

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
