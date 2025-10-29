// Recording-related types matching Rust backend types

export type SourceType = 'screen' | 'window';

export interface ScreenSource {
  id: string;
  name: string;
  source_type: SourceType;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
  scale_factor: number;
  thumbnail?: string; // base64 encoded PNG
  app_name?: string; // for windows
}

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopping' | 'error';

export type RecordingType = 'screen' | 'webcam' | 'screenandwebcam';

export interface RecordingConfig {
  width: number;
  height: number;
  frame_rate: number;
  video_bitrate: number;
  video_codec: string;
  audio_sample_rate: number;
  audio_channels: number;
  audio_bitrate: number;
  audio_codec: string;
  output_format: string;
}

export interface RecordingState {
  id: string;
  recording_type: RecordingType;
  status: RecordingStatus;
  start_time?: number;
  pause_time: number;
  paused_at?: number;
  duration: number;
  file_path?: string;
  config: RecordingConfig;
}

export interface RecordingOptions {
  recording_type: RecordingType;
  source_id: string;
  config?: RecordingConfig;
  include_audio: boolean;
}
