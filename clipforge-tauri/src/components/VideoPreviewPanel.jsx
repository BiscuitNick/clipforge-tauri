import "./VideoPreviewPanel.css";

/**
 * Video Preview Panel - Central playback area
 * Shows mode indicator and player controls
 */
function VideoPreviewPanel() {
  return (
    <div className="video-preview-panel">
      <div className="panel-header">
        <h2>Video Preview</h2>
      </div>
      <div className="panel-content">
        <div className="preview-placeholder">
          <p className="placeholder-text">Video Preview Panel</p>
          <p className="placeholder-hint">Playback controls here</p>
        </div>
      </div>
    </div>
  );
}

export default VideoPreviewPanel;
