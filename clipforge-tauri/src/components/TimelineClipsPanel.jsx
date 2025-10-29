import { useState, useMemo } from "react";
import "./TimelineClipsPanel.css";

/**
 * Timeline Clips Panel - Shows clips currently on timeline
 * Provides expandable details and trim point editors
 */
function TimelineClipsPanel({
  clips = [],
  selectedClipId,
  onClipSelect,
  onClipUpdate,
  onClipRemove,
  onSnapLeft,
  onSnapRight,
  onCollapse
}) {
  const [expandedClipId, setExpandedClipId] = useState(null);

  // Sort clips by position (startTime)
  const sortedClips = useMemo(() => {
    return [...clips].sort((a, b) => a.startTime - b.startTime);
  }, [clips]);

  // Format time in MM:SS format
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Toggle expansion for a clip
  const handleToggleExpand = (clipId) => {
    if (expandedClipId === clipId) {
      setExpandedClipId(null);
    } else {
      setExpandedClipId(clipId);
    }
  };

  // Handle immediate input changes with auto-clamping
  const handlePositionChange = (clipId, value) => {
    const startTime = Math.max(0, parseFloat(value) || 0);
    onClipUpdate(clipId, { startTime });
  };

  const handleTrimStartChange = (clipId, value) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    let trimStart = Math.max(0, Math.min(parseFloat(value) || 0, clip.duration));
    const trimEnd = clip.trimEnd || clip.duration;

    // Ensure trimStart < trimEnd
    if (trimStart >= trimEnd) {
      trimStart = Math.max(0, trimEnd - 0.1);
    }

    onClipUpdate(clipId, { trimStart, trimEnd });
  };

  const handleTrimEndChange = (clipId, value) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    const trimStart = clip.trimStart || 0;
    let trimEnd = Math.max(0, Math.min(parseFloat(value) || 0, clip.duration));

    // Ensure trimEnd > trimStart
    if (trimEnd <= trimStart) {
      trimEnd = Math.min(trimStart + 0.1, clip.duration);
    }

    onClipUpdate(clipId, { trimStart, trimEnd });
  };

  if (sortedClips.length === 0) {
    return (
      <div className="timeline-clips-panel">
        <div className="panel-header">
          <h2>Timeline Clips</h2>
          <div className="header-actions">
            <span className="clip-count">0 clips</span>
            <button
              className="collapse-button"
              onClick={() => onCollapse && onCollapse()}
              aria-label="Hide panel"
              title="Hide panel"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="panel-content empty">
          <p className="empty-message">No clips on timeline</p>
          <p className="empty-hint">Drag media from the library to add clips</p>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-clips-panel">
      <div className="panel-header">
        <h2>Timeline Clips</h2>
        <div className="header-actions">
          <span className="clip-count">{sortedClips.length} {sortedClips.length === 1 ? 'clip' : 'clips'}</span>
          <button
            className="collapse-button"
            onClick={() => onCollapse && onCollapse()}
            aria-label="Hide panel"
            title="Hide panel"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="panel-content">
        <div className="clips-list">
          {sortedClips.map((clip, index) => {
            const isExpanded = expandedClipId === clip.id;
            const isSelected = selectedClipId === clip.id;
            const trimStart = clip.trimStart || 0;
            const trimEnd = clip.trimEnd || clip.duration;
            const clipDuration = trimEnd - trimStart;

            return (
              <div
                key={clip.id}
                className={`clip-item ${isExpanded ? 'expanded' : ''} ${isSelected ? 'selected' : ''}`}
              >
                <div
                  className="clip-header"
                  onClick={() => onClipSelect && onClipSelect(clip.id)}
                >
                  <div className="clip-info">
                    <span className="clip-number">#{index + 1}</span>
                    <span className="clip-filename" title={clip.filename}>
                      {clip.filename}
                    </span>
                  </div>
                  <div className="clip-meta">
                    <span className="clip-position" title="Timeline Position">
                      {formatTime(clip.startTime)}
                    </span>
                    <span className="clip-duration" title="Trimmed Duration">
                      ({formatTime(clipDuration)})
                    </span>
                    <button
                      className="expand-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleExpand(clip.id);
                      }}
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="clip-details">
                    <div className="detail-row">
                      <label>Position (s):</label>
                      <div className="input-with-snaps">
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={clip.startTime.toFixed(1)}
                          onChange={(e) => handlePositionChange(clip.id, e.target.value)}
                        />
                        <div className="snap-buttons">
                          <button
                            className="snap-button"
                            onClick={() => onSnapLeft && onSnapLeft(clip.id)}
                            title="Snap to previous clip end"
                          >
                            ← Snap
                          </button>
                          <button
                            className="snap-button"
                            onClick={() => onSnapRight && onSnapRight(clip.id)}
                            title="Snap to next clip start"
                          >
                            Snap →
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="detail-row">
                      <label>Trim Start (s):</label>
                      <input
                        type="number"
                        min="0"
                        max={clip.duration}
                        step="0.1"
                        value={trimStart.toFixed(1)}
                        onChange={(e) => handleTrimStartChange(clip.id, e.target.value)}
                      />
                    </div>
                    <div className="detail-row">
                      <label>Trim End (s):</label>
                      <input
                        type="number"
                        min="0"
                        max={clip.duration}
                        step="0.1"
                        value={trimEnd.toFixed(1)}
                        onChange={(e) => handleTrimEndChange(clip.id, e.target.value)}
                      />
                    </div>
                    <div className="detail-row info">
                      <label>Trimmed Duration:</label>
                      <span>{formatTime(clipDuration)}</span>
                    </div>
                    <div className="detail-row info">
                      <label>Source Duration:</label>
                      <span>{formatTime(clip.duration)}</span>
                    </div>
                    <div className="detail-actions">
                      <button
                        className="remove-button"
                        onClick={() => {
                          if (onClipRemove) {
                            onClipRemove(clip.id);
                            setExpandedClipId(null);
                          }
                        }}
                      >
                        Remove Clip
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default TimelineClipsPanel;
