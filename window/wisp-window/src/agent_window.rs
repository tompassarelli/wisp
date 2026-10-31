//! The app id a window an agent launched carries, so niri can place it on a named workspace without taking the seat's focus.

const AGENT_APP_ID: &str = "wisp-agent";

pub fn agent_launched(var: &dyn Fn(&str) -> Option<std::ffi::OsString>) -> bool {
    var("AI_AGENT").is_some_and(|value| !value.is_empty())
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn named_for_agent(attributes: winit::window::WindowAttributes, agent: bool) -> winit::window::WindowAttributes {
    use winit::platform::{wayland::WindowAttributesExtWayland, x11::WindowAttributesExtX11};
    if !agent {
        return attributes;
    }
    let attributes = WindowAttributesExtWayland::with_name(attributes, AGENT_APP_ID, AGENT_APP_ID);
    WindowAttributesExtX11::with_name(attributes, AGENT_APP_ID, AGENT_APP_ID)
}

#[cfg(not(all(unix, not(target_os = "macos"))))]
pub fn named_for_agent(attributes: winit::window::WindowAttributes, _: bool) -> winit::window::WindowAttributes {
    attributes
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::agent_launched;

    fn env(value: Option<&'static str>) -> impl Fn(&str) -> Option<OsString> {
        move |key| if key == "AI_AGENT" { value.map(OsString::from) } else { None }
    }

    #[test]
    fn an_ai_agent_marker_selects_the_agent_app_id() {
        assert!(agent_launched(&env(Some("claude-code/2.1"))));
        assert!(!agent_launched(&env(Some(""))));
        assert!(!agent_launched(&env(None)));
    }
}
