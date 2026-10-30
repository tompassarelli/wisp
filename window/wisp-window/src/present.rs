/// What the player asked of the present path. `Fifo` is the default and the only mode whose acquire waits for the display; the others tear or skip frames and are paced from the phase `Fifo` learned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum PresentSetting {
    Fifo,
    Mailbox,
    Immediate,
}

impl PresentSetting {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Mailbox,
            2 => Self::Immediate,
            _ => Self::Fifo,
        }
    }

    pub fn mode(self) -> wgpu::PresentMode {
        match self {
            Self::Fifo => wgpu::PresentMode::Fifo,
            Self::Mailbox => wgpu::PresentMode::Mailbox,
            Self::Immediate => wgpu::PresentMode::Immediate,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Fifo => "Fifo",
            Self::Mailbox => "Mailbox",
            Self::Immediate => "Immediate",
        }
    }

    /// The setting itself when the surface offers it, else `Fifo`, which every surface offers.
    pub fn offered(self, modes: &[wgpu::PresentMode]) -> Self {
        if modes.contains(&self.mode()) {
            self
        } else {
            Self::Fifo
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mode_the_surface_lacks_falls_back_to_fifo() {
        let offered = [wgpu::PresentMode::Fifo, wgpu::PresentMode::Mailbox];
        assert_eq!(PresentSetting::Mailbox.offered(&offered), PresentSetting::Mailbox);
        assert_eq!(PresentSetting::Immediate.offered(&offered), PresentSetting::Fifo);
        assert_eq!(PresentSetting::from_code(9), PresentSetting::Fifo);
    }
}
