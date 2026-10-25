pub use imp::Waiter;

#[cfg(target_os = "linux")]
mod imp {
    use std::io;
    use std::net::UdpSocket;
    use std::os::fd::AsRawFd;
    use std::time::Duration;

    const POLLIN: i16 = 1;

    #[repr(C)]
    struct PollFd {
        fd: i32,
        events: i16,
        revents: i16,
    }

    #[repr(C)]
    struct Timespec {
        tv_sec: i64,
        tv_nsec: i64,
    }

    extern "C" {
        fn ppoll(fds: *mut PollFd, nfds: u64, timeout: *const Timespec, sigmask: *const u8) -> i32;
    }

    #[derive(Debug)]
    pub struct Waiter;

    impl Waiter {
        pub fn new() -> io::Result<Waiter> {
            Ok(Waiter)
        }

        pub fn readable(&self, socket: &UdpSocket, wait: Duration) -> io::Result<bool> {
            let mut fd = PollFd { fd: socket.as_raw_fd(), events: POLLIN, revents: 0 };
            // SO_RCVTIMEO counts in 1 ms jiffies; ppoll sleeps on an hrtimer, which wakes late by its slack
            let timeout = Timespec { tv_sec: wait.as_secs() as i64, tv_nsec: wait.subsec_nanos() as i64 };
            match unsafe { ppoll(&mut fd, 1, &timeout, std::ptr::null()) } {
                n if n < 0 => Err(io::Error::last_os_error()),
                n => Ok(n > 0),
            }
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::io;
    use std::net::UdpSocket;
    use std::os::windows::io::AsRawSocket;
    use std::time::Duration;

    type Handle = *mut c_void;

    const CREATE_WAITABLE_TIMER_HIGH_RESOLUTION: u32 = 0x2;
    const TIMER_ALL_ACCESS: u32 = 0x1F_0003;
    const FD_READ: i32 = 1;
    const INFINITE: u32 = u32::MAX;
    const WAIT_OBJECT_0: u32 = 0;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateWaitableTimerExW(attributes: *const c_void, name: *const u16, flags: u32, access: u32) -> Handle;
        fn SetWaitableTimer(timer: Handle, due: *const i64, period: i32, routine: *const c_void, arg: *const c_void, resume: i32) -> i32;
        fn WaitForMultipleObjects(count: u32, handles: *const Handle, all: i32, millis: u32) -> u32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    #[link(name = "ws2_32")]
    extern "system" {
        fn WSACreateEvent() -> Handle;
        fn WSAResetEvent(event: Handle) -> i32;
        fn WSAEventSelect(socket: usize, event: Handle, events: i32) -> i32;
        fn WSACloseEvent(event: Handle) -> i32;
    }

    #[derive(Debug)]
    pub struct Waiter {
        readable: Handle,
        timer: Handle,
    }

    unsafe impl Send for Waiter {}

    impl Waiter {
        pub fn new() -> io::Result<Waiter> {
            // A plain waitable timer or a millisecond timeout wakes on the 15.6 ms system tick
            let timer = unsafe {
                CreateWaitableTimerExW(std::ptr::null(), std::ptr::null(), CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS)
            };
            if timer.is_null() {
                return Err(io::Error::last_os_error());
            }
            let readable = unsafe { WSACreateEvent() };
            if readable.is_null() {
                let e = io::Error::last_os_error();
                unsafe { CloseHandle(timer) };
                return Err(e);
            }
            Ok(Waiter { readable, timer })
        }

        pub fn readable(&self, socket: &UdpSocket, wait: Duration) -> io::Result<bool> {
            if wait.is_zero() {
                return Ok(true);
            }
            let due = -i64::try_from(wait.as_nanos().div_ceil(100)).unwrap_or(i64::MAX);
            let armed = unsafe {
                SetWaitableTimer(self.timer, &due, 0, std::ptr::null(), std::ptr::null(), 0) != 0
                    && WSAResetEvent(self.readable) != 0
                    && WSAEventSelect(socket.as_raw_socket() as usize, self.readable, FD_READ) == 0
            };
            if !armed {
                return Err(io::Error::last_os_error());
            }
            let handles = [self.readable, self.timer];
            match unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, INFINITE) } {
                WAIT_OBJECT_0 => Ok(true),
                n if n == WAIT_OBJECT_0 + 1 => Ok(false),
                _ => Err(io::Error::last_os_error()),
            }
        }
    }

    impl Drop for Waiter {
        fn drop(&mut self) {
            unsafe {
                WSACloseEvent(self.readable);
                CloseHandle(self.timer);
            }
        }
    }
}
