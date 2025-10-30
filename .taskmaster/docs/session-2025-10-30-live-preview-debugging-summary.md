## Session Summary — 2025-10-30 Live Preview & Recording Debug

### What we changed
- **ScreenCaptureKit throttling** — `PreviewState` now syncs the emission interval with the configured FPS (divisor defaults to 1) so we don’t silently skip frames.
- **Preview poller pacing** — The Tauri frame polling task sleeps for the remaining interval instead of immediately looping, which prevents the “emitted 1, dropped N-1” metric inflation.
- **Frame diagnostics** — Added logging at each hop (Swift → Rust → React) to record JPEG payload size, base64 length, and ScreenCaptureKit frame status. This confirmed ScreenCaptureKit delivers full frames, Rust dequeues them, and the frontend receives base64 images.
- **FFmpeg display mapping** — `display_#` IDs now map to the correct AVFoundation index by offsetting with the detected camera count (`screen_capture.rs`). Recording no longer defaults to device `2:0`.

### Key observations
- The floating Preview overlay is fully ScreenCaptureKit-driven; the static “Preview panel” still uses the legacy FFmpeg snapshot pipeline until we swap it.
- Canvas `toDataURL()` returned a full data URI even when the overlay looked black, proving the pixels were there and the issue was in the double-buffer/canvas visibility logic (not the capture stack).
- ScreenCaptureKit sometimes delivers samples without pixel buffers; logging their status values helps verify they are intentionally blank rather than errors.
- `ffprobe` failures persist because the saved MP4 still can’t be probed (needs follow-up). We now have the exact FFmpeg command/device string to reproduce the issue manually.

### Follow-up ideas
1. Simplify the Preview overlay rendering (single canvas or ensure the visible buffer matches the drawn frame) so the live image is actually displayed.
2. Switch the recording path from AVFoundation to the ScreenCaptureKit streaming bridge (or at least fix the current FFmpeg invocation) to resolve the ongoing `ffprobe` failures.
3. Remove or hide the legacy snapshot panel once the live overlay is verified, to avoid user confusion.
4. Replace `NSLock` in `ContentCache` with an async-safe locking strategy to eliminate Swift concurrency warnings in future builds.
