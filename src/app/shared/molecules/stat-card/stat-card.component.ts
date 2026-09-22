import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Direction of the trend indicator. */
export type StatTrend = 'up' | 'down' | 'flat';

/**
 * Dashboard KPI tile: a primary figure, optional context line, trend indicator
 * and an SVG progress ring for ratio-style metrics (check-in rate, capacity).
 */
@Component({
  selector: 'app-stat-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="stat-card" [class.has-ring]="showProgress()">
      <div class="stat-info">
        <span class="stat-label">{{ label() }}</span>
        <div class="stat-value" [class.compact]="compact()">{{ value() }}</div>

        @if (subtext() !== null) {
          <span class="stat-subtext" [class]="'trend-' + trend()">
            @if (trend() !== 'flat') {
              <span class="trend-arrow" aria-hidden="true">{{ trend() === 'up' ? '▲' : '▼' }}</span>
            }
            {{ subtext() }}
          </span>
        }
      </div>

      @if (showProgress()) {
        <div class="stat-ring-box">
          <svg viewBox="0 0 36 36" class="circular-chart" aria-hidden="true">
            <path
              class="circle-bg"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path
              class="circle-fill"
              [attr.stroke-dasharray]="strokeDasharray()"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
          <span class="percentage-label">{{ percentageLabel() }}</span>
        </div>
      }
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .stat-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
        padding: 16px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
      }

      .stat-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .stat-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
        color: var(--color-slate-500);
        text-transform: uppercase;
      }

      .stat-value {
        margin: 4px 0 2px 0;
        font-size: 24px;
        font-weight: 900;
        line-height: 1.2;
        color: var(--color-ink);
        word-break: break-word;
      }

      .stat-value.compact {
        font-size: 20px;
      }

      .stat-subtext {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-slate-500);
      }

      .stat-subtext.trend-up {
        color: var(--color-emerald-deep);
      }

      .stat-subtext.trend-down {
        color: var(--color-danger);
      }

      .trend-arrow {
        font-size: 9px;
      }

      .stat-ring-box {
        position: relative;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 52px;
        height: 52px;
      }

      .circular-chart {
        display: block;
        width: 100%;
        height: 100%;
      }

      .circle-bg {
        fill: none;
        stroke: #f1f5f9;
        stroke-width: 3.8;
      }

      .circle-fill {
        fill: none;
        stroke: var(--color-coral);
        stroke-width: 3.8;
        stroke-linecap: round;
        transition: stroke-dasharray var(--transition-base);
      }

      .percentage-label {
        position: absolute;
        font-size: 10px;
        font-weight: 800;
        color: var(--color-slate-700);
      }
    `
  ]
})
export class StatCardComponent {
  /** Metric name, e.g. `CHECK-IN RATE`. */
  public readonly label = input.required<string>();

  /** Pre-formatted metric figure (formatting is the caller's responsibility). */
  public readonly value = input.required<string>();

  /** Optional context line, e.g. `+12 since 09:00`. */
  public readonly subtext = input<string | null>(null);

  /** Trend direction applied to the context line. */
  public readonly trend = input<StatTrend>('flat');

  /** Renders the circular progress ring. */
  public readonly showProgress = input<boolean>(false);

  /** Ring fill, 0-100. */
  public readonly percentage = input<number>(0);

  /** Slightly smaller figure, used in dense 3-up rails. */
  public readonly compact = input<boolean>(false);

  /** Clamped ring fill as an SVG dash array (the ring circumference is 100). */
  public readonly strokeDasharray = computed(() => {
    const clamped = Math.max(0, Math.min(100, this.percentage()));
    return `${clamped}, 100`;
  });

  /** Rounded percentage shown inside the ring. */
  public readonly percentageLabel = computed(() =>
    `${Math.round(Math.max(0, Math.min(100, this.percentage())))}%`
  );
}
