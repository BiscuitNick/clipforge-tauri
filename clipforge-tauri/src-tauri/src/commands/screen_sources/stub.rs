use super::{ScreenSource, SourceEnumerator};

/// Stub implementation for non-macOS platforms
pub struct PlatformEnumerator;

impl SourceEnumerator for PlatformEnumerator {
    fn enumerate_screens() -> Result<Vec<ScreenSource>, String> {
        // TODO: Implement Windows and Linux screen enumeration
        Err("Screen enumeration not implemented for this platform".to_string())
    }

    fn enumerate_windows() -> Result<Vec<ScreenSource>, String> {
        // TODO: Implement Windows and Linux window enumeration
        Err("Window enumeration not implemented for this platform".to_string())
    }
}
