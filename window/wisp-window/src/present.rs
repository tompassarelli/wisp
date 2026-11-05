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
