const { Component } = require('hypermorphic');
const throttle = require('lodash/throttle');
const getFileAudioBuffer = require('../helpers/getFileAudioBuffer');
const formatTime = require('../helpers/formatTime');

const SPACING = 20;
const CONTAINER_HEIGHT = 240;
const CONTAINER_WIDTH = 835;
const HEIGHT = CONTAINER_HEIGHT - SPACING * 2;
const WIDTH = CONTAINER_WIDTH - SPACING * 2;
const BAR_WIDTH = 4;
const BAR_COLOR = '#166a77';
const BAR_HANDLE_RADIUS = 8;
const BAR_CENTER = (BAR_WIDTH - 1) / 2;
const BAR_GAP = false;
const FONT_FAMILY = 'monospace';
const FONT_SIZE = 10;
const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`;
const TIME_ANNOTATION_WIDTH = 40;
const SLICE_COLOR = '#37f0c2';
const DURATION_COLOR = '#f4ffdc';
const PROGRESS_COLOR = '#24adc2';

class WaveForm extends Component {
  constructor(audio, file, setSliceBoundary, resetSlice) {
    super();
    this.audio = audio;
    this.file = file;
    this.setSliceBoundary = setSliceBoundary;
    this.resetSlice = resetSlice;

    this.pixelRatio =
      // FIXME: Force pixelRatio=1 otherwise devices > 1 only draw half
      1 || window.devicePixelRatio || screen.deviceXDPI / screen.logicalXDPI;
    this.halfPixel = 0.5 / this.pixelRatio;

    this.createAudioCtx();
    // this.handleMouseMove = throttle(this.handleMouseMove.bind(this), 16, {
    //   leading: true,
    //   trailing: true,
    // });
    // this.handleClick = this.handleClick.bind(this);
    this.handleSourceTimeUpdate = this.handleSourceTimeUpdate.bind(this);
    this.resetBoundaries = this.resetBoundaries.bind(this);
    // this.handleMouseEnter = this.handleMouseEnter.bind(this);
    // this.handleMouseLeave = this.handleMouseLeave.bind(this);
  }

  createAudioCtx() {
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioCtx.createAnalyser();
  }

  setupCanvases() {
    this.container = document.getElementById('WaveForm');
    this.boundingClientRect = this.container.getBoundingClientRect();

    this.canvases = {};
    this.canvasContexts = {};
    this.snapshots = {};
    ['waveform', 'progress', 'duration', 'start', 'end'].forEach(canvas => {
      this.canvases[canvas] = document.getElementById(`${canvas}-canvas`);
      this.canvasContexts[canvas] = this.canvases[canvas].getContext('2d');
      this.canvasContexts[canvas].clearRect(0, 0, WIDTH, HEIGHT);
      this.canvasContexts[canvas].font = FONT;
      this.snapshots[canvas] = [];
    });
  }

  async onconnected() {
    this.audio.addEventListener('timeupdate', this.handleSourceTimeUpdate);
    this.setupCanvases();

    this.buffer = await getFileAudioBuffer(this.file, this.audioCtx);

    // const nominalWidth = Math.round(
    //   this.buffer.duration * MIN_PX_PER_SEC * this.pixelRatio
    // );

    const width = WIDTH;
    const start = 0;
    const end = WIDTH;

    const peaks = this.getPeaks(width, start, end);
    this.drawBars(peaks, 0, WIDTH);
  }

  getDuration() {
    return (this.buffer || this.audio).duration;
  }

  doSnapshot(canvas) {
    this.snapshots[canvas].push(
      this.canvasContexts[canvas].getImageData(0, 0, WIDTH, HEIGHT)
    );
  }

  restoreSnapshot(canvas) {
    this.canvasContexts[canvas].clearRect(0, 0, WIDTH, HEIGHT);
    const snapshot = this.snapshots[canvas][0];
    if (snapshot) {
      this.canvasContexts[canvas].putImageData(snapshot, 0, 0);
    }
  }

  ensureSnapshot(canvas) {
    if (this.snapshots[canvas].length) {
      this.restoreSnapshot(canvas);
    } else {
      this.doSnapshot(canvas);
    }
  }

  /**
   * Set the rendered length (different from the length of the audio).
   *
   * @param {number} length
   */
  setLength(length) {
    this.splitPeaks = [];
    this.mergedPeaks = [];
    // Set the last element of the sparse array so the peak arrays are
    // appropriately sized for other calculations.
    const channels = this.buffer.numberOfChannels;
    let c;
    for (c = 0; c < channels; c++) {
      this.splitPeaks[c] = [];
      this.splitPeaks[c][2 * (length - 1)] = 0;
      this.splitPeaks[c][2 * (length - 1) + 1] = 0;
    }
    this.mergedPeaks[2 * (length - 1)] = 0;
    this.mergedPeaks[2 * (length - 1) + 1] = 0;
  }

  /**
   * Compute the max and min value of the waveform when broken into <length> subranges.
   *
   * @param {number} length How many subranges to break the waveform into.
   * @param {number} first First sample in the required range.
   * @param {number} last Last sample in the required range.
   * @return {number[]|number[][]} Array of 2*<length> peaks or array of arrays of
   * peaks consisting of (max, min) values for each subrange.
   */
  getPeaks(length, first, last) {
    first = first || 0;
    last = last || length - 1;

    this.setLength(length);

    const sampleSize = this.buffer.length / length;
    const sampleStep = ~~(sampleSize / 10) || 1;
    const channels = this.buffer.numberOfChannels;
    let c;

    for (c = 0; c < channels; c++) {
      const peaks = this.splitPeaks[c];
      const chan = this.buffer.getChannelData(c);
      let i;

      for (i = first; i <= last; i++) {
        const start = ~~(i * sampleSize);
        const end = ~~(start + sampleSize);
        let min = 0;
        let max = 0;
        let j;

        for (j = start; j < end; j += sampleStep) {
          const value = chan[j];

          if (value > max) {
            max = value;
          }

          if (value < min) {
            min = value;
          }
        }

        peaks[2 * i] = max;
        peaks[2 * i + 1] = min;

        if (c == 0 || max > this.mergedPeaks[2 * i]) {
          this.mergedPeaks[2 * i] = max;
        }

        if (c == 0 || min < this.mergedPeaks[2 * i + 1]) {
          this.mergedPeaks[2 * i + 1] = min;
        }
      }
    }

    return this.mergedPeaks;
  }

  drawBars(peaks, start, end) {
    return this.prepareDraw(
      peaks,
      start,
      end,
      ({ hasMinVals, offsetY, halfH, peaks }) => {
        // Skip every other value if there are negatives.
        const peakIndexScale = hasMinVals ? 2 : 1;
        const length = peaks.length / peakIndexScale;
        const bar = BAR_WIDTH * this.pixelRatio;
        const gap = BAR_GAP ? Math.max(this.pixelRatio, ~~(bar / 2)) : 0;
        const step = bar + gap;

        const scale = length / WIDTH;
        const first = start;
        const last = end;
        let i;

        this.canvasContexts['waveform'].fillStyle = BAR_COLOR;
        for (i = first; i < last; i += step) {
          const peak = peaks[Math.floor(i * scale * peakIndexScale)] || 0;
          const h = Math.round((peak / 1) * halfH);
          this.canvasContexts['waveform'].fillRect(
            i + this.halfPixel,
            halfH - h + offsetY,
            bar + this.halfPixel,
            h * 2
          );
        }
        this.drawn = true;
        this.doSnapshot('waveform');
        this.setSliceBoundary('start', 0);
        this.setState(this.setSliceBoundary('end', this.getDuration()));
        this.drawBoundary(this.canvasContexts['start'], SPACING);
        this.drawBoundary(
          this.canvasContexts['end'],
          CONTAINER_WIDTH - SPACING
        );
      }
    );
  }

  prepareDraw(peaks, start, end, fn) {
    return requestAnimationFrame(() => {
      // Bar wave draws the bottom only as a reflection of the top,
      // so we don't need negative values
      const hasMinVals = peaks.some(val => val < 0);
      const height = HEIGHT - SPACING * 2 * this.pixelRatio;
      const offsetY = SPACING;
      const halfH = height / 2;

      return fn({
        hasMinVals: hasMinVals,
        height: height,
        offsetY: offsetY,
        halfH: halfH,
        peaks: peaks,
      });
    });
  }

  resetBoundaries() {
    this.setState(this.resetSlice());

    this.restoreSnapshot('start');
    this.restoreSnapshot('end');
  }

  handleMouseMove(evt) {
    const canvas = 'duration';
    const canvasCtx = this.canvasContexts[canvas];

    requestAnimationFrame(() => {
      this.ensureSnapshot(canvas);

      const x = evt.clientX - this.boundingClientRect.left - SPACING;
      canvasCtx.fillStyle = DURATION_COLOR;
      canvasCtx.fillRect(x, 0, BAR_WIDTH / 2, HEIGHT);

      const time = Math.max((this.getDuration() / WIDTH) * x, 0);
      const formattedTime = formatTime(time);
      const textSpacing = SPACING / 2;
      const textX =
        WIDTH - x < TIME_ANNOTATION_WIDTH + textSpacing
          ? x - TIME_ANNOTATION_WIDTH - textSpacing
          : x + textSpacing;
      const textY = FONT_SIZE;
      canvasCtx.fillText(formattedTime, textX, textY);
    });
  }

  handleMouseEnter() {
    this.container.addEventListener('mouseleave', this.handleMouseLeave);
  }

  handleMouseLeave() {
    this.container.removeEventListener('mouseleave', this.handleMouseLeave);
    requestAnimationFrame(() => {
      this.restoreSnapshot('duration');
    });
  }

  drawBoundary(canvasCtx, x) {
    canvasCtx.fillStyle = SLICE_COLOR;
    canvasCtx.fillRect(x, 0, BAR_WIDTH / 2, HEIGHT);
    canvasCtx.beginPath();
    canvasCtx.arc(
      x + BAR_CENTER,
      HEIGHT - BAR_HANDLE_RADIUS,
      BAR_HANDLE_RADIUS,
      0,
      2 * Math.PI
    );
    canvasCtx.fill();
    canvasCtx.beginPath();
    canvasCtx.arc(
      x + BAR_CENTER,
      BAR_HANDLE_RADIUS,
      BAR_HANDLE_RADIUS,
      0,
      2 * Math.PI
    );
    canvasCtx.fill();

    const time = Math.max((this.getDuration() / WIDTH) * (x - SPACING), 0);
    const formattedTime = formatTime(time);
    const textSpacing = BAR_HANDLE_RADIUS + SPACING / 2;
    const textX =
      WIDTH - x < TIME_ANNOTATION_WIDTH + textSpacing
        ? x - TIME_ANNOTATION_WIDTH - textSpacing
        : x + textSpacing;
    const textY = FONT_SIZE;
    canvasCtx.fillText(formattedTime, textX, textY);
  }

  handleBoundarySelection(evt) {
    if (!this.drawn || this.state.end) return;

    const canvas = this.state.start !== undefined ? 'end' : 'start';
    const canvasCtx = this.canvasContexts[canvas];

    requestAnimationFrame(() => {
      this.ensureSnapshot(canvas);
      const x = evt.clientX - this.boundingClientRect.left - BAR_CENTER;
      this.drawBoundary(canvasCtx, x);
    });
  }

  handleClick(evt) {
    const x = evt.clientX - this.boundingClientRect.left - SPACING;
    const parsed = Math.max(
      Number.parseFloat(((this.getDuration() / WIDTH) * x).toFixed(2), 0)
    );
    const current = Math.max(
      Number.parseFloat(this.audio.currentTime.toFixed(2)),
      0
    );
    if (parsed !== current) {
      this.audio.currentTime = parsed;
      this.audio.play();
      this.restoreSnapshot('duration');
    }
  }

  handleBoundaryClick(evt) {
    if (typeof this.setSliceBoundary !== 'function' || !this.drawn) {
      return;
    }

    if (this.state.end) {
      this.resetBoundaries();
      return;
    }

    const x = evt.clientX - this.boundingClientRect.left - BAR_CENTER;
    const time = (this.getDuration() / WIDTH) * x;

    if (this.state.start > time) {
      this.resetBoundaries();
      return;
    }

    const boundary = !this.state.start ? 'start' : 'end';
    const { start, end } = this.setSliceBoundary(boundary, time);

    this.doSnapshot(boundary);

    this.setState({
      start,
      end,
    });
  }

  handleSourceTimeUpdate() {
    if (!this.drawn) return;

    requestAnimationFrame(() => {
      this.ensureSnapshot('progress');

      const x = SPACING + (WIDTH / this.getDuration()) * this.audio.currentTime;
      this.canvasContexts['progress'].fillStyle = PROGRESS_COLOR;
      this.canvasContexts['progress'].fillRect(x, 0, BAR_WIDTH / 2, HEIGHT);

      const time = formatTime(this.audio.currentTime);
      const textX = WIDTH - x < 100 ? x - 55 : x + 10;
      const textY = FONT_SIZE;
      this.canvasContexts['progress'].fillText(time, textX, textY);
    });
  }

  render() {
    return this.html`
    <div
      onconnected=${this}
      onmousemove=${this.handleMouseMove}
      onmouseenter=${this.handleMouseEnter}
      onclick=${this.handleClick}
      class="${this.state.end ? 'will-reset' : 'can-select'}"
      style="${`width:${CONTAINER_WIDTH}px; height:${CONTAINER_HEIGHT}px;`}"
      id="WaveForm"
    >
      <canvas
        id="waveform-canvas"
        width="${WIDTH}"
        height="${HEIGHT}"
      >
      </canvas>
      <canvas
        id="progress-canvas"
        width="${CONTAINER_WIDTH}"
        height="${HEIGHT}"
      >
      </canvas>
      <canvas
        id="duration-canvas"
        width="${CONTAINER_WIDTH}"
        height="${HEIGHT}"
      >
      </canvas>
      <canvas
        id="start-canvas"
        width="${CONTAINER_WIDTH}"
        height="${HEIGHT}"
      >
      </canvas>
      <canvas
        id="end-canvas"
        width="${CONTAINER_WIDTH}"
        height="${HEIGHT}"
      >
      </canvas>
      <canvas
        id="end-canvas"
        width="${CONTAINER_WIDTH}"
        height="${HEIGHT}"
      >
      </canvas>
    </div>
    `;
  }
}

module.exports = WaveForm;
