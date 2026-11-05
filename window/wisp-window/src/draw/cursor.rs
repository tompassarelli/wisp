use super::Gpu;

impl Gpu {
    pub fn cursor_shown(&self) -> bool {
        shown(self.scene.as_ref().is_some_and(|scene| scene.cursor_hidden), self.menu.is_open())
    }
}

fn shown(hidden: bool, menu_open: bool) -> bool {
    !hidden || menu_open
}
