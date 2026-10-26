// Left-hand palette in the 3D views: the finish (quick picks), a colour coat
// over it (PVD / Iridescent / Heat tint squares, each with its own presets),
// a pressed pattern, the welds, and the analysis looks. Settings open in a
// flyout beside the palette.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { useApp } from '../state/store';
import { BEETLE_PRESETS, CANDY_PRESETS, COATS, FINISH_LOOKS, LOOKS, POWDER_PRESETS, PVD_PRESETS, type Coat, type PowderTexture, type FinishOpts, type Look, type LookColors, type LookInfo } from '../viewer/materials';
import { PATTERNS, type PatternId } from '../viewer/patterns';
import { finishPreview } from '../viewer/finishPreview';
import { ColorPicker } from './ColorPicker';
import { Segmented, SliderField, Toggle } from './controls';
import { useFitColumn } from './fitColumn';

/** Looks shown as a rendered ball: the finishes, Zebra and Mesh. */
const BALLS: Look[] = [...FINISH_LOOKS, 'zebra', 'mesh'];

type Flyout = 'brushed' | Coat | 'pattern';
const FLYOUT_TITLES: Record<Flyout, string> = {
  brushed: 'Brushed grain',
  pvd: 'PVD colour & variation',
  iridescent: 'Iridescent two-tone',
  heat: 'Heat-tint pattern',
  powder: 'Powder coat',
  candy: 'Candy colour',
  pattern: 'Pressed pattern',
};

/** Contact view, beside the Plates eye above the 3D view; only there while
 *  the piece has plates (Guy). Clicking it again goes back to the finish
 *  you had. */
let beforeContact: Look = 'polished';
export function ContactButton({ plates }: { plates: boolean }) {
  const look = useApp((s) => s.look);
  const setLook = useApp((s) => s.setLook);
  const on = look === 'contact';
  useEffect(() => {
    if (!plates && on) setLook(beforeContact);
  }, [plates, on, setLook]);
  if (!plates) return null;
  return (
    <button
      className={`icon-btn${on ? ' on' : ''}`}
      onClick={() => {
        if (on) setLook(beforeContact);
        else {
          beforeContact = look;
          setLook('contact');
        }
      }}
      title={on ? 'Hide plate contact (back to your finish)' : 'Show plate contact: where the sheet touches the plates'}
      data-testid="contact-view"
    >
      {/* An eye like Plates beside it: a view switched on and off (Guy). */}
      {on ? <Eye size={14} /> : <EyeOff size={14} />}
      <span className="icon-btn-label">Plate contact</span>
    </button>
  );
}

export function LookPalette() {
  const fitRef = useFitColumn<HTMLElement>();
  const look = useApp((s) => s.look);
  const pvdColor = useApp((s) => s.pvdColor);
  const beetleFace = useApp((s) => s.beetleFace);
  const beetleEdge = useApp((s) => s.beetleEdge);
  const showWelds = useApp((s) => s.showWelds);
  const fo = useApp((s) => s.finishOpts);
  const { setLook, setPvdColor, setBeetle, setShowWelds, setFinishOpts } = useApp.getState();
  const isFinish = FINISH_LOOKS.includes(look);
  const [flyout, setFlyout] = useState<Flyout | null>(null);
  const [tone, setTone] = useState<'face' | 'edge'>('face');
  const [top, setTop] = useState(80);
  const btns = useRef<Record<string, HTMLButtonElement | null>>({});
  const fly = useRef<HTMLDivElement>(null);
  // The finish to go back to when a coat or pattern is picked on an analysis look.
  const lastFinish = useRef<Look>('polished');
  if (isFinish) lastFinish.current = look;
  const colors: LookColors = { pvd: pvdColor, beetleFace, beetleEdge };

  // A flyout stays only while what it sets is in use.
  const open = flyout === 'brushed' ? (look === 'brushed' ? flyout : null) : flyout === 'pattern' ? flyout : flyout && fo.coat === flyout ? flyout : null;
  useLayoutEffect(() => {
    if (flyout && !open) setFlyout(null);
  }, [flyout, open]);
  // Beside its button, but never off the bottom of the window (the pattern
  // flyout grows when a pattern is picked).
  useLayoutEffect(() => {
    const b = open && btns.current[open];
    const h = fly.current?.offsetHeight ?? 440;
    if (b) setTop(Math.max(56, Math.min(b.getBoundingClientRect().top - 8, window.innerHeight - h - 12)));
  }, [open, fo.pattern, fo.patternTops]);
  const toFinish = () => {
    if (!isFinish) setLook(lastFinish.current);
  };

  const item = (l: LookInfo) => (
    <button
      key={l.value}
      ref={(el) => {
        btns.current[l.value] = el;
      }}
      className={`look${look === l.value ? ' on' : ''}`}
      onClick={() => {
        if (l.value === 'brushed') setFlyout(look === 'brushed' && flyout === 'brushed' ? null : 'brushed');
        setLook(l.value);
      }}
      title={l.title + (l.value === 'brushed' ? ' — click again for its settings' : '')}
      data-testid={`look-${l.value}`}
    >
      {BALLS.includes(l.value) ? (
        // The finish balls wear the coat you've picked.
        <FinishBall look={l.value} colors={colors} opts={{ ...fo, pattern: null }} fallback={l.swatch} />
      ) : (
        <span className="look-swatch" style={{ background: l.swatch }} />
      )}
      <span className="look-label">{l.label}</span>
    </button>
  );

  const coatSwatch = (c: Coat) =>
    c === 'pvd'
      ? `linear-gradient(135deg, #fff8 0%, ${pvdColor} 35%, ${pvdColor} 70%, #0006 100%)`
      : c === 'iridescent'
        ? `linear-gradient(135deg, ${beetleFace} 20%, ${beetleEdge} 85%)`
        : c === 'powder'
          ? `linear-gradient(135deg, ${fo.powderColor} 55%, #0004 140%), ${fo.powderColor}`
          : c === 'candy'
            ? `radial-gradient(circle at 32% 28%, #fffb 0%, ${fo.candyColor} 30%, #000 115%)`
            : 'linear-gradient(135deg, #d9c27f, #c08a4b 35%, #7a4f8f 65%, #3f6fb0)';
  const coatName = fo.coat ? COATS.find((c) => c.value === fo.coat)!.label : 'Silver';
  const pattern = PATTERNS.find((p) => p.id === fo.pattern) ?? null;
  const pickPattern = (id: PatternId | null) => {
    const p = PATTERNS.find((x) => x.id === id);
    // Each pattern starts at its own catalogue size.
    setFinishOpts(p ? { pattern: p.id, patternSize: p.size } : { pattern: null });
    if (p) toFinish();
  };

  return (
    <nav className="look-palette" aria-label="Materials" ref={fitRef}>
      <div className="look-col">
      <h3>Finish</h3>
      {LOOKS.filter((l) => l.group === 'finish').map(item)}
      <h3>Colour</h3>
      <div className="coat-row">
        {/* Silver: bare stainless, no colour — one click back from any colour. */}
        <button
          className={`coat-sq silver${!fo.coat ? ' on' : ''}`}
          title="Silver — bare stainless, no colour"
          onClick={() => {
            setFinishOpts({ coat: null });
            setFlyout(null);
            toFinish();
          }}
          data-testid="coat-none"
        />
        {COATS.map((c) => (
          <button
            key={c.value}
            ref={(el) => {
              btns.current[c.value] = el;
            }}
            className={`coat-sq${fo.coat === c.value ? ' on' : ''}`}
            style={{ background: coatSwatch(c.value) }}
            title={`${c.title}${fo.coat === c.value ? ' — click for its settings' : ''}`}
            onClick={() => {
              if (fo.coat === c.value) setFlyout(flyout === c.value ? null : c.value);
              else {
                setFinishOpts({ coat: c.value });
                toFinish();
                setFlyout(c.value);
              }
            }}
            data-testid={`coat-${c.value}`}
          />
        ))}
      </div>
      <span className="look-label coat-name">{coatName}</span>
      </div>
      <div className="look-col look-more">
      <h3>Pattern</h3>
      <button
        ref={(el) => {
          btns.current.pattern = el;
        }}
        className={`look${pattern && isFinish ? ' on' : ''}`}
        onClick={() => setFlyout(flyout === 'pattern' ? null : 'pattern')}
        title="Pressed (embossed) sheet pattern — click to choose; purely visual"
        data-testid="pattern"
      >
        <FinishBall look={isFinish ? look : lastFinish.current} colors={colors} opts={fo} fallback={LOOKS[0].swatch} />
        <span className="look-label">{pattern ? pattern.name : 'None'}</span>
      </button>
      <h3>Weld</h3>
      <button
        className={`look toggle${showWelds ? ' on' : ''}`}
        disabled={!isFinish}
        onClick={() => setShowWelds(!showWelds)}
        title={
          !isFinish
            ? 'Welds show on the finishes above'
            : fo.coat === 'powder' || fo.coat === 'candy'
              ? 'TIG welds round the edges and holes, painted over: the bead shows as a ridge in the same colour.'
              : fo.coat
              ? 'TIG welds round the edges and holes: the welding burnt the coating off — a bare polished stainless seam. Internal laser welds stay clean.'
              : 'TIG welds round the edges and holes, before passivating: the weld bead with its heat-tint rainbow. Internal laser welds stay clean.'
        }
        data-testid="show-welds"
      >
        <span
          className="look-swatch weld-swatch"
          style={{
            backgroundImage:
              fo.coat === 'powder' || fo.coat === 'candy'
                ? weldSwatch(fo.coat === 'powder' ? fo.powderColor : fo.candyColor, true)
                : weldSwatch(fo.coat ? (fo.coat === 'pvd' ? pvdColor : fo.coat === 'iridescent' ? beetleFace : '#c4a27a') : null),
          }}
        />
        <span className="look-label">{showWelds ? 'Welds on' : 'Welds off'}</span>
      </button>
      <h3>Analyse</h3>
      {/* Contact lives beside the Plates eye instead (Guy). */}
      {LOOKS.filter((l) => l.group === 'analysis' && l.value !== 'contact').map(item)}
      </div>

      {open && (
        <div ref={fly} className={`look-flyout${open === 'pattern' ? ' wide' : ''}`} style={{ top }} data-testid="look-flyout">
          <div className="look-flyout-head">
            <span>{FLYOUT_TITLES[open]}</span>
            <button className="icon-btn" onClick={() => setFlyout(null)} title="Close">
              <X size={14} />
            </button>
          </div>
          {open === 'brushed' ? (
            <div className="finish-opts">
              <label>Direction</label>
              <SliderField value={fo.brushAngle} min={0} max={180} onChange={(v) => setFinishOpts({ brushAngle: v })} unit="°" left="Along X" right="Along Y → back" testId="brush-angle" />
              <label>Grain size</label>
              <SliderField
                value={fo.brushGrain}
                log
                min={0.05}
                max={2}
                onChange={(v) => setFinishOpts({ brushGrain: v })}
                unit="mm"
                digits={2}
                left="Fine"
                right="Coarse"
                testId="brush-grain"
              />
              <p className="muted small">The sheet is brushed flat, before welding — the grain follows the metal as it inflates.</p>
            </div>
          ) : open === 'pattern' ? (
            <>
              <div className="pattern-grid">
                <button className={`pattern-pick${!pattern ? ' on' : ''}`} onClick={() => pickPattern(null)} title="Plain sheet" data-testid="pattern-none">
                  <FinishBall look={lastFinish.current} colors={colors} opts={{ ...fo, pattern: null }} fallback={LOOKS[0].swatch} />
                  <span>None</span>
                </button>
                {PATTERNS.map((p) => (
                  <button key={p.id} className={`pattern-pick${fo.pattern === p.id ? ' on' : ''}`} onClick={() => pickPattern(p.id)} title={p.title} data-testid={`pattern-${p.id}`}>
                    <FinishBall
                      look={lastFinish.current}
                      colors={colors}
                      opts={{ ...fo, pattern: p.id, patternSize: fo.pattern === p.id ? fo.patternSize : p.size }}
                      fallback={LOOKS[0].swatch}
                    />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
              {pattern && (
                <div className="finish-opts">
                  <label>Size</label>
                  <SliderField value={fo.patternSize} log min={0.8} max={40} onChange={(v) => setFinishOpts({ patternSize: v })} unit="mm" digits={1} width={52} left="Fine" right="Coarse" testId="pattern-size" />
                  <label>Depth</label>
                  <SliderField value={fo.patternDepth * 100} onChange={(v) => setFinishOpts({ patternDepth: v / 100 })} left="Shallow" right="Deep" testId="pattern-depth" />
                  <label>Angle</label>
                  <SliderField value={fo.patternAngle} min={0} max={180} onChange={(v) => setFinishOpts({ patternAngle: v })} unit="°" testId="pattern-angle" />
                  <Toggle checked={fo.patternNegative} onChange={(b) => setFinishOpts({ patternNegative: b })} label="Pressed in (negative)" testId="pattern-negative" />
                  <Toggle checked={fo.patternTops} onChange={(b) => setFinishOpts({ patternTops: b })} label="Polished tops (two-tone)" testId="pattern-tops" />
                  {fo.patternTops && (
                    <>
                      <Toggle checked={fo.patternInvert} onChange={(b) => setFinishOpts({ patternInvert: b })} label="Invert two-tone (colour on top)" testId="pattern-invert" />
                      <label>Colour line</label>
                      <SliderField value={fo.patternLevel * 100} min={5} max={90} onChange={(v) => setFinishOpts({ patternLevel: v / 100 })} left="Whole bump" right="Just the tips" testId="pattern-level" />
                    </>
                  )}
                  <p className="muted small">Pressed into the flat sheet, so it stretches with the metal. Purely visual — the inflation is the same. Goes into the KeyShot export.</p>
                </div>
              )}
            </>
          ) : open === 'heat' ? (
            <div className="finish-opts">
              <label>Pattern size</label>
              <SliderField
                value={fo.heatSize}
                log
                min={40}
                max={1500}
                onChange={(v) => setFinishOpts({ heatSize: v })}
                unit="mm"
                width={52}
                left="Small"
                right="Large"
                testId="heat-size"
              />
              <label>Position across</label>
              <SliderField value={fo.heatX * 100} onChange={(v) => setFinishOpts({ heatX: v / 100 })} left="Left" right="Right" testId="heat-x" />
              <label>Position up</label>
              <SliderField value={fo.heatY * 100} onChange={(v) => setFinishOpts({ heatY: v / 100 })} left="Bottom" right="Top" testId="heat-y" />
              <label>Colour range</label>
              <SliderField value={fo.heatRange * 100} onChange={(v) => setFinishOpts({ heatRange: v / 100 })} left="Straw" right="To blue" testId="heat-range" />
            </div>
          ) : open === 'powder' ? (
            <>
              <ColorPicker value={fo.powderColor} onChange={(c) => setFinishOpts({ powderColor: c })} presets={POWDER_PRESETS} labelled />
              <div className="finish-opts">
                <label>Gloss</label>
                <SliderField value={fo.powderGloss * 100} onChange={(v) => setFinishOpts({ powderGloss: v / 100 })} left="Matt" right="High gloss" testId="powder-gloss" />
                <label>Texture</label>
                <Segmented<PowderTexture>
                  small
                  value={fo.powderTexture}
                  options={[
                    { value: 'smooth', label: 'Smooth' },
                    { value: 'fine', label: 'Fine', title: 'Fine (sandy) texture' },
                    { value: 'hammer', label: 'Hammertone', title: 'Beaten-metal dimples, metallic' },
                  ]}
                  onChange={(v) => setFinishOpts({ powderTexture: v })}
                />
                <Toggle checked={fo.powderMetallic} onChange={(b) => setFinishOpts({ powderMetallic: b })} label="Metallic" testId="powder-metallic" />
                <p className="muted small">Painted on after welding and inflating: hides the finish, covers the welds, fills fine patterns.</p>
              </div>
            </>
          ) : open === 'candy' ? (
            <>
              <ColorPicker value={fo.candyColor} onChange={(c) => setFinishOpts({ candyColor: c })} presets={CANDY_PRESETS} labelled />
              <div className="finish-opts">
                <label>Strength</label>
                <SliderField value={fo.candyDepth * 100} onChange={(v) => setFinishOpts({ candyDepth: v / 100 })} left="Light tint" right="Deep" testId="candy-depth" />
                <p className="muted small">Coloured glass over the metal: the finish shows through, the colour deepens towards the edges.</p>
              </div>
            </>
          ) : open === 'pvd' ? (
            <>
              <ColorPicker value={pvdColor} onChange={setPvdColor} presets={PVD_PRESETS} labelled metallic />
              <div className="finish-opts">
                <label>Variation</label>
                <SliderField value={fo.pvdAmount * 100} onChange={(v) => setFinishOpts({ pvdAmount: v / 100 })} left="Even" right="Strong" testId="pvd-amount" />
                <label>Variation size</label>
                <SliderField
                  value={fo.pvdSize}
                  log
                  min={40}
                  max={1500}
                  onChange={(v) => setFinishOpts({ pvdSize: v })}
                  unit="mm"
                  width={52}
                  left="Small"
                  right="Large"
                  testId="pvd-size"
                />
                <label>Position across</label>
                <SliderField value={fo.pvdX * 100} onChange={(v) => setFinishOpts({ pvdX: v / 100 })} left="Left" right="Right" testId="pvd-x" />
                <label>Position up</label>
                <SliderField value={fo.pvdY * 100} onChange={(v) => setFinishOpts({ pvdY: v / 100 })} left="Bottom" right="Top" testId="pvd-y" />
              </div>
            </>
          ) : (
            <>
              <div className="tone-tabs">
                <button className={tone === 'face' ? 'on' : ''} onClick={() => setTone('face')} title="The colour where you look straight at the surface">
                  <span style={{ background: beetleFace }} /> Face-on
                </button>
                <button className={tone === 'edge' ? 'on' : ''} onClick={() => setTone('edge')} title="The colour where the surface turns away from you">
                  <span style={{ background: beetleEdge }} /> Glancing
                </button>
              </div>
              <ColorPicker
                value={tone === 'face' ? beetleFace : beetleEdge}
                onChange={(c) => (tone === 'face' ? setBeetle(c, beetleEdge) : setBeetle(beetleFace, c))}
              />
              <div className="tone-presets">
                {BEETLE_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    className={p.face === beetleFace && p.edge === beetleEdge ? 'on' : ''}
                    style={{ background: `linear-gradient(135deg, ${p.face} 45%, ${p.edge} 55%)` }}
                    title={p.name}
                    onClick={() => setBeetle(p.face, p.edge)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </nav>
  );
}

/** A rendered ball in this look (the CSS swatch until it's ready). */
function FinishBall({ look, colors, opts, fallback }: { look: Look; colors: LookColors; opts: FinishOpts; fallback: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    finishPreview(look, colors, opts)
      .then((u) => live && setSrc(u))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    look,
    colors.pvd,
    colors.beetleFace,
    colors.beetleEdge,
    opts.coat,
    opts.pvdAmount,
    opts.brushAngle,
    opts.heatRange,
    opts.pattern,
    opts.patternSize,
    opts.patternDepth,
    opts.patternAngle,
    opts.patternTops,
    opts.patternInvert,
    opts.patternNegative,
    opts.patternLevel,
    opts.powderColor,
    opts.powderGloss,
    opts.powderTexture,
    opts.powderMetallic,
    opts.candyColor,
    opts.candyDepth,
  ]);
  return src ? <img className="look-swatch look-ball" src={src} alt="" /> : <span className="look-swatch" style={{ background: fallback }} />;
}

/** The Weld switch: a flat close-up of a TIG seam between two sheets, as in
 *  Guy's photos — a bronze-grey bead of stacked crescent ripples, a dark
 *  line, blue → magenta → gold, then straw fading into the steel. Through a
 *  coating (`coat`), the welding burns a bare silver seam instead. */
function weldSwatch(coat: string | null, painted = false): string {
  if (coat && painted) return paintedWeldSwatch(coat);
  const tint = coat
    ? [[0, coat], [0.24, coat], [0.34, '#e6e9ec'], [0.42, '#f1f2f4'], [0.58, '#f1f2f4'], [0.66, '#e6e9ec'], [0.76, coat], [1, coat]]
    : [[0, '#cfd3d8'], [0.1, '#d6c8a2'], [0.2, '#c49a68'], [0.27, '#dcaa55'], [0.31, '#a8558f'], [0.35, '#4d6fd2'], [0.385, '#33292f'],
       [0.615, '#33292f'], [0.65, '#4d6fd2'], [0.69, '#a8558f'], [0.73, '#dcaa55'], [0.8, '#c49a68'], [0.9, '#d6c8a2'], [1, '#cfd3d8']];
  const stops = (list: (string | number)[][]) => list.map(([o, c]) => `<stop offset='${o}' stop-color='${c}'/>`).join('');
  // Bead: domed across (dark edges, lit crown), ripples trailing back.
  const bead = coat ? [[0, '#c9cdd2'], [0.5, '#f4f5f7'], [1, '#c9cdd2']] : [[0, '#4a3f37'], [0.5, '#8b7864'], [1, '#4a3f37']];
  let ripples = '';
  for (let y = -3; y < 68; y += 2.4) {
    ripples += `<path d='M26.5 ${y} Q32 ${y + 3} 37.5 ${y}' fill='none' stroke='${coat ? '#ffffff' : '#c2ad8f'}' stroke-opacity='${coat ? 0.35 : 0.75}' stroke-width='0.8'/>`;
    ripples += `<path d='M26.5 ${y + 0.9} Q32 ${y + 3.9} 37.5 ${y + 0.9}' fill='none' stroke='#1e1814' stroke-opacity='${coat ? 0.12 : 0.45}' stroke-width='0.7'/>`;
  }
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
    `<defs><linearGradient id='t'>${stops(tint)}</linearGradient><linearGradient id='b'>${stops(bead)}</linearGradient>` +
    `<linearGradient id='s' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='0.35'/><stop offset='0.45' stop-color='#fff' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='0.3'/></linearGradient></defs>` +
    `<rect width='64' height='64' fill='url(#t)'/><rect x='26.5' width='11' height='64' fill='url(#b)'/>${ripples}` +
    `<rect width='64' height='64' fill='url(#s)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The Weld switch under powder coat or candy: the bead as a ridge under the
 *  paint, all one colour, its ripples softened. */
function paintedWeldSwatch(paint: string): string {
  let ripples = '';
  for (let y = -3; y < 68; y += 2.4) ripples += `<path d='M26.5 ${y} Q32 ${y + 3} 37.5 ${y}' fill='none' stroke='#fff' stroke-opacity='0.12' stroke-width='0.8'/>`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
    `<defs><linearGradient id='b'><stop offset='0' stop-color='#000' stop-opacity='0.35'/><stop offset='0.5' stop-color='#fff' stop-opacity='0.3'/><stop offset='1' stop-color='#000' stop-opacity='0.35'/></linearGradient>` +
    `<linearGradient id='s' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='0.3'/><stop offset='0.45' stop-color='#fff' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='0.3'/></linearGradient></defs>` +
    `<rect width='64' height='64' fill='${paint}'/><rect x='26.5' width='11' height='64' fill='url(#b)'/>${ripples}` +
    `<rect width='64' height='64' fill='url(#s)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
