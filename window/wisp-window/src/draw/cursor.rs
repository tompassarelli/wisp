use super::Gpu;

impl Gpu {
    pub fn cursor_shown(&self) -> bool {
        shown(self.scene.as_ref().is_some_and(|scene| scene.cursor_hidden), self.menu.is_open())
    }
}

fn shown(hidden: bool, menu_open: bool) -> bool {
    !hidden || menu_open
}

#[cfg(test)]
mod tests {
    use super::super::DrawScene;
    use super::*;

    #[test]
    fn the_cursor_hides_only_when_the_map_hides_it_and_the_options_screen_is_closed() {
        assert!(shown(false, false));
        assert!(!shown(true, false));
        assert!(shown(true, true));
        let hidden = DrawScene::parse(br#"{"cursorHidden":true}"#).unwrap();
        assert!(hidden.cursor_hidden);
        assert!(!DrawScene::parse(b"{}").unwrap().cursor_hidden);
    }
}
