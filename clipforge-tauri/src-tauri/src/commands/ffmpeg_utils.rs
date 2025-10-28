use std::path::PathBuf;
use std::process::Command;

/// Find ffprobe executable in common locations
pub fn find_ffprobe() -> Option<PathBuf> {
    find_executable("ffprobe")
}

/// Find ffmpeg executable in common locations
pub fn find_ffmpeg() -> Option<PathBuf> {
    find_executable("ffmpeg")
}

fn find_executable(name: &str) -> Option<PathBuf> {
    // First, try to find it in PATH
    if let Ok(output) = Command::new("which").arg(name).output() {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                return Some(PathBuf::from(path_str));
            }
        }
    }

    // Common installation locations on macOS
    let common_paths = vec![
        format!("/usr/local/bin/{}", name),
        format!("/opt/homebrew/bin/{}", name),
        format!("/usr/bin/{}", name),
        format!("/opt/local/bin/{}", name), // MacPorts
    ];

    for path_str in common_paths {
        let path = PathBuf::from(&path_str);
        if path.exists() {
            return Some(path);
        }
    }

    None
}
