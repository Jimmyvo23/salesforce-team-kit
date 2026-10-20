import { test, expect } from 'vitest';
import { layout, project, boxFaces, arcPath, pts, U, FLOOR_W } from '../dashboard/src/iso.ts';

const ids = (n) => Array.from({ length: n }, (_, i) => `m${i}`);

test('six members match the mockup: two rows, 400 x 330 scene', () => {
  const l = layout(ids(6));
  expect(l.rows).toBe(2);
  expect(l.depth).toBe(8);
  expect(l.origin.x).toBeCloseTo(182.4, 1);
  expect(l.origin.y).toBe(96);
  expect(l.width).toBe(400);
  expect(l.height).toBe(330);
  expect(l.desks.map((d) => [d.x, d.y])).toEqual([[1.6, 2], [3.8, 2], [6, 2], [1.6, 5], [3.8, 5], [6, 5]]);
  expect(l.approver).toMatchObject({ x0: 8.3, y0: 4.6, x1: 10.7, y1: 7.7, desk: { x: 9, y: 5.4 } });
});

test('three members: one row', () => {
  const l = layout(ids(3));
  expect(l.rows).toBe(1);
  expect(l.depth).toBe(5);
  expect(l.desks).toHaveLength(3);
  expect(l.approver.y0).toBeCloseTo(1.6);
});

test('nine members: three rows, desks keep team order three per row', () => {
  const l = layout(ids(9));
  expect(l.rows).toBe(3);
  expect(l.depth).toBe(11);
  expect(l.desks.map((d) => d.id)).toEqual(ids(9));
  expect(l.desks[3]).toMatchObject({ x: 1.6, y: 5 });
  expect(l.desks[8]).toMatchObject({ x: 6, y: 8 });
});

test('zero members still gives a room with the approver office', () => {
  const l = layout([]);
  expect(l.rows).toBe(1);
  expect(l.desks).toEqual([]);
});

test.each([1, 3, 4, 6, 7, 9, 12])('every corner of the floor is inside the viewBox for %i members', (n) => {
  const l = layout(ids(n));
  for (const [x, y] of [[0, 0], [FLOOR_W, 0], [0, l.depth], [FLOOR_W, l.depth]]) {
    const [sx, sy] = project(l, x, y);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sx).toBeLessThanOrEqual(l.width);
    expect(sy).toBeGreaterThanOrEqual(0);
    expect(sy).toBeLessThanOrEqual(l.height);
  }
});

test('desks never overlap the approver office', () => {
  for (const n of [3, 6, 9]) {
    const l = layout(ids(n));
    for (const d of l.desks) expect(d.x + 1.5).toBeLessThan(l.approver.x0);
  }
});

test('project: x goes right-down, y goes left-down, z goes up', () => {
  const l = layout(ids(6));
  const [ox, oy] = project(l, 0, 0);
  expect([ox, oy]).toEqual([l.origin.x, l.origin.y]);
  const [x1, y1] = project(l, 1, 0);
  expect(x1 - ox).toBeCloseTo(U * 0.866);
  expect(y1 - oy).toBeCloseTo(U * 0.5);
  expect(project(l, 0, 0, 1)[1]).toBeCloseTo(oy - U);
});

test('boxFaces gives three 4-point polygons', () => {
  const f = boxFaces(layout(ids(6)), 1, 1, 0, 1, 1, 1);
  for (const face of [f.top, f.left, f.right]) expect(face.split(' ')).toHaveLength(4);
});

test('pts joins points for a polygon', () => {
  expect(pts([[1, 2], [3.5, 4]])).toBe('1,2 3.5,4');
});

test('arcPath lifts the control point above both ends', () => {
  expect(arcPath([0, 100], [100, 100], 60)).toBe('M0 100 Q50 40 100 100');
  expect(arcPath([0, 100], [100, 50])).toBe('M0 100 Q50 15 100 50');
});
