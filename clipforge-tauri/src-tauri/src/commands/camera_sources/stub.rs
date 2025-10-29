// Stub implementation for non-macOS platforms

use super::{CameraDevice, CameraEnumerator};

/// Platform enumerator (stub)
pub struct PlatformEnumerator;

impl CameraEnumerator for PlatformEnumerator {
    fn enumerate_cameras() -> Result<Vec<CameraDevice>, String> {
        // Return empty list on unsupported platforms
        // TODO: Implement for Windows and Linux
        Ok(Vec::new())
    }
}
