// Frame timing utilities for maintaining consistent frame rates

use std::time::{Duration, Instant};

/// Frame timer for maintaining consistent frame rate when writing to FFmpeg
pub struct FrameTimer {
    /// Target frame rate (frames per second)
    target_fps: u32,
    /// Target duration per frame
    frame_duration: Duration,
    /// Time of last frame
    last_frame_time: Option<Instant>,
    /// Total frames processed
    frame_count: u64,
    /// Frames dropped due to timing
    dropped_frames: u64,
    /// Variable frame rate mode
    variable_framerate: bool,
}

impl FrameTimer {
    /// Create a new frame timer with target FPS
    pub fn new(target_fps: u32) -> Self {
        Self {
            target_fps,
            frame_duration: Duration::from_micros(1_000_000 / target_fps as u64),
            last_frame_time: None,
            frame_count: 0,
            dropped_frames: 0,
            variable_framerate: false,
        }
    }

    /// Create a frame timer with variable frame rate mode
    pub fn new_variable(target_fps: u32) -> Self {
        let mut timer = Self::new(target_fps);
        timer.variable_framerate = true;
        timer
    }

    /// Check if enough time has elapsed for the next frame
    ///
    /// Returns:
    /// - `Ok(true)` - Ready for next frame
    /// - `Ok(false)` - Too early, drop this frame
    /// - `Err(Duration)` - How long to wait before next frame
    pub fn check_frame_ready(&mut self) -> Result<bool, Duration> {
        let now = Instant::now();

        if let Some(last_time) = self.last_frame_time {
            let elapsed = now.duration_since(last_time);

            if elapsed >= self.frame_duration {
                // Enough time has passed
                Ok(true)
            } else if self.variable_framerate {
                // VFR mode: accept any frame timing
                Ok(true)
            } else {
                // Not enough time, calculate wait time
                Err(self.frame_duration - elapsed)
            }
        } else {
            // First frame, always ready
            Ok(true)
        }
    }

    /// Mark that a frame was written
    /// Should be called after successfully writing a frame
    pub fn mark_frame_written(&mut self) {
        self.last_frame_time = Some(Instant::now());
        self.frame_count += 1;
    }

    /// Mark that a frame was dropped due to timing
    pub fn mark_frame_dropped(&mut self) {
        self.dropped_frames += 1;
    }

    /// Wait until the next frame is due
    /// Returns immediately in variable framerate mode
    pub fn wait_for_next_frame(&self) -> Duration {
        if self.variable_framerate {
            return Duration::from_micros(0);
        }

        if let Some(last_time) = self.last_frame_time {
            let elapsed = Instant::now().duration_since(last_time);
            if elapsed < self.frame_duration {
                return self.frame_duration - elapsed;
            }
        }

        Duration::from_micros(0)
    }

    /// Calculate actual FPS based on timing
    pub fn calculate_actual_fps(&self) -> f32 {
        if let Some(last_time) = self.last_frame_time {
            if self.frame_count > 1 {
                let total_duration = Instant::now().duration_since(
                    last_time - self.frame_duration * (self.frame_count as u32 - 1),
                );
                return (self.frame_count as f32) / total_duration.as_secs_f32();
            }
        }
        0.0
    }

    /// Get timing statistics
    pub fn stats(&self) -> FrameTimingStats {
        FrameTimingStats {
            target_fps: self.target_fps,
            frame_count: self.frame_count,
            dropped_frames: self.dropped_frames,
            actual_fps: self.calculate_actual_fps(),
            variable_framerate: self.variable_framerate,
        }
    }

    /// Reset the timer
    pub fn reset(&mut self) {
        self.last_frame_time = None;
        self.frame_count = 0;
        self.dropped_frames = 0;
    }

    /// Enable or disable variable frame rate mode
    pub fn set_variable_framerate(&mut self, enabled: bool) {
        self.variable_framerate = enabled;
    }

    /// Get target FPS
    pub fn target_fps(&self) -> u32 {
        self.target_fps
    }

    /// Set new target FPS
    pub fn set_target_fps(&mut self, fps: u32) {
        self.target_fps = fps;
        self.frame_duration = Duration::from_micros(1_000_000 / fps as u64);
    }
}

/// Frame timing statistics
#[derive(Debug, Clone)]
pub struct FrameTimingStats {
    pub target_fps: u32,
    pub frame_count: u64,
    pub dropped_frames: u64,
    pub actual_fps: f32,
    pub variable_framerate: bool,
}

impl FrameTimingStats {
    /// Get the frame drop percentage
    pub fn drop_percentage(&self) -> f32 {
        if self.frame_count + self.dropped_frames == 0 {
            return 0.0;
        }
        (self.dropped_frames as f32 / (self.frame_count + self.dropped_frames) as f32) * 100.0
    }

    /// Check if timing is within acceptable range (within 5% of target)
    pub fn is_timing_acceptable(&self) -> bool {
        let target = self.target_fps as f32;
        let actual = self.actual_fps;
        let diff_percentage = ((actual - target).abs() / target) * 100.0;
        diff_percentage <= 5.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_frame_timer_basic() {
        let mut timer = FrameTimer::new(30);
        assert_eq!(timer.target_fps(), 30);

        // First frame should always be ready
        assert!(timer.check_frame_ready().is_ok());
        timer.mark_frame_written();

        // Immediately after, should not be ready
        match timer.check_frame_ready() {
            Err(duration) => {
                assert!(duration > Duration::from_micros(0));
            }
            _ => panic!("Should not be ready immediately"),
        }
    }

    #[test]
    fn test_variable_framerate() {
        let mut timer = FrameTimer::new_variable(30);
        assert!(timer.variable_framerate);

        timer.mark_frame_written();

        // In VFR mode, should always be ready
        assert!(timer.check_frame_ready().is_ok());
    }

    #[test]
    fn test_frame_timing_wait() {
        let timer = FrameTimer::new(60);
        let wait_time = timer.wait_for_next_frame();
        // First frame should have no wait
        assert_eq!(wait_time, Duration::from_micros(0));
    }

    #[test]
    fn test_stats() {
        let mut timer = FrameTimer::new(30);
        timer.mark_frame_written();
        timer.mark_frame_dropped();
        timer.mark_frame_dropped();

        let stats = timer.stats();
        assert_eq!(stats.frame_count, 1);
        assert_eq!(stats.dropped_frames, 2);
    }

    #[test]
    fn test_drop_percentage() {
        let stats = FrameTimingStats {
            target_fps: 30,
            frame_count: 80,
            dropped_frames: 20,
            actual_fps: 28.5,
            variable_framerate: false,
        };

        assert_eq!(stats.drop_percentage(), 20.0);
    }
}
