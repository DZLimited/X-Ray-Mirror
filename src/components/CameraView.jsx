import { useEffect, useRef, useState } from 'react';
import { startCamera, stopCamera, listCameras, onVideoFrames } from '../core/camera.js';

/**
 * Shows the mirrored webcam and runs the per-frame loop.
 *
 * Props:
 *  - onFrame(now, video): called once per camera frame (tracking + drawing go here)
 *  - onStop(): camera stopped
 *  - children: layers drawn on top of the video (canvas, later the three.js view)
 *  - blocked / blockedText: disable the Start button (e.g. while the model loads)
 *
 * Per-frame data (fps) is written straight to the DOM via a ref, not React state.
 */
export default function CameraView({ onFrame, onStop, children, blocked = false, blockedText = '' }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const stopLoopRef = useRef(null);
  const fpsRef = useRef(null);

  // Always call the latest onFrame without restarting the loop.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const [status, setStatus] = useState('idle'); // idle | starting | running | error
  const [error, setError] = useState('');
  const [cameras, setCameras] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [resolution, setResolution] = useState('');

  async function start(id = deviceId) {
    stop();
    setStatus('starting');
    setError('');
    try {
      const video = videoRef.current;
      streamRef.current = await startCamera(video, { deviceId: id || undefined });
      setResolution(`${video.videoWidth} × ${video.videoHeight}`);
      setCameras(await listCameras());
      const track = streamRef.current.getVideoTracks()[0];
      setDeviceId(track.getSettings().deviceId || id);

      let frames = 0;
      let last = performance.now();
      stopLoopRef.current = onVideoFrames(video, (now) => {
        frames++;
        if (now - last >= 500) {
          if (fpsRef.current) fpsRef.current.textContent = `${Math.round((frames * 1000) / (now - last))} fps`;
          frames = 0;
          last = now;
        }
        onFrameRef.current?.(now, video);
      });

      setStatus('running');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }

  function stop() {
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    stopCamera(streamRef.current, videoRef.current);
    streamRef.current = null;
    setStatus('idle');
    onStop?.();
  }

  useEffect(() => stop, []);

  return (
    <div className="camera">
      <div className="stage">
        <video ref={videoRef} className="video mirrored" playsInline muted />

        {/* Overlay layers share the video's size and mirroring. */}
        {status === 'running' && children}

        {status !== 'running' && (
          <div className="overlay">
            {status === 'idle' && (
              <>
                <h2>X-Ray Mirror</h2>
                <p>{blocked ? blockedText : 'Sit facing the camera with your whole face in view.'}</p>
                <button className="primary" disabled={blocked} onClick={() => start()}>
                  Start camera
                </button>
              </>
            )}
            {status === 'starting' && <p>Waiting for camera permission…</p>}
            {status === 'error' && (
              <>
                <p className="error">{error}</p>
                <button className="primary" onClick={() => start()}>Try again</button>
              </>
            )}
          </div>
        )}

        {status === 'running' && (
          <div className="hud">
            <span>{resolution}</span>
            <span ref={fpsRef}>– fps</span>
            <span className="note">Video stays on this device</span>
          </div>
        )}
      </div>

      {status === 'running' && (
        <div className="controls">
          {cameras.length > 1 && (
            <select
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value);
                start(e.target.value);
              }}
            >
              {cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>{c.label}</option>
              ))}
            </select>
          )}
          <button onClick={stop}>Stop camera</button>
        </div>
      )}
    </div>
  );
}
