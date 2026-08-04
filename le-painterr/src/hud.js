import { lePainterrMarkUrl } from './textures.js';

export const PAINTS = [
  { name: 'Poppy', hex: '#d8452f' },
  { name: 'Ochre', hex: '#e2a13b' },
  { name: 'Sage', hex: '#7d9a6c' },
  { name: 'Harbour', hex: '#3f7fa6' },
  { name: 'Plum', hex: '#7a4a72' },
  { name: 'Chalk', hex: '#efe9dc' },
];

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Thin wrapper over the static markup in index.html. */
export class Hud {
  constructor(elements) {
    this.elements = elements;
    this.swatches = [];
    this.selectedPaint = 0;

    for (const mark of elements.brandMarks) mark.src = lePainterrMarkUrl;
  }

  buildPalette(onSelect) {
    const { palette } = this.elements;
    palette.replaceChildren();

    this.swatches = PAINTS.map((paint, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.style.setProperty('--paint', paint.hex);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(index === this.selectedPaint));
      button.setAttribute('aria-label', `${paint.name} (key ${index + 1})`);
      button.innerHTML = `<span class="swatch-chip" aria-hidden="true"></span><span class="swatch-name">${paint.name}</span>`;
      button.addEventListener('click', () => onSelect(index));
      palette.append(button);
      return button;
    });

    this.selectPaint(this.selectedPaint);
  }

  selectPaint(index) {
    this.selectedPaint = index;
    this.swatches.forEach((swatch, i) => {
      swatch.classList.toggle('is-selected', i === index);
      swatch.setAttribute('aria-checked', String(i === index));
    });
  }

  setLoadingStatus(text) {
    this.elements.loadingStatus.textContent = text;
  }

  setRendererLabel(label) {
    this.elements.rendererBadge.textContent = label;
  }

  setCoverage(fraction) {
    const percent = Math.min(100, Math.floor(fraction * 100));
    this.elements.coverage.textContent = `${percent}%`;
    this.elements.coverageFill.style.width = `${Math.min(100, fraction * 100)}%`;
  }

  setTime(seconds) {
    this.elements.timer.textContent = formatTime(seconds);
  }

  showScreen(name) {
    this.elements.loading.hidden = name !== 'loading';
    this.elements.mainMenu.hidden = name !== 'menu';
    this.elements.finished.hidden = name !== 'finished';
    this.elements.hud.hidden = name !== 'playing' && name !== 'finished';
  }

  showFinished(fraction, seconds) {
    this.elements.finishedCoverage.textContent = `${Math.min(100, Math.floor(fraction * 100))}%`;
    this.elements.finishedTime.textContent = formatTime(seconds);
    this.showScreen('finished');
  }
}
