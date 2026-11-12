import { forwardRef, useImperativeHandle, useRef } from 'react';
import { headPoseFromMatrix } from '../core/faceTracker.js';

/**
 * Control panel, laid out like the original X-Ray Mirror.
 * Live numbers are written straight into the DOM through refs (ref.update(info) every frame),
 * so they never cause React re-renders.
 */

/** Labelled range slider. `format` turns the value into the text shown on the right. */
function Slider({ label, value, min, max, step, format, onChange }) {
  return (
    <>
      <div className="row slider-row">
        <span>{label}</span>
        <b>{format(value)}</b>
      </div>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </>
  );
}

const pct = (v) => `${Math.round(v * 100)}%`;
const cm = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} cm`;
const signed = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;

// Layer presets, like the original's Skull / Brain / Muscles / Everything buttons.
const PRESETS = {
  Skull: { skull: true, brain: false, eyes: true, muscles: false, outline: true },
  Brain: { skull: false, brain: true, eyes: false, muscles: false, outline: true },
  Muscles: { skull: true, brain: false, eyes: true, muscles: true, outline: true },
  Everything: { skull: true, brain: true, eyes: true, muscles: true, outline: true, hands: true, body: true },
};

const REVEALS = [
  ['mirror', 'X-ray mirror (move it around)'],
  ['head', 'Whole head'],
  ['left', 'Left half only'],
  ['right', 'Right half only'],
  ['top', 'Top of the head only'],
  ['lower', 'Lower face only'],
  ['lens', 'X-ray lens (follows your fingertip)'],
];

const TrackingPanel = forwardRef(function TrackingPanel(
  { options, onOptionsChange, anatomyState, handsState, bodyState, onAutoFit, autoFitStatus, onResetFit },
  ref
) {
  const set = (key, value) => onOptionsChange({ ...options, [key]: value });
  const toggle = (key) => set(key, !options[key]);

  const el = { jawUsed: useRef(null), jawUsedBar: useRef(null), data: useRef(null) };
  const lastText = useRef(0);

  useImperativeHandle(ref, () => ({
    /**
     * info: { res, jawUsed, frameMs, fps, handInfo, sides, fingertip, layers, delegate }
     */
    update(info) {
      const { res, jawUsed = 0 } = info;
      if (el.jawUsed.current) el.jawUsed.current.textContent = `${Math.round(jawUsed * 100)}%`;
      if (el.jawUsedBar.current) el.jawUsedBar.current.style.width = `${jawUsed * 100}%`;

      // Tracking data box: refresh 4x a second so it's readable.
      const now = performance.now();
      if (!el.data.current || now - lastText.current < 250) return;
      lastText.current = now;
      const pad = (k) => k.padEnd(18, ' ');
      const lines = [];
      if (res?.found) {
        const pose = headPoseFromMatrix(res.matrix);
        lines.push(`${pad('face')}tracked, ${res.landmarks.length} points`);
        lines.push(`${pad('distance')}${Math.abs(pose.z).toFixed(0)} cm (estimate)`);
        lines.push(
          `${pad('turn / nod / tilt')}${pose.yaw.toFixed(0)}° / ${pose.pitch.toFixed(0)}° / ${pose.roll.toFixed(0)}°`
        );
        lines.push(`${pad('jaw open')}${(res.blendshapes.jawOpen ?? 0).toFixed(2)}`);
      } else {
        lines.push(`${pad('face')}not found`);
      }
      lines.push(
        `${pad('screen fit')}size ${pct(options.fitSize)}, shift ${options.fitX.toFixed(1)}, ${options.fitY.toFixed(1)} cm`
      );
      lines.push(`${pad('hands')}${info.handInfo ? info.sides.join(', ') || 'none' : 'off'}`);
      lines.push(`${pad('upper body')}${info.bodyInfo ? (info.bodyInfo.found ? 'tracked' : 'not found') : 'off'}`);
      if (info.fingertip) lines.push(`${pad('index fingertip')}${info.fingertip.map((v) => v.toFixed(2)).join(', ')}`);
      lines.push(`${pad('layers')}${info.layers.join(', ') || 'none'}`);
      lines.push(`${pad('speed')}${info.fps.toFixed(0)} frames/s`);
      lines.push(
        `${pad('frame time')}${info.frameMs.toFixed(1)} ms (face ${res?.ms?.toFixed(1) ?? '–'} ms${info.handInfo ? `, hands ${info.handInfo.ms.toFixed(1)} ms` : ''}${info.bodyInfo ? `, body ${info.bodyInfo.ms.toFixed(1)} ms` : ''})`
      );
      lines.push(`${pad('runs on')}${info.delegate || '–'}`);
      el.data.current.textContent = lines.join('\n');
    },
  }));

  const checks = (items) =>
    items.map(([key, label, color]) => (
      <label key={key} className="check">
        <input type="checkbox" checked={!!options[key]} onChange={() => toggle(key)} />
        {color && <i className="swatch" style={{ background: color }} />}
        {label}
      </label>
    ));

  const isCut = ['left', 'right', 'top', 'lower'].includes(options.reveal);

  return (
    <aside className="panel">
      <section>
        <h3>Layers</h3>
        <div className="presets">
          {Object.entries(PRESETS).map(([name, preset]) => (
            <button key={name} className="small" onClick={() => onOptionsChange({ ...options, ...preset })}>
              {name}
            </button>
          ))}
        </div>
        <div className="grid2">
          {checks([
            ['skull', 'Skull', '#e9e2d0'],
            ['brain', 'Brain', '#e8a3b5'],
            ['muscles', 'Muscles', '#e0605a'],
            ['eyes', 'Eyes', '#d9d27a'],
            ['outline', 'Head outline', '#7fa8ff'],
            ['hands', 'Hand bones', '#e6edf5'],
            ['body', 'Upper body', '#bfe3ff'],
          ])}
        </div>
        {checks([['showLabels', 'Show labels']])}
        {options.hands && (
          <Slider label="Finger bone thickness" value={options.fingerThickness} min={0.5} max={1.2} step={0.05} format={pct} onChange={(v) => set('fingerThickness', v)} />
        )}
        <div className="row"><span>Model</span><b>{anatomyState}</b></div>
        <div className="row"><span>Hand tracking</span><b>{handsState}</b></div>
        <div className="row"><span>Body tracking</span><b>{bodyState}</b></div>
      </section>

      <section>
        <h3>Look</h3>
        <div className="segmented">
          {[
            ['xray', 'X-ray'],
            ['solid', 'Solid'],
          ].map(([value, label]) => (
            <button key={value} className={options.look === value ? 'on' : ''} onClick={() => set('look', value)}>
              {label}
            </button>
          ))}
        </div>
        <Slider label="Brightness" value={options.brightness} min={0.3} max={2} step={0.05} format={pct} onChange={(v) => set('brightness', v)} />
      </section>

      <section>
        <h3>Mixed reality</h3>
        <Slider label="Real me showing through" value={options.realMe} min={0} max={0.9} step={0.05} format={pct} onChange={(v) => set('realMe', v)} />
        <Slider label="Edge feather" value={options.edgeFeather} min={0} max={0.45} step={0.01} format={pct} onChange={(v) => set('edgeFeather', v)} />
        {options.look === 'xray' && (
          <Slider label="Darken my face" value={options.dim} min={0} max={0.85} step={0.05} format={pct} onChange={(v) => set('dim', v)} />
        )}
        <div className="row slider-row">
          <span>Reveal</span>
          <select className="small-select" value={options.reveal} onChange={(e) => set('reveal', e.target.value)}>
            {REVEALS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        {isCut && (
          <Slider label="Cut position" value={options.cut} min={-1} max={1} step={0.02} format={(v) => signed(v)} onChange={(v) => set('cut', v)} />
        )}
        {options.reveal === 'mirror' && (
          <>
            <div className="segmented">
              {[
                ['circle', 'Circle'],
                ['pane', 'Glass pane'],
              ].map(([value, label]) => (
                <button key={value} className={options.mirrorShape === value ? 'on' : ''} onClick={() => set('mirrorShape', value)}>
                  {label}
                </button>
              ))}
            </div>
            <Slider label="Mirror size" value={options.mirrorSize} min={0.5} max={2} step={0.05} format={pct} onChange={(v) => set('mirrorSize', v)} />
            <div className="row slider-row">
              <span>Mirror follows</span>
              <select className="small-select" value={options.mirrorFollow} onChange={(e) => set('mirrorFollow', e.target.value)}>
                <option value="hand">My hand (palm)</option>
                <option value="drag">Mouse / finger drag</option>
              </select>
            </div>
            <p className="hint">
              {options.mirrorShape === 'circle'
                ? 'Hold up a hand: the circle follows your index fingertip. Everything inside it, your face and your hand, turns to x-ray.'
                : 'Hold up your hand below your chin: the glass sits above your fingertips, with a handle in your palm.'}{' '}
              Put your hand down and it stays there; drag it with the mouse anytime.
            </p>
          </>
        )}
        {options.reveal === 'lens' && (
          <>
            <Slider label="Lens size" value={options.lensSize} min={0.4} max={1.6} step={0.05} format={pct} onChange={(v) => set('lensSize', v)} />
            <p className="hint">Hold up a hand: the lens follows your index fingertip. With no hand, it stays on your face.</p>
          </>
        )}
      </section>

      <section>
        <h3>Jaw</h3>
        <div className="row"><span>Skull jaw opening</span><b ref={el.jawUsed}>0%</b></div>
        <div className="bar"><div ref={el.jawUsedBar} /></div>
        <Slider label="Sensitivity" value={options.jawGain} min={0.5} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set('jawGain', v)} />
        <Slider label="Max opening" value={options.jawMaxDeg} min={10} max={40} step={1} format={(v) => `${v}°`} onChange={(v) => set('jawMaxDeg', v)} />
        <Slider label="Manual test (0 = follow me)" value={options.jawTest} min={0} max={1} step={0.05} format={pct} onChange={(v) => set('jawTest', v)} />
      </section>

      <section>
        {checks([['showData', 'Show tracking data']])}
        {options.showData && <pre className="data" ref={el.data}>waiting for camera…</pre>}
      </section>

      <section>
        <h3>Fit to my head</h3>
        <div className="buttons">
          <button className="primary small" onClick={onAutoFit}>Auto-fit</button>
          <button className="small" onClick={onResetFit}>Reset fit</button>
        </div>
        {autoFitStatus && <p className="hint">{autoFitStatus}</p>}
        {[
          ['fitSize', 'Overall size', 0.7, 1.4, 0.01, pct],
          ['fitWidth', 'Width', 0.8, 1.25, 0.01, pct],
          ['fitHeight', 'Height', 0.8, 1.25, 0.01, pct],
          ['fitDepth', 'Depth', 0.8, 1.25, 0.01, pct],
          ['fitX', 'Left / right', -3, 3, 0.1, cm],
          ['fitY', 'Up / down', -3, 3, 0.1, cm],
          ['fitZ', 'Forward / back', -3, 3, 0.1, cm],
        ].map(([key, label, min, max, step, format]) => (
          <Slider key={key} label={label} value={options[key]} min={min} max={max} step={step} format={format} onChange={(v) => set(key, v)} />
        ))}
        <p className="hint">
          Tip: pick Solid, set "Real me showing through" to about 50%, look straight at the camera, press Auto-fit,
          then fine-tune with the sliders.
        </p>
      </section>

      <details className="debug">
        <summary>Debug</summary>
        <Slider label="Head smoothing" value={options.smoothing} min={0} max={0.9} step={0.05} format={pct} onChange={(v) => set('smoothing', v)} />
        {checks([
          ['faceMask', '3D face mask', '#ffb35c'],
          ['shell', 'Placeholder skull', '#8fc3e6'],
          ['axes', 'Axes + nose marker', '#ff5c7a'],
          ['mesh', '2D face mesh', '#8fc3e6'],
          ['features', '2D outline, eyes, lips'],
          ['points', 'All 478 points'],
          ['handPoints', 'Hand points', '#ffb35c'],
          ['swapHands', 'Swap left/right hand'],
        ])}
      </details>
    </aside>
  );
});

export default TrackingPanel;
