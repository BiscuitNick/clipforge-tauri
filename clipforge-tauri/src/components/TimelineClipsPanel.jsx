import "./TimelineClipsPanel.css";

/**
 * Timeline Clips Panel - Shows clips currently on timeline
 * Provides expandable details and trim point editors
 */
function TimelineClipsPanel() {
  return (
    <div className="timeline-clips-panel">
      <div className="panel-header">
        <h2>Timeline Clips</h2>
      </div>
      <div className="panel-content">
        <p className="placeholder-text">Timeline Clips Panel</p>
        <p className="placeholder-hint">Edit/Configure clips here</p>
      </div>
    </div>
  );
}

export default TimelineClipsPanel;
