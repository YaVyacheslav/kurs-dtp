export function getConvexHull(points) {
    if (points.length < 3) return points;
    const sorted = [...points].sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);

    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

    const lower = [];
    for (let i = 0; i < sorted.length; i++) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) lower.pop();
        lower.push(sorted[i]);
    }

    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) upper.pop();
        upper.push(sorted[i]);
    }

    upper.pop(); lower.pop();
    return lower.concat(upper);
}

export function runKMeans(points, k) {
    if (points.length === 0) return [];
    if (points.length <= k) {
        return points.map((_, i) => i);
    }

    let centers = [];
    const usedIndices = new Set();
    let safeK = Math.min(k, points.length);

    while (centers.length < safeK) {
        const idx = Math.floor(Math.random() * points.length);
        if (!usedIndices.has(idx)) {
            usedIndices.add(idx);
            centers.push([points[idx].lat, points[idx].lon]);
        }
    }

    let labels = new Array(points.length).fill(0);

    const maxIter = 70;

    for (let iter = 0; iter < maxIter; iter++) {
        let changed = false;
        const sums = Array(safeK).fill(0).map(() => [0, 0]);
        const counts = Array(safeK).fill(0);

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            let minDist = Infinity;
            let bestC = 0;

            for (let j = 0; j < safeK; j++) {
                const d0 = p.lat - centers[j][0];
                const d1 = p.lon - centers[j][1];
                const dist = d0 * d0 + d1 * d1;

                if (dist < minDist) {
                    minDist = dist;
                    bestC = j;
                }
            }

            if (labels[i] !== bestC) {
                labels[i] = bestC;
                changed = true;
            }

            sums[bestC][0] += p.lat;
            sums[bestC][1] += p.lon;
            counts[bestC]++;
        }

        if (!changed) break;

        for (let j = 0; j < safeK; j++) {
            if (counts[j] > 0) {
                centers[j][0] = sums[j][0] / counts[j];
                centers[j][1] = sums[j][1] / counts[j];
            }
        }
    }

    return labels;
}