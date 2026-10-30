/// Holds the system timer at 1 ms while it lives; Windows wakes timed waits on a tick of about 15.6 ms unless a process asks for finer.
pub struct TimerResolution(());

#[cfg(windows)]
impl TimerResolution {
    const PERIOD_MS: u32 = 1;

    pub fn raise() -> Self {
        // SAFETY: timeBeginPeriod takes a plain integer and pairs with the timeEndPeriod in Drop.
        unsafe { windows::Win32::Media::timeBeginPeriod(Self::PERIOD_MS) };
        Self(())
    }
}

#[cfg(windows)]
impl Drop for TimerResolution {
    fn drop(&mut self) {
        // SAFETY: matches the timeBeginPeriod in `raise` with the same period.
        unsafe { windows::Win32::Media::timeEndPeriod(Self::PERIOD_MS) };
    }
}

#[cfg(not(windows))]
impl TimerResolution {
    pub fn raise() -> Self {
        Self(())
    }
}
