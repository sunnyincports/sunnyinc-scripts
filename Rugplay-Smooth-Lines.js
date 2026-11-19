// ==UserScript==
// @name         smooth the line things
// @namespace    Sunny inc.
// @version      1.0.0
// @description  Smooth the small price sparklines on Rugplay coin cards.
// @match        https://rugplay.com/*
// @match        https://www.rugplay.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const SPARKLINE_SELECTOR = 'svg[viewBox="0 0 100 32"]';
  const POINT_PATTERN = /([ML])\s*(-?(?:\d+\.?\d*|\.\d+))\s*,?\s*(-?(?:\d+\.?\d*|\.\d+))/g;

  function readPolyline(d) {
    if (!d || !/^\s*M/i.test(d) || /[CQSTAHVZ]/i.test(d.replace(/^[\sM]/i, ''))) {
      return null;
    }

    const points = [...d.matchAll(POINT_PATTERN)].map((match) => ({
      x: Number(match[2]),
      y: Number(match[3])
    }));

    if (points.length < 3 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      return null;
    }

    for (let i = 1; i < points.length; i += 1) {
      if (points[i].x <= points[i - 1].x) return null;
    }

    return points;
  }

  function endpointTangent(h0, h1, slope0, slope1) {
    let tangent = ((2 * h0 + h1) * slope0 - h0 * slope1) / (h0 + h1);

    if (Math.sign(tangent) !== Math.sign(slope0)) return 0;
    if (Math.sign(slope0) !== Math.sign(slope1) && Math.abs(tangent) > 3 * Math.abs(slope0)) {
      tangent = 3 * slope0;
    }
    return tangent;
  }

  // Shape-preserving cubic Hermite interpolation: it rounds turns without
  // overshooting the original price samples.
  function toSmoothPath(points) {
    const intervals = [];
    const slopes = [];

    for (let i = 0; i < points.length - 1; i += 1) {
      const dx = points[i + 1].x - points[i].x;
      intervals.push(dx);
      slopes.push((points[i + 1].y - points[i].y) / dx);
    }

    const tangents = new Array(points.length);
    if (points.length === 2) {
      tangents[0] = slopes[0];
      tangents[1] = slopes[0];
    } else {
      tangents[0] = endpointTangent(intervals[0], intervals[1], slopes[0], slopes[1]);
      tangents[tangents.length - 1] = endpointTangent(
        intervals[intervals.length - 1],
        intervals[intervals.length - 2],
        slopes[slopes.length - 1],
        slopes[slopes.length - 2]
      );

      for (let i = 1; i < points.length - 1; i += 1) {
        const previousSlope = slopes[i - 1];
        const nextSlope = slopes[i];

        if (previousSlope === 0 || nextSlope === 0 || Math.sign(previousSlope) !== Math.sign(nextSlope)) {
          tangents[i] = 0;
          continue;
        }

        const previousInterval = intervals[i - 1];
        const nextInterval = intervals[i];
        const weight1 = 2 * nextInterval + previousInterval;
        const weight2 = nextInterval + 2 * previousInterval;
        tangents[i] =
          (weight1 + weight2) / (weight1 / previousSlope + weight2 / nextSlope);
      }
    }

    const fmt = (value) => Number(value.toFixed(3)).toString();
    let d = `M${fmt(points[0].x)},${fmt(points[0].y)}`;

    for (let i = 0; i < points.length - 1; i += 1) {
      const start = points[i];
      const end = points[i + 1];
      const dx = intervals[i];
      const control1 = {
        x: start.x + dx / 3,
        y: start.y + (tangents[i] * dx) / 3
      };
      const control2 = {
        x: end.x - dx / 3,
        y: end.y - (tangents[i + 1] * dx) / 3
      };

      d += ` C${fmt(control1.x)},${fmt(control1.y)} ${fmt(control2.x)},${fmt(control2.y)} ${fmt(end.x)},${fmt(end.y)}`;
    }

    return d;
  }

  function smoothSparkline(svg) {
    const paths = [...svg.querySelectorAll('path')];
    const line = paths.find((path) => path.getAttribute('fill') === 'none');
    if (!line || /\bC\b/.test(line.getAttribute('d') || '')) return;

    const points = readPolyline(line.getAttribute('d'));
    if (!points) return;

    const smoothLine = toSmoothPath(points);
    line.setAttribute('d', smoothLine);
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-width', '2');

    const area = paths.find((path) => path !== line && path.getAttribute('fill') !== 'none');
    if (!area) return;

    const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (viewBox.length !== 4 || !Number.isFinite(viewBox[2]) || !Number.isFinite(viewBox[3])) return;

    const width = viewBox[2];
    const height = viewBox[3];
    const first = points[0];
    const last = points[points.length - 1];
    area.setAttribute('d', `${smoothLine} L${width},${height} L${first.x},${height} Z`);
  }

  function scan() {
    document.querySelectorAll(SPARKLINE_SELECTOR).forEach(smoothSparkline);
  }

  let scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scan();
    });
  }

  scan();
  new MutationObserver(queueScan).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['d']
  });
})();
