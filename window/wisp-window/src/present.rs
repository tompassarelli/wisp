/// What the player asked of the present path. `Mailbox` is the default: its acquire returns at once and the display latches the newest image, so the window is paced from the vblank phase it extrapolates and a press reaches the screen about three frames sooner than under `Fifo`, whose acquire waits for the display behind the images it queued. `Immediate` presents on ready: each step's scene is drawn and presented as soon as it arrives, one frame a step, so a display that refreshes when given an image shows it at once.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum PresentSetting {
    Fifo,
    #[default]
    Mailbox,
    Immediate,
}

const FALLBACKS: [PresentSetting; 3] = [PresentSetting::Mailbox, PresentSetting::Fifo, PresentSetting::Immediate];

impl PresentSetting {
    pub fn from_code(code: u8) -> Self {
        match code {
            0 => Self::Fifo,
            1 => Self::Mailbox,
            2 => Self::Immediate,
            _ => Self::default(),
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

    /// The setting itself when the surface offers it, else the first of `Mailbox`, `Fifo` and `Immediate` it offers, else `Fifo`, which Vulkan requires of every surface.
    pub fn offered(self, modes: &[wgpu::PresentMode]) -> Self {
        std::iter::once(self).chain(FALLBACKS).find(|setting| modes.contains(&setting.mode())).unwrap_or(Self::Fifo)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wgpu::PresentMode::{Fifo, Immediate, Mailbox};

    #[test]
    fn the_default_is_mailbox_where_the_surface_offers_it() {
        assert_eq!(PresentSetting::default().offered(&[Fifo, Mailbox, Immediate]), PresentSetting::Mailbox);
        assert_eq!(PresentSetting::from_code(9), PresentSetting::Mailbox);
    }

    #[test]
    fn a_surface_without_mailbox_falls_back_to_fifo_then_immediate() {
        assert_eq!(PresentSetting::default().offered(&[Fifo, Immediate]), PresentSetting::Fifo);
        assert_eq!(PresentSetting::default().offered(&[Immediate]), PresentSetting::Immediate);
        assert_eq!(PresentSetting::default().offered(&[]), PresentSetting::Fifo);
    }

    #[test]
    fn a_mode_the_player_asked_for_wins_when_offered_and_falls_back_in_order_when_not() {
        assert_eq!(PresentSetting::from_code(0).offered(&[Fifo, Mailbox]), PresentSetting::Fifo);
        assert_eq!(PresentSetting::Immediate.offered(&[Fifo, Mailbox, Immediate]), PresentSetting::Immediate);
        assert_eq!(PresentSetting::Immediate.offered(&[Fifo, Mailbox]), PresentSetting::Mailbox);
        assert_eq!(PresentSetting::Immediate.offered(&[Fifo]), PresentSetting::Fifo);
    }
}
