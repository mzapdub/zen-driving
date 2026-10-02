"""
Gillender Building (New York, 1897) - modular kit + assembled building for Blender.

Everything is generated procedurally: a kit of snap-to-grid facade modules
(walls, corner piers, cornices, balustrades, window inserts, columns, awnings,
tower/cupola parts) and a building assembled purely from linked instances of
those modules. Edit a kit mesh and every instance in the building updates.

Grid
  bay width   2.6 m      corner pier  1.0 m      wall depth 0.4 m
  floor       3.6 m      ground floor 5.0 m
  module pivot: bottom-left of the bay, facade plane at local y = 0,
  facade faces local -Y, interior is +Y.

Usage (Blender 4.2+):
  blender -b -P gillender_modular.py -- --out ./out --render
  python gillender_modular.py --out ./out --render      (with the `bpy` wheel)
  Or paste into Blender's Text Editor and Run Script (builds the scene only).
"""
import argparse
import math
import os
import random
import sys
from math import cos, pi, radians, sin

import bpy  # noqa: I001  (bpy must be imported before bmesh when used as a module)
import bmesh
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------
# Grid
# --------------------------------------------------------------------------
# Real building: 26 x 73 ft lot (7.9 x 22.3 m), 20 storeys (17 main + 3 tower), 83 m.
BAY, P, T = 2.0, 0.9, 0.40
FL, GF = 3.35, 4.8
NX, NY = 3, 10                     # bays on the short (front) and long side
W, D = 2 * P + NX * BAY, 2 * P + NY * BAY
WIN = (0.45, 1.55, 0.80, 2.85)     # standard window opening (x0, x1, z0, z1)
SHOP = (0.25, 1.75, 0.50, 4.05)
ARCH = (0.40, 1.60, 0.80, 2 * FL - 1.25)   # x0, x1, sill, springing (r = 0.6)
DOOR = (0.25, 1.75, 0.0, 5.0)
CUPOLA = 0.8                       # scale of the tempietto / dome / lantern
COL_H = 6.6

MAT_NAMES = ["stone", "stone_trim", "granite", "glass", "frame", "iron",
             "copper", "awning", "roof", "void", "gilt", "room", "tile", "wood"]
MI = {n: i for i, n in enumerate(MAT_NAMES)}
MATS = {}

Z = Vector((0, 0, 1))


def TR(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def RZ(deg):
    return Matrix.Rotation(radians(deg), 4, "Z")


def RX(deg):
    return Matrix.Rotation(radians(deg), 4, "X")


def RY(deg):
    return Matrix.Rotation(radians(deg), 4, "Y")


# --------------------------------------------------------------------------
# Profile helpers  (u = projection out of the wall, v = up / away)
# --------------------------------------------------------------------------
def ovolo(u0, v0, u1, v1, n=6):
    return [(u0 + (u1 - u0) * sin(t), v0 + (v1 - v0) * (1 - cos(t)))
            for t in (pi / 2 * i / n for i in range(1, n + 1))]


def cavetto(u0, v0, u1, v1, n=6):
    return [(u0 + (u1 - u0) * (1 - cos(t)), v0 + (v1 - v0) * sin(t))
            for t in (pi / 2 * i / n for i in range(1, n + 1))]


def cyma(u0, v0, u1, v1, n=8):
    return [(u0 + (u1 - u0) * (0.5 - 0.5 * cos(pi * t)), v0 + (v1 - v0) * t)
            for t in (i / n for i in range(1, n + 1))]


def arc(cx, cz, r, a0, a1, n):
    return [(cx + r * cos(a0 + (a1 - a0) * i / n), cz + r * sin(a0 + (a1 - a0) * i / n))
            for i in range(n + 1)]


PROF_STRING = ([(-0.02, 0.0), (0.04, 0.0)] + ovolo(0.04, 0.0, 0.12, 0.08, 4)
               + [(0.12, 0.2), (0.15, 0.2)] + cyma(0.15, 0.2, 0.19, 0.3, 4)
               + [(0.19, 0.34), (-0.02, 0.34)])

PROF_BASE = ([(-0.02, 0.0), (0.05, 0.0), (0.05, 0.12), (0.09, 0.12)]
             + ovolo(0.09, 0.12, 0.2, 0.25) + cavetto(0.2, 0.25, 0.42, 0.36)
             + [(0.44, 0.36), (0.44, 0.56), (0.47, 0.56)] + cyma(0.47, 0.56, 0.56, 0.7)
             + [(0.56, 0.75), (-0.02, 0.75)])

PROF_MID = ([(-0.02, 0.0), (0.06, 0.0), (0.06, 0.18), (0.10, 0.18)]
            + ovolo(0.10, 0.18, 0.18, 0.26, 4) + [(0.18, 0.30), (0.20, 0.30), (0.20, 0.44)]
            + cavetto(0.20, 0.44, 0.50, 0.52) + [(0.52, 0.52), (0.52, 0.70), (0.55, 0.70)]
            + cyma(0.55, 0.70, 0.64, 0.82) + [(0.64, 0.86), (-0.02, 0.86)])

PROF_MAIN = ([(-0.02, 0.0), (0.04, 0.0), (0.04, 0.10), (0.06, 0.10), (0.06, 0.20),
              (0.08, 0.20), (0.08, 0.28)] + ovolo(0.08, 0.28, 0.13, 0.34, 4)
             + [(0.13, 0.37), (0.03, 0.37), (0.03, 0.82), (0.08, 0.82)]
             + ovolo(0.08, 0.82, 0.16, 0.90, 4) + [(0.16, 1.04)]
             + ovolo(0.16, 1.04, 0.26, 1.10, 4) + [(1.02, 1.12), (1.02, 1.34), (1.05, 1.34)]
             + cyma(1.05, 1.34, 1.20, 1.50) + [(1.20, 1.54), (-0.02, 1.54)])

PROF_BALC = ([(-0.02, 0.0), (0.25, 0.0)] + cavetto(0.25, 0.0, 0.80, 0.14)
             + [(0.86, 0.14), (0.86, 0.22), (0.90, 0.22)] + ovolo(0.90, 0.22, 0.95, 0.30, 3)
             + [(0.95, 0.40), (-0.02, 0.40)])

PROF_RAIL = [(-0.38, 0.0), (0.03, 0.0), (0.03, 0.03), (0.07, 0.05), (0.07, 0.11),
             (0.05, 0.14), (-0.39, 0.14), (-0.41, 0.11), (-0.41, 0.05), (-0.38, 0.03)]

PROF_ARCHITRAVE = [(-0.02, -0.01), (0.05, -0.01), (0.05, 0.06), (0.07, 0.08),
                   (0.07, 0.15), (0.10, 0.18), (0.10, 0.22), (-0.02, 0.22)]

PROF_ARCHIVOLT = [(-0.02, -0.01), (0.07, -0.01), (0.07, 0.05), (0.10, 0.08),
                  (0.10, 0.16), (0.13, 0.19), (0.13, 0.24), (-0.02, 0.24)]

PROF_HOOD = ([(-0.02, 0.0), (0.04, 0.0)] + ovolo(0.04, 0.0, 0.12, 0.08, 4)
             + [(0.2, 0.1), (0.2, 0.2), (0.22, 0.2)] + cyma(0.22, 0.2, 0.28, 0.3, 4)
             + [(0.28, 0.33), (-0.02, 0.33)])

PROF_FRAME = [(-0.26, -0.08), (-0.16, -0.08), (-0.16, 0.0), (-0.26, 0.0)]

BALUSTER = [(0, 0), (0.085, 0), (0.085, 0.05), (0.06, 0.07), (0.05, 0.1), (0.07, 0.17),
            (0.09, 0.26), (0.085, 0.33), (0.06, 0.4), (0.04, 0.46), (0.035, 0.5),
            (0.055, 0.53), (0.055, 0.56), (0.08, 0.58), (0.08, 0.63), (0, 0.63)]

URN = [(0, 0), (0.2, 0), (0.2, 0.08), (0.12, 0.12), (0.1, 0.2), (0.19, 0.3), (0.25, 0.43),
       (0.23, 0.56), (0.15, 0.64), (0.18, 0.68), (0.12, 0.71), (0.06, 0.79),
       (0.075, 0.84), (0.0, 0.93)]


def console_poly(h, p):
    pts = [(0.0, 0.0), (0.0, h), (p, h), (p, h * 0.84)]
    for i in range(1, 9):
        t = i / 8
        pts.append((p * (0.95 - 0.78 * t ** 0.8) + 0.03 * sin(pi * t), h * 0.84 * (1 - t) ** 1.25))
    return [(round(u, 5), round(v, 5)) for u, v in pts]


def _miter(ns, closed):
    m = len(ns) if closed else len(ns) + 1
    out = []
    for i in range(m):
        if closed:
            n1, n2 = ns[i - 1], ns[i]
        elif i == 0:
            out.append(ns[0].copy())
            continue
        elif i == m - 1:
            out.append(ns[-1].copy())
            continue
        else:
            n1, n2 = ns[i - 1], ns[i]
        out.append((n1 + n2) / (1.0 + n1.dot(n2)))
    return out


def _iv_sub(ivs, h):
    out = []
    for a, b in ivs:
        if h[1] <= a or h[0] >= b:
            out.append((a, b))
            continue
        if h[0] > a:
            out.append((a, h[0]))
        if h[1] < b:
            out.append((h[1], b))
    return out


# --------------------------------------------------------------------------
# Mesh builder
# --------------------------------------------------------------------------
class MB:
    def __init__(self):
        self.bm = bmesh.new()
        self.M = Matrix.Identity(4)
        self.stack = []

    def push(self, M):
        self.stack.append(self.M)
        self.M = self.M @ M

    def pop(self):
        self.M = self.stack.pop()

    def merge(self, t, mat, bev=0.0, seg=1):
        if bev > 0:
            edges = [e for e in t.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > radians(30)]
            if edges:
                bmesh.ops.bevel(t, geom=edges, offset=bev, segments=seg, affect="EDGES",
                                profile=0.5, clamp_overlap=True)
        vm = {v: self.bm.verts.new(self.M @ v.co) for v in t.verts}
        for f in t.faces:
            try:
                nf = self.bm.faces.new([vm[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = MI[mat]
            nf.smooth = True
        t.free()

    # -- primitives --------------------------------------------------------
    def box(self, x0, y0, z0, x1, y1, z1, mat, bev=0.0):
        x0, x1 = sorted((x0, x1))
        y0, y1 = sorted((y0, y1))
        z0, z1 = sorted((z0, z1))
        if min(x1 - x0, y1 - y0, z1 - z0) < 1e-5:
            return
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1.0)
        for v in t.verts:
            v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0),
                           (z0 + z1) / 2 + v.co.z * (z1 - z0)))
        if bev:
            bev = min(bev, 0.45 * min(x1 - x0, y1 - y0, z1 - z0))
        self.merge(t, mat, bev)

    def prism(self, poly, a0, a1, mat, axis="y", bev=0.0):
        """Extrude a 2D polygon. axis y: poly=(x,z), axis x: poly=(u,v)->(x,-u,v)."""
        t = bmesh.new()
        if axis == "y":
            f = [t.verts.new((x, a0, z)) for x, z in poly]
            b = [t.verts.new((x, a1, z)) for x, z in poly]
        else:
            f = [t.verts.new((a0, -u, v)) for u, v in poly]
            b = [t.verts.new((a1, -u, v)) for u, v in poly]
        n = len(poly)
        t.faces.new(f)
        t.faces.new(b[::-1])
        for i in range(n):
            j = (i + 1) % n
            t.faces.new((f[i], f[j], b[j], b[i]))
        bmesh.ops.recalc_face_normals(t, faces=t.faces)
        self.merge(t, mat, bev)

    def sweep(self, prof, pts, A, B, mat, closed=False):
        t = bmesh.new()
        rings = [[t.verts.new(p + a * u + b * v) for (u, v) in prof] for p, a, b in zip(pts, A, B)]
        n, m = len(prof), len(pts)
        for i in range(m if closed else m - 1):
            r0, r1 = rings[i], rings[(i + 1) % m]
            for j in range(n):
                k = (j + 1) % n
                try:
                    t.faces.new((r0[j], r0[k], r1[k], r1[j]))
                except ValueError:
                    pass
        if not closed:
            t.faces.new(rings[0][::-1])
            t.faces.new(rings[-1])
        self.merge(t, mat)

    def hsweep(self, prof, pts2, z, mat, closed=False):
        pts = [Vector((x, y, z)) for x, y in pts2]
        segs = len(pts) if closed else len(pts) - 1
        ns = []
        for i in range(segs):
            d = (pts[(i + 1) % len(pts)] - pts[i]).normalized()
            ns.append(Vector((d.y, -d.x, 0)))
        A = _miter(ns, closed)
        self.sweep(prof, pts, A, [Z] * len(pts), mat, closed)

    def vsweep(self, prof, pts2, mat, y=0.0, closed=False):
        pts = [Vector((x, y, z)) for x, z in pts2]
        segs = len(pts) if closed else len(pts) - 1
        ns = []
        for i in range(segs):
            d = (pts[(i + 1) % len(pts)] - pts[i]).normalized()
            ns.append(Vector((-d.z, 0, d.x)))
        B = _miter(ns, closed)
        self.sweep(prof, pts, [Vector((0, -1, 0))] * len(pts), B, mat, closed)

    def lathe(self, prof, seg, mat, cx=0.0, cy=0.0, rmod=None, closed_prof=False):
        t = bmesh.new()
        angs = [2 * pi * i / seg for i in range(seg)]
        rings = []
        for r, z in prof:
            if r < 1e-6:
                rings.append([t.verts.new((cx, cy, z))])
            else:
                rings.append([t.verts.new((cx + (r + (rmod(a, z) if rmod else 0)) * cos(a),
                                           cy + (r + (rmod(a, z) if rmod else 0)) * sin(a), z))
                              for a in angs])
        pairs = list(zip(rings, rings[1:]))
        if closed_prof:
            pairs.append((rings[-1], rings[0]))
        for a, b in pairs:
            for j in range(seg):
                k = (j + 1) % seg
                if len(a) == 1 and len(b) == 1:
                    continue
                if len(a) == 1:
                    vs = (a[0], b[k], b[j])
                elif len(b) == 1:
                    vs = (a[j], a[k], b[0])
                else:
                    vs = (a[j], a[k], b[k], b[j])
                try:
                    t.faces.new(vs)
                except ValueError:
                    pass
        self.merge(t, mat)

    # -- architectural helpers ---------------------------------------------
    def coursed(self, x0, x1, z0, z1, holes, course, mat, block=None, joint=0.035,
                recess=0.035, depth=T, bev=0.018, y0=0.0):
        """Stone wall of coursed blocks with recessed joints and rectangular holes."""
        n = max(1, int(round((z1 - z0) / course)))
        ch = (z1 - z0) / n
        j2 = joint / 2
        hole_x = {round(v, 4) for h in holes for v in (h[0], h[1])}
        for k in range(n):
            c0, c1 = z0 + k * ch, z0 + (k + 1) * ch
            hs = [h for h in holes if h[2] < c1 - 1e-6 and h[3] > c0 + 1e-6]
            xs = sorted({x0, x1} | {min(max(v, x0), x1) for h in hs for v in (h[0], h[1])})
            slabs = []
            for a, b in zip(xs, xs[1:]):
                if b - a < 1e-6:
                    continue
                zs = [(c0, c1)]
                for h in hs:
                    if h[0] <= a + 1e-6 and h[1] >= b - 1e-6:
                        zs = _iv_sub(zs, (h[2], h[3]))
                key = tuple((round(p, 4), round(q, 4)) for p, q in zs)
                if slabs and slabs[-1][2] == key:
                    slabs[-1][1] = b
                else:
                    slabs.append([a, b, key])
            for a, b, key in slabs:
                for za, zb in key:
                    if zb - za < 1e-3:
                        continue
                    full = abs(za - c0) < 1e-3 and abs(zb - c1) < 1e-3
                    cuts = [a, b]
                    if block and full:
                        pm = x0 + (k % 2) * block / 2
                        while pm < b - 0.05:
                            if pm > a + 0.05:
                                cuts.append(pm)
                            pm += block
                        cuts.sort()
                    for sa, sb in zip(cuts, cuts[1:]):
                        self.box(sa, y0 + recess, za, sb, y0 + depth, zb, mat)
                        fa = sa + (0 if round(sa, 4) in hole_x else j2)
                        fb = sb - (0 if round(sb, 4) in hole_x else j2)
                        fza = za + (j2 if abs(za - c0) < 1e-3 else 0)
                        fzb = zb - (j2 if abs(zb - c1) < 1e-3 else 0)
                        self.box(fa, y0, fza, fb, y0 + recess + 0.02, fzb, mat, bev=bev)

    def jack_arch(self, x0, x1, z, h, mat, n=7, proj=0.05):
        """Flat arch of splayed voussoirs + keystone over an opening."""
        cx = (x0 + x1) / 2
        fz = z - (x1 - x0) * 1.1
        xs = [x0 - 0.08 + (x1 - x0 + 0.16) * i / n for i in range(n + 1)]
        g = 0.012
        for i in range(n):
            a, b = xs[i] + g, xs[i + 1] - g
            top = z + h + (0.1 if i == n // 2 else 0)
            ta = cx + (a - cx) * (top - fz) / (z - fz)
            tb = cx + (b - cx) * (top - fz) / (z - fz)
            self.prism([(a, z), (b, z), (tb, top), (ta, top)], -proj - (0.03 if i == n // 2 else 0),
                       0.12, mat, bev=0.01)

    def voussoirs(self, cx, cz, r0, r1, n, mat, y0=-0.08, y1=0.1, key=0.35, gap=0.02):
        for i in range(n):
            a0 = pi - pi * i / n
            a1 = pi - pi * (i + 1) / n
            da = gap / r0 / 2
            ro = r1 + (key if i == n // 2 else (0.18 if i % 2 else 0.0))
            pts = [(cx + r0 * cos(a0 - da), cz + r0 * sin(a0 - da)),
                   (cx + r0 * cos(a1 + da), cz + r0 * sin(a1 + da)),
                   (cx + ro * cos(a1 + da), cz + ro * sin(a1 + da)),
                   (cx + ro * cos(a0 - da), cz + ro * sin(a0 - da))]
            self.prism(pts, y0 - (0.04 if i == n // 2 else 0), y1, mat, bev=0.015)

    def arch_wall(self, x0, x1, z0, z1, op, mat, depth=T, n=24):
        """Smooth wall with an arched opening (op = ox0, ox1, sill, spring)."""
        ox0, ox1, sill, spring = op
        cx, r = (ox0 + ox1) / 2, (ox1 - ox0) / 2
        if sill > z0:
            self.box(x0, 0, z0, x1, depth, sill, mat)
        poly = [(x0, sill), (ox0, sill), (ox0, spring)] + arc(cx, spring, r, pi, 0, n)[1:-1] \
            + [(ox1, spring), (ox1, sill), (x1, sill), (x1, z1), (x0, z1)]
        self.prism(poly, 0, depth, mat)

    def balustrade_run(self, x0, x1, post0=True, post1=False, h=1.05, pw=0.44, spacing=0.3):
        """Balustrade along local x on the line y=0 (front) .. 0.4 (back), base z=0."""
        self.box(x0, -0.04, 0, x1, 0.38, 0.16, "stone_trim", bev=0.02)
        self.hsweep(PROF_RAIL, [(x0, 0.0), (x1, 0.0)], h - 0.14, "stone_trim")
        for flag, x in ((post0, x0), (post1, x1)):
            if flag:
                self.box(x - pw / 2, -0.08, 0, x + pw / 2, 0.44, h - 0.05, "stone_trim", bev=0.02)
                self.box(x - pw / 2 - 0.04, -0.12, h - 0.05, x + pw / 2 + 0.04, 0.48, h + 0.06,
                         "stone_trim", bev=0.02)
        a = x0 + (pw / 2 if post0 else 0.0) + 0.08
        b = x1 - (pw / 2 if post1 else 0.0) - 0.08
        cnt = max(1, int(round((b - a) / spacing)))
        sc = (h - 0.30) / 0.63
        for i in range(cnt):
            x = a + (b - a) * (i + 0.5) / cnt
            prof = [(r * min(sc, 1.25), 0.16 + z * sc) for r, z in BALUSTER]
            self.lathe(prof, 12, "stone_trim", cx=x, cy=0.18)

    def column(self, cx, cy, z0, H, r, ped=0.0, flutes=20, seg=80, mat="stone_trim"):
        z = z0
        if ped > 0:
            s = r * 1.5
            self.box(cx - s - 0.04, cy - s - 0.04, z, cx + s + 0.04, cy + s + 0.04, z + 0.14, mat, bev=0.02)
            self.box(cx - s, cy - s, z + 0.14, cx + s, cy + s, z + ped - 0.12, mat, bev=0.015)
            self.box(cx - s - 0.04, cy - s - 0.04, z + ped - 0.12, cx + s + 0.04, cy + s + 0.04, z + ped,
                     mat, bev=0.02)
            z += ped
        s = r * 1.32
        self.box(cx - s, cy - s, z, cx + s, cy + s, z + 0.16 * r, mat, bev=0.01)
        zb = z + 0.16 * r
        base = [(0, zb), (1.28 * r, zb), (1.3 * r, zb + 0.08 * r), (1.26 * r, zb + 0.16 * r),
                (1.12 * r, zb + 0.2 * r), (1.04 * r, zb + 0.28 * r), (1.08 * r, zb + 0.34 * r),
                (1.14 * r, zb + 0.4 * r), (1.1 * r, zb + 0.47 * r), (1.02 * r, zb + 0.5 * r), (0, zb + 0.5 * r)]
        self.lathe(base, 40, mat, cx, cy)
        zs = zb + 0.5 * r
        cap_h = 2.3 * r
        ze = z0 + H - cap_h
        hs = ze - zs
        rings = [(0, zs), (r, zs), (r * 1.04, zs + 0.03), (r * 1.0, zs + 0.07)]
        for i in range(1, 11):
            tt = i / 10
            rr = r * (1 - 0.13 * max(0.0, (tt - 0.33) / 0.67) ** 1.4)
            rings.append((rr, zs + 0.07 + (hs - 0.2) * tt))
        rt = rings[-1][0]
        rings += [(rt * 1.07, ze - 0.1), (rt * 1.07, ze - 0.04), (rt, ze), (0, ze)]
        f0, f1 = zs + 0.09, ze - 0.14

        def flute(a, zz):
            if f0 < zz < f1:
                return -0.075 * r * max(0.0, cos(flutes * a)) ** 0.6
            return 0.0
        self.lathe(rings, seg, mat, cx, cy, rmod=flute)
        # Corinthian-style capital: bell, two rows of leaves, corner volutes, abacus
        bell = [(0, ze), (rt, ze), (rt * 1.02, ze + 0.4 * r), (rt * 1.12, ze + 1.3 * r),
                (r * 1.3, ze + 1.9 * r), (0, ze + 1.9 * r)]
        self.lathe(bell, 32, mat, cx, cy)
        for row, (hz, hh, tilt, off) in enumerate(((0.05, 0.85, 14, 0.0), (0.55, 0.95, 20, 22.5))):
            for i in range(8):
                ang = i * 45 + off
                self.push(TR(cx, cy, ze + hz * r) @ RZ(ang) @ TR(rt * (1.0 + 0.1 * row), 0, 0) @ RY(-tilt))
                self.box(-0.02 * r, -0.26 * r, 0, 0.1 * r, 0.26 * r, hh * r, mat, bev=0.02 * r)
                self.push(TR(0, 0, hh * r) @ RY(-55))
                self.box(-0.02 * r, -0.2 * r, 0, 0.08 * r, 0.2 * r, 0.28 * r, mat, bev=0.02 * r)
                self.pop()
                self.pop()
        for i in range(4):
            self.push(TR(cx, cy, ze + 1.7 * r) @ RZ(45 + 90 * i) @ TR(1.18 * r, 0, 0) @ RX(90))
            self.lathe([(0, -0.1 * r), (0.24 * r, -0.1 * r), (0.26 * r, 0.0), (0.24 * r, 0.1 * r), (0, 0.1 * r)],
                       16, mat)
            self.pop()
        a = 1.45 * r
        self.box(cx - a, cy - a, ze + 1.9 * r, cx + a, cy + a, ze + 2.3 * r, mat, bev=0.05 * r)

    def window(self, x0, x1, z0, z1, y=0.2, fw=0.07, rail=True, mull=False, room=True):
        self.box(x0, y - 0.03, z0, x1, y + 0.07, z0 + fw, "frame")
        self.box(x0, y - 0.03, z1 - fw, x1, y + 0.07, z1, "frame")
        self.box(x0, y - 0.03, z0, x0 + fw, y + 0.07, z1, "frame")
        self.box(x1 - fw, y - 0.03, z0, x1, y + 0.07, z1, "frame")
        if rail:
            zm = (z0 + z1) / 2 + 0.08
            self.box(x0 + fw, y - 0.06, zm - 0.035, x1 - fw, y + 0.02, zm + 0.035, "frame")
            self.box(x0 + fw, y - 0.07, z1 - fw - 0.05, x1 - fw, y - 0.02, z1 - fw, "frame")
            self.box(x0 + fw, y - 0.07, zm, x0 + fw + 0.05, y - 0.02, z1 - fw, "frame")
            self.box(x1 - fw - 0.05, y - 0.07, zm, x1 - fw, y - 0.02, z1 - fw, "frame")
        if mull:
            cx = (x0 + x1) / 2
            self.box(cx - 0.035, y - 0.05, z0, cx + 0.035, y + 0.05, z1, "frame")
        self.box(x0 + fw * 0.5, y + 0.005, z0 + fw * 0.5, x1 - fw * 0.5, y + 0.015, z1 - fw * 0.5, "glass")
        if room:
            self.room(x0 - 0.25, x1 + 0.25, z0 - 0.6, z1 + 0.35, y + 0.1, 1.7)

    def room(self, x0, x1, z0, z1, y0, depth):
        """Open-fronted interior shell seen through the glass (parallax interior)."""
        t = bmesh.new()
        y1 = y0 + depth
        c = [t.verts.new(v) for v in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                     (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
        for f in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 3, 7, 4), (1, 5, 6, 2), (3, 2, 6, 7)):
            t.faces.new([c[i] for i in f])
        self.merge(t, "room")


# --------------------------------------------------------------------------
# Kit pieces  (all dimensions derive from BAY / FL / GF / WIN)
# --------------------------------------------------------------------------
def dentils(m, x0, x1, u0, u1, v0, v1, step=BAY / 16, w=0.07):
    n = int(round((x1 - x0) / step))
    for i in range(n):
        c = x0 + (i + 0.5) * step
        m.box(c - w / 2, -u1, v0, c + w / 2, -u0 + 0.02, v1, "stone_trim")


def modillion(m, x, w=0.14):
    poly = [(0.26, 1.10), (0.98, 1.10), (0.98, 1.00)]
    for i in range(1, 8):
        t = i / 7
        poly.append((0.98 - 0.66 * t, 1.00 - 0.16 * (sin(t * pi / 2) ** 0.7) - 0.04 * t))
    poly.append((0.26, 0.82))
    m.prism(poly, x - w / 2, x + w / 2, "stone_trim", axis="x", bev=0.012)


def cornice_piece(prof, length, z0=0.0, kind=None, corner=False):
    m = MB()
    if corner:
        path = [(0.0, P), (0.0, 0.0), (P, 0.0)]
    else:
        path = [(0.0, 0.0), (length, 0.0)]
    m.hsweep(prof, path, z0, "stone_trim")
    arms = [Matrix.Identity(4), TR(0, P, 0) @ RZ(-90)] if corner else [Matrix.Identity(4)]
    L = P if corner else length
    for A in arms:
        m.push(A)
        if kind == "main":
            dentils(m, 0.0 if not corner else 0.2, L, 0.16, 0.26, 0.90, 1.02, step=BAY / 16)
            xs = [0.5] if corner else [BAY / 8 + BAY / 4 * i for i in range(4)]
            for x in xs:
                modillion(m, x)
        elif kind == "mid":
            dentils(m, 0.0 if not corner else 0.2, L, 0.20, 0.28, 0.30, 0.42, step=BAY / 16, w=0.065)
        m.pop()
    if corner and kind == "main":
        m.push(RZ(-45))
        m.push(Matrix.Scale(1.35, 4, Vector((0, 1, 0))))
        modillion(m, 0.0, w=0.18)
        m.pop()
        m.pop()
    return m


def piece_cornice(kind, corner=False):
    prof = {"main": PROF_MAIN, "mid": PROF_MID, "base": PROF_BASE, "string": PROF_STRING}[kind]
    return cornice_piece(prof, BAY, 0.0, kind, corner)


def keystone(m, cx, z, w0, w1, h, y0, y1, mat="stone_trim"):
    m.prism([(cx - w0, z), (cx + w0, z), (cx + w1, z + h), (cx - w1, z + h)], y0, y1, mat, bev=0.012)


def piece_wall_ground_shop():
    m = MB()
    m.coursed(0, BAY, 0, GF, [SHOP], GF / 8, "granite", block=BAY / 2, recess=0.06, bev=0.025)
    m.box(0, -0.12, 0, BAY, T, 0.38, "granite", bev=0.02)
    m.box(SHOP[0] - 0.08, -0.08, SHOP[3], SHOP[1] + 0.08, 0.2, SHOP[3] + 0.3, "granite", bev=0.02)
    keystone(m, (SHOP[0] + SHOP[1]) / 2, SHOP[3] - 0.05, 0.14, 0.19, 0.42, -0.14, 0.12, "granite")
    return m


def piece_wall_entrance():
    m = MB()
    ox0, ox1, sill, spring = DOOR
    cx, r = (ox0 + ox1) / 2, (ox1 - ox0) / 2
    m.arch_wall(0, BAY, 0, GF + FL, DOOR, "granite")
    m.box(0, -0.12, 0, ox0, T, 0.38, "granite", bev=0.02)
    m.box(ox1, -0.12, 0, BAY, T, 0.38, "granite", bev=0.02)
    k, z = 0, 0.38
    while z < spring - 0.1:
        h = min(0.55, spring - z)
        wid = ox0 - 0.01 if k % 2 == 0 else ox0 * 0.6
        m.box(ox0 - wid, -0.07, z + 0.015, ox0, 0.05, z + h - 0.015, "granite", bev=0.02)
        m.box(ox1, -0.07, z + 0.015, ox1 + wid, 0.05, z + h - 0.015, "granite", bev=0.02)
        z += h
        k += 1
    m.box(0.0, -0.12, spring - 0.2, ox0 + 0.02, 0.1, spring, "stone_trim", bev=0.02)
    m.box(ox1 - 0.02, -0.12, spring - 0.2, BAY, 0.1, spring, "stone_trim", bev=0.02)
    m.voussoirs(cx, spring, r, r + 0.3, 11, "granite", key=0.38)
    m.box(0.08, -0.12, GF + FL - 1.0, BAY - 0.08, 0.1, GF + FL - 0.8, "stone_trim", bev=0.02)
    return m


def piece_door_entrance():
    m = MB()
    ox0, ox1, sill, spring = DOOR
    cx, r = (ox0 + ox1) / 2, (ox1 - ox0) / 2
    y, tr, fw = 0.22, 3.2, 0.09
    for a, b in ((ox0, cx), (cx, ox1)):
        m.box(a, y - 0.04, 0, b, y + 0.06, tr, "frame")
        m.box(a + 0.11, y - 0.06, 1.5, b - 0.11, y - 0.04, tr - 0.18, "glass")
        m.box(a + 0.13, y - 0.07, 0.2, b - 0.13, y - 0.05, 1.25, "frame", bev=0.02)
        m.box(a + 0.3, y - 0.12, 1.25, a + 0.36, y - 0.06, 1.4, "gilt")
    m.box(ox0, y - 0.08, tr, ox1, y + 0.08, tr + 0.16, "frame")
    poly = [(ox0, tr + 0.16), (ox1, tr + 0.16), (ox1, spring)] + arc(cx, spring, r, 0, pi, 24)[1:-1] + [(ox0, spring)]
    m.prism(poly, y, y + 0.015, "glass")
    m.room(ox0 - 0.2, ox1 + 0.2, -0.05, spring + r + 0.3, y + 0.1, 3.0)
    m.box(ox0, y - 0.05, spring - 0.04, ox1, y + 0.05, spring + 0.04, "frame")
    for x in (ox0 + (ox1 - ox0) / 3, ox0 + 2 * (ox1 - ox0) / 3):
        m.box(x - 0.03, y - 0.05, tr, x + 0.03, y + 0.05, spring, "frame")
    for i in range(1, 6):
        m.push(TR(cx, 0, spring) @ RY(-180 * i / 6))
        m.box(0, y - 0.04, -0.025, r, y + 0.04, 0.025, "frame")
        m.pop()
    m.vsweep([(-0.26, -fw), (-0.16, -fw), (-0.16, 0.0), (-0.26, 0.0)],
             [(ox0, 0.0), (ox0, spring)] + arc(cx, spring, r, pi, 0, 24)[1:-1] + [(ox1, spring), (ox1, 0.0)],
             "frame")
    return m


def piece_wall_base():
    m = MB()
    m.coursed(0, BAY, 0, FL, [WIN], 0.56, "stone", block=BAY / 2, recess=0.06, bev=0.025)
    m.box(WIN[0] - 0.14, -0.14, WIN[2] - 0.15, WIN[1] + 0.14, 0.25, WIN[2], "stone_trim", bev=0.015)
    m.jack_arch(WIN[0], WIN[1], WIN[3], FL - WIN[3] - 0.12, "stone_trim")
    return m


def piece_wall_hood():
    m = MB()
    x0, x1, z0, z1 = WIN
    m.coursed(0, BAY, 0, FL, [WIN], 0.48, "stone", recess=0.03)
    m.vsweep(PROF_ARCHITRAVE, [(x0, z0), (x0, z1), (x1, z1), (x1, z0)], "stone_trim")
    m.box(x0 - 0.2, -0.09, z1 + 0.12, x1 + 0.2, 0.1, z1 + 0.26, "stone_trim", bev=0.012)
    hood = [(u * 0.62, v * 0.62) for u, v in PROF_HOOD]
    m.hsweep(hood, [(x0 - 0.3, 0.12), (x0 - 0.3, -0.09), (x1 + 0.3, -0.09), (x1 + 0.3, 0.12)],
             z1 + 0.26, "stone_trim")
    for xa in (x0 - 0.31, x1 + 0.19):
        m.push(TR(0, 0, z1 - 0.42))
        m.prism(console_poly(0.68, 0.2), xa, xa + 0.12, "stone_trim", axis="x", bev=0.008)
        m.pop()
    m.box(x0 - 0.16, -0.15, z0 - 0.14, x1 + 0.16, 0.25, z0, "stone_trim", bev=0.015)
    for xa in (x0 - 0.1, x1 - 0.02):
        m.push(TR(0, 0, z0 - 0.48))
        m.prism(console_poly(0.34, 0.13), xa, xa + 0.12, "stone_trim", axis="x", bev=0.008)
        m.pop()
    return m


def piece_wall_shaft():
    m = MB()
    x0, x1, z0, z1 = WIN
    m.coursed(0, BAY, 0, FL, [WIN], 0.48, "stone", recess=0.03)
    m.box(x0 - 0.12, -0.12, z0 - 0.13, x1 + 0.12, 0.25, z0, "stone_trim", bev=0.015)
    m.box(x0 - 0.1, -0.04, z1, x1 + 0.1, 0.1, z1 + 0.3, "stone_trim", bev=0.012)
    keystone(m, (x0 + x1) / 2, z1 - 0.06, 0.1, 0.14, 0.4, -0.09, 0.1)
    return m


def piece_wall_arch():
    m = MB()
    ox0, ox1, sill, spring = ARCH
    cx, r = (ox0 + ox1) / 2, (ox1 - ox0) / 2
    m.coursed(0, BAY, 0, sill, [], sill, "stone", recess=0.03)
    m.arch_wall(0, BAY, sill, 2 * FL, (ox0, ox1, sill, spring), "stone")
    for z in [sill + 0.48 * i for i in range(1, 10)]:
        for a, b in ((0.0, ox0 - 0.2), (ox1 + 0.2, BAY)):
            m.box(a, -0.012, z - 0.012, b, 0.02, z + 0.012, "stone")
    prof = [(u, v * 0.8) for u, v in PROF_ARCHIVOLT]
    m.vsweep(prof, [(ox0, sill), (ox0, spring)] + arc(cx, spring, r, pi, 0, 24)[1:-1]
             + [(ox1, spring), (ox1, sill)], "stone_trim")
    m.box(0, -0.12, sill - 0.14, BAY, 0.25, sill, "stone_trim", bev=0.015)
    keystone(m, cx, spring + r - 0.05, 0.12, 0.18, 2 * FL - spring - r - 0.02, -0.16, 0.1)
    m.box(ox0 - 0.26, -0.1, spring - 0.16, ox0 + 0.02, 0.1, spring, "stone_trim", bev=0.015)
    m.box(ox1 - 0.02, -0.1, spring - 0.16, ox1 + 0.26, 0.1, spring, "stone_trim", bev=0.015)
    for x in (0.12, BAY - 0.12):
        m.push(TR(x, -0.02, spring + 0.45) @ RX(90))
        m.lathe([(0.0, 0.0), (0.09, 0.0), (0.1, 0.02), (0.09, 0.05), (0.0, 0.06)], 20, "stone_trim")
        m.pop()
    return m


def piece_window_arch():
    m = MB()
    ox0, ox1, sill, spring = ARCH
    cx, r = (ox0 + ox1) / 2, (ox1 - ox0) / 2
    y = 0.2
    outline = [(ox0, sill), (ox0, spring)] + arc(cx, spring, r, pi, 0, 24)[1:-1] + [(ox1, spring), (ox1, sill)]
    m.vsweep(PROF_FRAME, outline, "frame", closed=True)
    m.prism(outline, y + 0.01, y + 0.02, "glass")
    m.room(ox0 - 0.25, ox1 + 0.25, sill - 0.5, spring + r + 0.3, y + 0.1, 1.7)
    m.box(ox0, y - 0.07, FL - 0.1, ox1, y + 0.04, FL + 0.5, "iron", bev=0.02)
    m.box(ox0 + 0.1, y - 0.09, FL, ox1 - 0.1, y - 0.06, FL + 0.4, "iron", bev=0.015)
    m.box(ox0, y - 0.05, spring - 0.05, ox1, y + 0.05, spring + 0.05, "frame")
    m.box(cx - 0.035, y - 0.05, sill, cx + 0.035, y + 0.05, spring, "frame")
    for zz in ((sill + FL - 0.1) / 2, (FL + 0.5 + spring) / 2):
        m.box(ox0, y - 0.05, zz - 0.04, ox1, y + 0.03, zz + 0.04, "frame")
    for ang in (45, 135):
        m.push(TR(cx, 0, spring) @ RY(-ang))
        m.box(0, y - 0.04, -0.03, r, y + 0.04, 0.03, "frame")
        m.pop()
    return m


def piece_wall_colonnade():
    m = MB()
    dy = 0.25
    hi = (WIN[0], WIN[1], WIN[2] + FL, WIN[3] + FL)
    m.coursed(0, BAY, 0, 2 * FL, [WIN, hi], 0.56, "stone", recess=0.03, y0=dy, depth=T)
    for (x0, x1, z0, z1) in (WIN, hi):
        m.box(x0 - 0.12, dy - 0.12, z0 - 0.13, x1 + 0.12, dy + 0.25, z0, "stone_trim", bev=0.015)
        m.vsweep(PROF_ARCHITRAVE, [(x0, z0), (x0, z1), (x1, z1), (x1, z0)], "stone_trim", y=dy)
    m.box(WIN[0] - 0.05, dy - 0.05, WIN[3] + 0.28, WIN[1] + 0.05, dy + 0.1, hi[2] - 0.28, "stone_trim", bev=0.03)
    m.box(WIN[0] + 0.1, dy - 0.08, WIN[3] + 0.38, WIN[1] - 0.1, dy + 0.1, hi[2] - 0.38, "stone_trim", bev=0.03)
    m.box(0, dy - 0.1, 2 * FL - 0.4, BAY, dy + 0.2, 2 * FL, "stone_trim", bev=0.015)
    return m


def piece_column():
    m = MB()
    m.column(0, 0, 0, COL_H, 0.21, ped=0.7)
    return m


def piece_window_sash():
    m = MB()
    m.window(*WIN)
    return m


def piece_window_shop():
    m = MB()
    x0, x1, z0, z1 = SHOP
    y = 0.14
    m.box(x0, y - 0.05, z0, x1, y + 0.08, 1.0, "frame", bev=0.02)
    m.box(x0 + 0.1, y - 0.08, z0 + 0.1, x1 - 0.1, y - 0.04, 0.9, "frame", bev=0.02)
    m.window(x0, x1, 1.0, 3.3, y=y, fw=0.09, rail=False, mull=True, room=False)
    m.box(x0, y - 0.07, 3.3, x1, y + 0.08, 3.44, "frame")
    m.window(x0, x1, 3.44, z1, y=y, fw=0.08, rail=False, room=False)
    for x in (x0 + (x1 - x0) / 3, x0 + 2 * (x1 - x0) / 3):
        m.box(x - 0.03, y - 0.04, 3.44, x + 0.03, y + 0.05, z1, "frame")
    m.room(x0 - 0.2, x1 + 0.2, 0.0, z1 + 0.3, y + 0.1, 3.5)
    return m


def pier(h, course, mat, recess, proj=0.06):
    m = MB()
    n = max(1, int(round(h / course)))
    ch = h / n
    j2 = 0.0175
    m.box(-proj + recess, -proj + recess, 0, P, P, h, mat)
    for k in range(n):
        m.box(-proj, -proj, k * ch + j2, P - j2, P - j2, (k + 1) * ch - j2, mat, bev=0.025)
    return m


def piece_pier_ground():
    m = pier(GF, GF / 8, "granite", 0.06)
    m.box(-0.12, -0.12, 0, P, P, 0.38, "granite", bev=0.02)
    return m


def piece_balcony(corner=False):
    m = MB()
    o = 0.87
    if corner:
        m.hsweep(PROF_BALC, [(0.0, P), (0.0, 0.0), (P, 0.0)], 0.0, "stone_trim")
        m.push(TR(0, -o, 0.4))
        m.balustrade_run(-o, P, post0=True, post1=False)
        m.pop()
        m.push(TR(0, P, 0) @ RZ(-90) @ TR(0, -o, 0.4))
        m.balustrade_run(0.0, P + o - 0.22, post0=False, post1=False)
        m.pop()
        arms = [Matrix.Identity(4), TR(0, P, 0) @ RZ(-90)]
        xs = [P / 2]
    else:
        m.hsweep(PROF_BALC, [(0.0, 0.0), (BAY, 0.0)], 0.0, "stone_trim")
        m.push(TR(0, -o, 0.4))
        m.balustrade_run(0.0, BAY, post0=True)
        m.pop()
        arms = [Matrix.Identity(4)]
        xs = [BAY / 4, 3 * BAY / 4]
    for A in arms:
        m.push(A @ TR(0, 0, -0.75))
        for x in xs:
            m.prism(console_poly(0.8, 0.75), x - 0.08, x + 0.08, "stone_trim", axis="x", bev=0.012)
        m.pop()
    return m


def piece_balustrade(corner=False):
    m = MB()
    if corner:
        m.balustrade_run(0.0, P, post0=True)
        m.push(TR(0, P, 0) @ RZ(-90))
        m.balustrade_run(0.0, P - 0.22, post0=False)
        m.pop()
    else:
        m.balustrade_run(0.0, BAY, post0=True)
    return m


def piece_balconette():
    m = MB()
    x0, x1, d = WIN[0] - 0.28, WIN[1] + 0.28, 0.6
    m.box(x0, -d, 0.0, x1, 0.2, 0.16, "stone_trim", bev=0.03)
    m.box(x0 + 0.04, -d + 0.04, -0.12, x1 - 0.04, 0.2, 0.0, "stone_trim", bev=0.03)
    for xa in (x0 + 0.08, x1 - 0.22):
        m.push(TR(0, 0, -0.7))
        m.prism(console_poly(0.58, 0.53), xa, xa + 0.14, "stone_trim", axis="x", bev=0.01)
        m.pop()
    m.push(TR(0, -d + 0.06, 0.16))
    m.balustrade_run(x0, x1, post0=True, post1=True, h=0.95, pw=0.26, spacing=0.24)
    m.pop()
    for xa in (x0, x1):
        m.push(TR(xa + (0.13 if xa == x0 else -0.13), 0.12, 0.16) @ RZ(90))
        m.balustrade_run(0.0, d - 0.32, post0=False, post1=False, h=0.95, pw=0.26, spacing=0.24)
        m.pop()
    return m


def piece_awning():
    m = MB()
    x0, x1 = WIN[0] - 0.08, WIN[1] + 0.08
    zt, zb, d = WIN[3] + 0.12, WIN[3] - 0.72, 0.74
    sag = 0.05
    # canvas with a slight sag, scalloped valance and side cheeks
    prof = [(d * t, zt - (zt - zb) * t - sag * sin(pi * t)) for t in (i / 6 for i in range(7))]
    poly = prof + [(u, v - 0.018) for u, v in reversed(prof)]
    m.prism(poly, x0, x1, "awning", axis="x")
    n = 8
    for i in range(n):
        a = x0 + (x1 - x0) * i / n
        b = x0 + (x1 - x0) * (i + 1) / n
        m.prism([(a, zb), (b, zb), (b, zb - 0.12), ((a + b) / 2, zb - 0.19), (a, zb - 0.12)],
                -d - 0.012, -d + 0.004, "awning")
    for x in (x0, x1 - 0.012):
        m.prism([(0.0, zt)] + prof[1:] + [(d, zb - 0.12), (0.0, zb + 0.35)], x, x + 0.012, "awning", axis="x")
    m.box(x0 - 0.02, -0.06, zt - 0.02, x1 + 0.02, 0.02, zt + 0.06, "iron")
    for x in (x0 + 0.02, x1 - 0.02):
        m.push(TR(x, 0, zb + 0.3) @ RX(-math.degrees(math.atan2(d, 0.3))))
        m.box(-0.008, -0.008, 0, 0.008, 0.008, 0.82, "iron")
        m.pop()
    return m


def piece_urn():
    m = MB()
    m.box(-0.26, -0.26, 0, 0.26, 0.26, 0.18, "stone_trim", bev=0.02)
    m.lathe([(r, z + 0.18) for r, z in URN], 24, "stone_trim")
    return m


def piece_roof():
    m = MB()
    m.box(0, 0, 0, 1, 1, 1, "roof")
    return m


# ---- context kit: used for the neighbouring buildings ----------------------
MANSARD_H, MANSARD_IN = 3.3, 0.85


def piece_mansard(corner=False):
    """Steep tiled mansard storey with a pedimented dormer per bay."""
    m = MB()
    h, inset = MANSARD_H, MANSARD_IN
    if corner:
        t = bmesh.new()
        pts = [(0, 0, 0), (P, 0, 0), (P, P, 0), (0, P, 0),
               (inset, inset, h), (P, inset, h), (P, P, h), (inset, P, h)]
        for p in pts:
            t.verts.new(p)
        bmesh.ops.convex_hull(t, input=t.verts)
        m.merge(t, "tile")
        return m
    m.prism([(0.06, 0.0), (0.06, 0.12), (-inset, h), (-1.6, h), (-1.6, 0.0)], 0.0, BAY, "tile", axis="x")
    m.box(0, -0.1, -0.05, BAY, 0.3, 0.15, "stone_trim", bev=0.02)
    cx = BAY / 2
    w, dz0, dz1 = 0.55, 0.35, 2.1
    m.box(cx - w, -0.25, dz0, cx + w, 0.9, dz1, "stone_trim", bev=0.02)
    m.prism([(cx - w - 0.1, dz1), (cx + w + 0.1, dz1), (cx, dz1 + 0.55)], -0.32, 0.9, "stone_trim", bev=0.015)
    m.window(cx - w + 0.12, cx + w - 0.12, dz0 + 0.1, dz1 - 0.08, y=-0.15, fw=0.06)
    return m


def piece_water_tank():
    m = MB()
    for x in (-1.0, 1.0):
        for y in (-1.0, 1.0):
            m.box(x - 0.08, y - 0.08, 0, x + 0.08, y + 0.08, 2.2, "iron")
    m.box(-1.3, -1.3, 2.2, 1.3, 1.3, 2.4, "wood")
    staves = [(0, 2.4), (1.25, 2.4), (1.25, 5.4), (1.3, 5.4), (0.2, 6.3), (0, 6.35)]
    m.lathe(staves, 28, "wood")
    for z in (2.8, 3.6, 4.4, 5.1):
        m.lathe([(1.24, z), (1.28, z), (1.28, z + 0.05), (1.24, z + 0.05)], 28, "iron", closed_prof=True)
    return m


def piece_lamp_post():
    m = MB()
    m.lathe([(0, 0), (0.22, 0), (0.22, 0.1), (0.15, 0.25), (0.12, 0.6), (0.07, 0.8), (0.06, 4.2),
             (0.09, 4.3), (0.0, 4.32)], 16, "iron")
    for s in (-1, 1):
        m.box(-0.02, s * 0.02, 4.05, 0.02, s * 0.62, 4.1, "iron")
        m.lathe([(0, 3.62), (0.06, 3.62), (0.16, 3.82), (0.17, 4.0), (0.0, 4.05)], 12, "glass",
                cx=0.0, cy=s * 0.62)
        m.lathe([(0, 4.0), (0.2, 4.0), (0.05, 4.18), (0, 4.2)], 12, "iron", cx=0.0, cy=s * 0.62)
    return m


def piece_tempietto():
    m = MB()
    m.push(Matrix.Scale(CUPOLA, 4))
    s = 2.9
    m.box(-s, -s, 0, s, s, 0.85, "stone", bev=0.03)
    m.hsweep(PROF_STRING, [(-s, -s), (s, -s), (s, s), (-s, s)], 0.55, "stone_trim", closed=True)
    for i in range(4):
        m.push(RZ(90 * i) @ TR(s - 0.3, -s + 0.3, 0.85))
        m.lathe(URN, 20, "stone_trim")
        m.pop()
    m.lathe([(0, 0.85), (2.78, 0.85), (2.78, 1.0), (2.64, 1.0), (2.64, 1.15), (0, 1.15)], 64, "stone")
    m.lathe([(0, 1.15), (1.95, 1.15), (1.95, 5.62), (0, 5.62)], 48, "stone")
    for i in range(8):
        phi = 22.5 + 45 * i
        m.push(RZ(phi + 90) @ TR(0, -1.93, 0))
        poly = [(-0.34, 1.7), (0.34, 1.7)] + arc(0, 4.5, 0.34, 0, pi, 12)[1:-1] + [(-0.34, 4.5)]
        m.prism(poly, -0.03, 0.05, "void")
        m.vsweep([(-0.02, -0.01), (0.07, -0.01), (0.07, 0.06), (0.1, 0.09), (0.1, 0.14), (-0.02, 0.14)],
                 [(-0.34, 1.7), (-0.34, 4.5)] + arc(0, 4.5, 0.34, pi, 0, 12)[1:-1] + [(0.34, 4.5), (0.34, 1.7)],
                 "stone_trim", y=0.0)
        m.box(-0.45, -0.12, 1.55, 0.45, 0.05, 1.7, "stone_trim", bev=0.015)
        m.pop()
    for i in range(8):
        a = radians(45 * i)
        m.column(2.42 * cos(a), 2.42 * sin(a), 1.15, 4.47, 0.19, seg=64)
    prof = [(0, 5.62)] + [(2.62 + u, 5.62 + v) for u, v in PROF_MID] + [(0, 5.62 + 0.86)]
    m.lathe(prof, 64, "stone_trim")
    m.lathe([(0, 6.48), (2.25, 6.48), (2.25, 7.25), (2.33, 7.25), (2.36, 7.32), (2.36, 7.42), (0, 7.42)],
            64, "stone")
    for i in range(8):
        a = radians(45 * i)
        m.box(2.42 * cos(a) - 0.22, 2.42 * sin(a) - 0.22, 6.48, 2.42 * cos(a) + 0.22, 2.42 * sin(a) + 0.22,
              7.1, "stone_trim", bev=0.02)
    return m


def piece_dome():
    m = MB()
    m.push(Matrix.Scale(CUPOLA, 4))
    Rd, Hd, r_top = 2.2, 3.1, 0.58
    t_top = math.acos(r_top / Rd)
    n = 18
    curve = [(Rd * cos(t_top * i / n), 0.18 + Hd * sin(t_top * i / n)) for i in range(n + 1)]
    m.lathe([(0, 0), (2.3, 0), (2.3, 0.18)] + curve + [(0, curve[-1][1])], 64, "copper")
    for i in range(8):
        m.push(RZ(45 * i + 22.5))
        pts, A = [], []
        for k in range(n + 1):
            t = t_top * k / n
            pts.append(Vector((Rd * cos(t), 0, 0.18 + Hd * sin(t))))
            A.append(Vector((cos(t) / Rd, 0, sin(t) / Hd)).normalized())
        m.sweep([(-0.05, -0.07), (0.06, -0.07), (0.09, -0.035), (0.09, 0.035), (0.06, 0.07), (-0.05, 0.07)],
                pts, A, [Vector((0, 1, 0))] * len(pts), "copper")
        m.pop()
    for i in range(4):
        t = 0.42
        rr, zz = Rd * cos(t), 0.18 + Hd * sin(t)
        m.push(RZ(45 * i * 2 + 90) @ TR(0, -rr + 0.02, zz) @ RX(90 - math.degrees(t) * 0.6))
        m.lathe([(0.17, -0.04), (0.27, -0.04), (0.27, 0.16), (0.17, 0.16)], 24, "copper", closed_prof=True)
        m.lathe([(0, 0.02), (0.18, 0.02), (0.18, 0.06), (0, 0.06)], 24, "void")
        m.pop()
    return m


def piece_lantern():
    m = MB()
    m.push(Matrix.Scale(CUPOLA, 4))
    m.lathe([(0, 0), (0.72, 0), (0.72, 0.3), (0.62, 0.3), (0, 0.3)], 32, "stone_trim")
    m.lathe([(0, 0.3), (0.34, 0.3), (0.34, 1.55), (0, 1.55)], 24, "void")
    for i in range(6):
        a = radians(60 * i)
        m.column(0.5 * cos(a), 0.5 * sin(a), 0.3, 1.25, 0.065, seg=24, flutes=8)
    m.lathe([(0, 1.55), (0.7, 1.55), (0.76, 1.65), (0.76, 1.75), (0, 1.75)], 32, "stone_trim")
    m.lathe([(0, 1.75), (0.68, 1.75)] + [(0.68 * cos(t), 1.75 + 0.7 * sin(t)) for t in
                                          (pi / 2 * i / 10 for i in range(1, 10))] + [(0, 2.45)], 32, "copper")
    m.lathe([(0, 2.4), (0.1, 2.4), (0.06, 2.6), (0.1, 2.68)] +
            [(0.25 * cos(t), 2.93 + 0.25 * sin(t)) for t in (-pi / 2 + pi * i / 12 for i in range(1, 12))] +
            [(0.04, 3.2), (0.035, 4.6), (0.0, 4.75)], 24, "gilt")
    return m


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------
def _n(nt, typ, loc, **kw):
    node = nt.nodes.new(typ)
    node.location = loc
    for k, v in kw.items():
        if k in node.inputs:
            node.inputs[k].default_value = v
        else:
            setattr(node, k, v)
    return node


def _ramp(nt, loc, c0, c1, p0=0.3, p1=0.7):
    r = nt.nodes.new("ShaderNodeValToRGB")
    r.location = loc
    e = r.color_ramp.elements
    e[0].position, e[0].color = p0, (*c0, 1)
    e[1].position, e[1].color = p1, (*c1, 1)
    return r


def _base(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    return mat, nt, bsdf


def mat_stone(name, c_dark, c_light, rough=0.8, speckle=False, block_var=0.12, grime=True):
    """Weathered stone: large-scale tone noise, per-block tone variation (random per
    island), vertical rain streaks, street-level grime, AO soot in crevices, fine bump."""
    mat, nt, bsdf = _base(name)
    L = nt.links
    geo = _n(nt, "ShaderNodeNewGeometry", (-1600, 0))
    n1 = _n(nt, "ShaderNodeTexNoise", (-1300, 300), Scale=0.35, Detail=5.0, Roughness=0.6)
    L.new(geo.outputs["Position"], n1.inputs["Vector"])
    ramp = _ramp(nt, (-1050, 300), c_dark, c_light, 0.35, 0.65)
    L.new(n1.outputs["Fac"], ramp.inputs["Fac"])
    # per block tone
    isl = _ramp(nt, (-1050, 50), [1 - block_var] * 3, [1 + block_var * 0.6] * 3, 0.0, 1.0)
    L.new(geo.outputs["Random Per Island"], isl.inputs["Fac"])
    m0 = _n(nt, "ShaderNodeMixRGB", (-800, 250), blend_type="MULTIPLY", Fac=1.0)
    L.new(ramp.outputs["Color"], m0.inputs["Color1"])
    L.new(isl.outputs["Color"], m0.inputs["Color2"])
    # rain streaks
    mp = _n(nt, "ShaderNodeMapping", (-1300, -150))
    mp.inputs["Scale"].default_value = (2.5, 2.5, 0.1)
    L.new(geo.outputs["Position"], mp.inputs["Vector"])
    n2 = _n(nt, "ShaderNodeTexNoise", (-1100, -150), Scale=1.6, Detail=3.0)
    L.new(mp.outputs["Vector"], n2.inputs["Vector"])
    sr = _ramp(nt, (-900, -150), (0.7, 0.68, 0.64), (1, 1, 1), 0.36, 0.62)
    L.new(n2.outputs["Fac"], sr.inputs["Fac"])
    col = _n(nt, "ShaderNodeMixRGB", (-600, 150), blend_type="MULTIPLY", Fac=0.75)
    L.new(m0.outputs["Color"], col.inputs["Color1"])
    L.new(sr.outputs["Color"], col.inputs["Color2"])
    if speckle:
        vor = _n(nt, "ShaderNodeTexVoronoi", (-1100, -450), Scale=90.0)
        L.new(geo.outputs["Position"], vor.inputs["Vector"])
        vr = _ramp(nt, (-900, -450), (0.35, 0.35, 0.35), (1, 1, 1), 0.0, 0.25)
        L.new(vor.outputs["Distance"], vr.inputs["Fac"])
        m2 = _n(nt, "ShaderNodeMixRGB", (-450, 0), blend_type="MULTIPLY", Fac=0.5)
        L.new(col.outputs["Color"], m2.inputs["Color1"])
        L.new(vr.outputs["Color"], m2.inputs["Color2"])
        col = m2
    if grime:
        sz = _n(nt, "ShaderNodeSeparateXYZ", (-1300, -650))
        L.new(geo.outputs["Position"], sz.inputs["Vector"])
        gr = _n(nt, "ShaderNodeMapRange", (-1100, -650))
        gr.inputs["From Min"].default_value = 0.0
        gr.inputs["From Max"].default_value = 9.0
        L.new(sz.outputs["Z"], gr.inputs["Value"])
        grr = _ramp(nt, (-900, -650), (0.62, 0.6, 0.57), (1, 1, 1), 0.0, 1.0)
        L.new(gr.outputs["Result"], grr.inputs["Fac"])
        m4 = _n(nt, "ShaderNodeMixRGB", (-300, 0), blend_type="MULTIPLY", Fac=1.0)
        L.new(col.outputs["Color"], m4.inputs["Color1"])
        L.new(grr.outputs["Color"], m4.inputs["Color2"])
        col = m4
    ao = _n(nt, "ShaderNodeAmbientOcclusion", (-450, -300), Distance=0.3)
    aor = _ramp(nt, (-250, -300), (0.42, 0.4, 0.37), (1, 1, 1), 0.0, 1.0)
    L.new(ao.outputs["AO"], aor.inputs["Fac"])
    m3 = _n(nt, "ShaderNodeMixRGB", (-100, 100), blend_type="MULTIPLY", Fac=1.0)
    L.new(col.outputs["Color"], m3.inputs["Color1"])
    L.new(aor.outputs["Color"], m3.inputs["Color2"])
    L.new(m3.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    n3 = _n(nt, "ShaderNodeTexNoise", (-700, -800), Scale=14.0, Detail=8.0, Roughness=0.7)
    L.new(geo.outputs["Position"], n3.inputs["Vector"])
    bump = _n(nt, "ShaderNodeBump", (-250, -800), Strength=0.25, Distance=0.01)
    L.new(n3.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    mat["export_color"] = [(a + b) / 2 for a, b in zip(c_dark, c_light)]
    mat["export_rough"] = rough
    return mat


def mat_brick(name, c_brick, c_brick2, c_mortar, scale=(4.0, 4.0, 13.0)):
    """Running-bond brick on world coordinates (works on X- and Y-facing walls)."""
    mat, nt, bsdf = _base(name)
    L = nt.links
    geo = _n(nt, "ShaderNodeNewGeometry", (-1400, 0))
    sep = _n(nt, "ShaderNodeSeparateXYZ", (-1200, 0))
    L.new(geo.outputs["Position"], sep.inputs["Vector"])
    add = _n(nt, "ShaderNodeMath", (-1000, 100), operation="ADD")
    L.new(sep.outputs["X"], add.inputs[0])
    L.new(sep.outputs["Y"], add.inputs[1])
    comb = _n(nt, "ShaderNodeCombineXYZ", (-800, 0))
    L.new(add.outputs[0], comb.inputs["X"])
    L.new(sep.outputs["Z"], comb.inputs["Y"])
    br = _n(nt, "ShaderNodeTexBrick", (-600, 0), Scale=1.0, **{"Mortar Size": 0.012, "Brick Width": 0.23,
                                                                   "Row Height": 0.075})
    br.inputs["Color1"].default_value = (*c_brick, 1)
    br.inputs["Color2"].default_value = (*c_brick2, 1)
    br.inputs["Mortar"].default_value = (*c_mortar, 1)
    br.offset = 0.5
    L.new(comb.outputs["Vector"], br.inputs["Vector"])
    nz = _n(nt, "ShaderNodeTexNoise", (-600, -300), Scale=0.4, Detail=4.0)
    L.new(geo.outputs["Position"], nz.inputs["Vector"])
    nr = _ramp(nt, (-400, -300), (0.7, 0.68, 0.66), (1.05, 1.03, 1.0), 0.3, 0.7)
    L.new(nz.outputs["Fac"], nr.inputs["Fac"])
    mm = _n(nt, "ShaderNodeMixRGB", (-200, 0), blend_type="MULTIPLY", Fac=1.0)
    L.new(br.outputs["Color"], mm.inputs["Color1"])
    L.new(nr.outputs["Color"], mm.inputs["Color2"])
    ao = _n(nt, "ShaderNodeAmbientOcclusion", (-400, -500), Distance=0.3)
    aor = _ramp(nt, (-200, -500), (0.45, 0.43, 0.4), (1, 1, 1), 0.0, 1.0)
    L.new(ao.outputs["AO"], aor.inputs["Fac"])
    m3 = _n(nt, "ShaderNodeMixRGB", (0, 0), blend_type="MULTIPLY", Fac=1.0)
    L.new(mm.outputs["Color"], m3.inputs["Color1"])
    L.new(aor.outputs["Color"], m3.inputs["Color2"])
    L.new(m3.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bump = _n(nt, "ShaderNodeBump", (0, -400), Strength=0.4, Distance=0.01, invert=True)
    L.new(br.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    mat["export_color"] = list(c_brick)
    mat["export_rough"] = 0.85
    return mat


def mat_setts(name, c0, c1, mortar, brick_w, row_h, tex_scale, rough=0.75):
    """Granite setts / paving: brick texture on the ground plane (XY)."""
    mat, nt, bsdf = _base(name)
    L = nt.links
    geo = _n(nt, "ShaderNodeNewGeometry", (-1000, 0))
    br = _n(nt, "ShaderNodeTexBrick", (-600, 0), Scale=tex_scale, **{"Mortar Size": 0.02, "Brick Width": brick_w,
                                                                     "Row Height": row_h, "Mortar Smooth": 0.3})
    br.inputs["Color1"].default_value = (*c0, 1)
    br.inputs["Color2"].default_value = (*c1, 1)
    br.inputs["Mortar"].default_value = (*mortar, 1)
    L.new(geo.outputs["Position"], br.inputs["Vector"])
    nz = _n(nt, "ShaderNodeTexNoise", (-600, -300), Scale=0.15, Detail=4.0)
    L.new(geo.outputs["Position"], nz.inputs["Vector"])
    nr = _ramp(nt, (-400, -300), (0.6, 0.6, 0.6), (1.1, 1.1, 1.1), 0.3, 0.7)
    L.new(nz.outputs["Fac"], nr.inputs["Fac"])
    mm = _n(nt, "ShaderNodeMixRGB", (-200, 0), blend_type="MULTIPLY", Fac=1.0)
    L.new(br.outputs["Color"], mm.inputs["Color1"])
    L.new(nr.outputs["Color"], mm.inputs["Color2"])
    L.new(mm.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bump = _n(nt, "ShaderNodeBump", (0, -400), Strength=0.6, Distance=0.02, invert=True)
    L.new(br.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    mat["export_color"] = list(c0)
    mat["export_rough"] = rough
    return mat


def mat_simple(name, color, rough, metal=0.0):
    mat, nt, bsdf = _base(name)
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    mat["export_color"] = list(color)
    mat["export_rough"] = rough
    mat["export_metal"] = metal
    return mat, nt, bsdf


def make_materials():
    MATS["stone"] = mat_stone("M_Limestone", (0.55, 0.52, 0.46), (0.75, 0.72, 0.64))
    MATS["stone_trim"] = mat_stone("M_Limestone_Trim", (0.60, 0.57, 0.50), (0.79, 0.76, 0.68), 0.75,
                                   block_var=0.06)
    MATS["granite"] = mat_stone("M_Granite", (0.28, 0.26, 0.25), (0.42, 0.39, 0.37), 0.6, speckle=True)
    MATS["brownstone"] = mat_stone("M_Brownstone", (0.2, 0.12, 0.09), (0.32, 0.2, 0.15), 0.8)
    MATS["buff"] = mat_stone("M_Buff_Terracotta", (0.5, 0.42, 0.32), (0.66, 0.57, 0.45), 0.8)
    MATS["buff_trim"] = mat_stone("M_Buff_Trim", (0.58, 0.5, 0.4), (0.74, 0.66, 0.54), 0.75, block_var=0.05)
    MATS["brick_red"] = mat_brick("M_Brick_Red", (0.3, 0.085, 0.05), (0.22, 0.07, 0.045), (0.42, 0.4, 0.36))
    MATS["brick_brown"] = mat_brick("M_Brick_Brown", (0.25, 0.14, 0.09), (0.19, 0.11, 0.075), (0.4, 0.38, 0.34))
    MATS["setts"] = mat_setts("M_Street_Setts", (0.12, 0.115, 0.11), (0.07, 0.068, 0.065), (0.04, 0.04, 0.04),
                              0.28, 0.13, 1.0)
    MATS["paving"] = mat_setts("M_Sidewalk_Flags", (0.42, 0.41, 0.39), (0.36, 0.35, 0.33), (0.2, 0.2, 0.2),
                               1.0, 0.5, 0.666, 0.85)
    MATS["tile"] = mat_brick("M_Roof_Tile", (0.36, 0.1, 0.06), (0.27, 0.075, 0.05), (0.12, 0.05, 0.04))

    # glass: thin clear pane (interior rooms show through) or drawn blinds per window
    mat, nt, bsdf = mat_simple("M_Glass", (0.8, 0.82, 0.82), 0.02)
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["IOR"].default_value = 1.52
    L = nt.links
    out = nt.nodes["Material Output"]
    tc = _n(nt, "ShaderNodeTexCoord", (-1000, 0))
    oi = _n(nt, "ShaderNodeObjectInfo", (-1000, -300))
    sep = _n(nt, "ShaderNodeSeparateXYZ", (-800, 0))
    L.new(tc.outputs["Object"], sep.inputs["Vector"])
    mr = _n(nt, "ShaderNodeMath", (-800, -300), operation="MULTIPLY_ADD")
    L.new(oi.outputs["Random"], mr.inputs[0])
    mr.inputs[1].default_value = -2.4
    mr.inputs[2].default_value = 3.1
    gt = _n(nt, "ShaderNodeMath", (-600, 0), operation="GREATER_THAN")
    L.new(sep.outputs["Z"], gt.inputs[0])
    L.new(mr.outputs[0], gt.inputs[1])
    r2 = _n(nt, "ShaderNodeMath", (-600, -300), operation="GREATER_THAN")
    L.new(oi.outputs["Random"], r2.inputs[0])
    r2.inputs[1].default_value = 0.6
    fac = _n(nt, "ShaderNodeMath", (-400, -100), operation="MULTIPLY")
    L.new(gt.outputs[0], fac.inputs[0])
    L.new(r2.outputs[0], fac.inputs[1])
    blind = _n(nt, "ShaderNodeBsdfDiffuse", (-200, -400))
    blind.inputs["Color"].default_value = (0.52, 0.48, 0.4, 1)
    mix = _n(nt, "ShaderNodeMixShader", (100, 0))
    L.new(fac.outputs[0], mix.inputs["Fac"])
    L.new(bsdf.outputs["BSDF"], mix.inputs[1])
    L.new(blind.outputs["BSDF"], mix.inputs[2])
    L.new(mix.outputs["Shader"], out.inputs["Surface"])
    mat["export_color"] = [0.05, 0.06, 0.07]
    MATS["glass"] = mat

    # interior rooms: random wall tone per window, a little darker toward the back
    mat, nt, bsdf = mat_simple("M_Interior_Room", (0.2, 0.18, 0.15), 0.9)
    L = nt.links
    oi = _n(nt, "ShaderNodeObjectInfo", (-800, 0))
    rp = _ramp(nt, (-600, 0), (0.05, 0.045, 0.04), (0.42, 0.36, 0.28), 0.0, 1.0)
    L.new(oi.outputs["Random"], rp.inputs["Fac"])
    L.new(rp.outputs["Color"], bsdf.inputs["Base Color"])
    em = _n(nt, "ShaderNodeMath", (-600, -300), operation="MULTIPLY")
    L.new(oi.outputs["Random"], em.inputs[0])
    em.inputs[1].default_value = 0.35
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.85, 0.6, 1)
    L.new(em.outputs[0], bsdf.inputs["Emission Strength"])
    MATS["room"] = mat

    MATS["frame"] = mat_simple("M_Frame_Paint", (0.03, 0.04, 0.035), 0.45)[0]
    MATS["iron"] = mat_simple("M_Iron", (0.05, 0.055, 0.05), 0.5, 0.6)[0]
    MATS["roof"] = mat_simple("M_Roof_Tar", (0.09, 0.09, 0.09), 0.9)[0]
    MATS["void"] = mat_simple("M_Interior_Void", (0.004, 0.004, 0.004), 1.0)[0]
    MATS["gilt"] = mat_simple("M_Gilt", (0.83, 0.62, 0.27), 0.28, 1.0)[0]
    MATS["wood"] = mat_stone("M_Weathered_Wood", (0.16, 0.12, 0.09), (0.28, 0.22, 0.16), 0.85, grime=False)

    mat, nt, bsdf = mat_simple("M_Copper_Dome", (0.13, 0.11, 0.08), 0.42, 0.75)
    L = nt.links
    geo = _n(nt, "ShaderNodeNewGeometry", (-900, 0))
    nz = _n(nt, "ShaderNodeTexNoise", (-700, 0), Scale=1.8, Detail=6.0)
    L.new(geo.outputs["Position"], nz.inputs["Vector"])
    rp = _ramp(nt, (-450, 0), (0.12, 0.10, 0.075), (0.2, 0.27, 0.23), 0.45, 0.7)
    L.new(nz.outputs["Fac"], rp.inputs["Fac"])
    L.new(rp.outputs["Color"], bsdf.inputs["Base Color"])
    mr = _ramp(nt, (-450, -300), (0.8, 0.8, 0.8), (0.2, 0.2, 0.2), 0.45, 0.7)
    L.new(nz.outputs["Fac"], mr.inputs["Fac"])
    L.new(mr.outputs["Color"], bsdf.inputs["Metallic"])
    MATS["copper"] = mat

    mat, nt, bsdf = mat_simple("M_Awning_Canvas", (0.55, 0.12, 0.1), 0.85)
    L = nt.links
    tc = _n(nt, "ShaderNodeTexCoord", (-1000, 0))
    oi = _n(nt, "ShaderNodeObjectInfo", (-1000, -300))
    sep = _n(nt, "ShaderNodeSeparateXYZ", (-800, 0))
    L.new(tc.outputs["Object"], sep.inputs["Vector"])
    s1 = _n(nt, "ShaderNodeMath", (-600, 0), operation="MULTIPLY")
    L.new(sep.outputs["X"], s1.inputs[0])
    s1.inputs[1].default_value = 2 * pi / 0.24
    s2 = _n(nt, "ShaderNodeMath", (-450, 0), operation="SINE")
    L.new(s1.outputs[0], s2.inputs[0])
    s3 = _n(nt, "ShaderNodeMath", (-300, 0), operation="GREATER_THAN")
    L.new(s2.outputs[0], s3.inputs[0])
    s3.inputs[1].default_value = 0.0
    stripe = _n(nt, "ShaderNodeMixRGB", (-150, 0), Color1=(0.78, 0.74, 0.64, 1), Color2=(0.5, 0.08, 0.06, 1))
    L.new(s3.outputs[0], stripe.inputs["Fac"])
    pick = _n(nt, "ShaderNodeMath", (-450, -300), operation="GREATER_THAN")
    L.new(oi.outputs["Random"], pick.inputs[0])
    pick.inputs[1].default_value = 0.78
    final = _n(nt, "ShaderNodeMixRGB", (0, 0), Color1=(0.78, 0.75, 0.66, 1))
    L.new(pick.outputs[0], final.inputs["Fac"])
    L.new(stripe.outputs["Color"], final.inputs["Color2"])
    L.new(final.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Subsurface Weight"].default_value = 0.0
    bsdf.inputs["Transmission Weight"].default_value = 0.0
    MATS["awning"] = mat


# --------------------------------------------------------------------------
# Object creation
# --------------------------------------------------------------------------
KIT = {}


def finish(mb, name, coll):
    bm = mb.bm
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            c = lp.vert.co
            u, v = ((c.y, c.z), (c.x, c.z), (c.x, c.y))[ax]
            lp[uv].uv = (u * 0.5, v * 0.5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for n in MAT_NAMES:
        me.materials.append(MATS[n])
    me.set_sharp_from_angle(angle=radians(40))
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    KIT[name] = ob
    return ob


def build_kit(coll):
    pieces = [
        ("SM_Wall_Ground_Shop", piece_wall_ground_shop),
        ("SM_Wall_Ground_Entrance", piece_wall_entrance),
        ("SM_Wall_Base_Rustic", piece_wall_base),
        ("SM_Wall_Win_Hood", piece_wall_hood),
        ("SM_Wall_Win_Shaft", piece_wall_shaft),
        ("SM_Wall_Arch_2F", piece_wall_arch),
        ("SM_Wall_Colonnade_2F", piece_wall_colonnade),
        ("SM_Pier_Corner_Ground", piece_pier_ground),
        ("SM_Pier_Corner_Rustic", lambda: pier(FL, 0.56, "stone", 0.06)),
        ("SM_Pier_Corner_Shaft", lambda: pier(FL, 0.48, "stone", 0.03)),
        ("SM_Window_Shop", piece_window_shop),
        ("SM_Door_Entrance", piece_door_entrance),
        ("SM_Window_Sash", piece_window_sash),
        ("SM_Window_Arch_2F", piece_window_arch),
        ("SM_Cornice_Main", lambda: piece_cornice("main")),
        ("SM_Cornice_Main_Corner", lambda: piece_cornice("main", True)),
        ("SM_Cornice_Mid", lambda: piece_cornice("mid")),
        ("SM_Cornice_Mid_Corner", lambda: piece_cornice("mid", True)),
        ("SM_Cornice_Base", lambda: piece_cornice("base")),
        ("SM_Cornice_Base_Corner", lambda: piece_cornice("base", True)),
        ("SM_String_Course", lambda: piece_cornice("string")),
        ("SM_String_Course_Corner", lambda: piece_cornice("string", True)),
        ("SM_Balcony", piece_balcony),
        ("SM_Balcony_Corner", lambda: piece_balcony(True)),
        ("SM_Balustrade", piece_balustrade),
        ("SM_Balustrade_Corner", lambda: piece_balustrade(True)),
        ("SM_Balconette", piece_balconette),
        ("SM_Column_2F", piece_column),
        ("SM_Awning", piece_awning),
        ("SM_Urn", piece_urn),
        ("SM_Roof_Slab", piece_roof),
        ("SM_Tempietto", piece_tempietto),
        ("SM_Dome", piece_dome),
        ("SM_Lantern", piece_lantern),
        ("SM_Mansard", piece_mansard),
        ("SM_Mansard_Corner", lambda: piece_mansard(True)),
        ("SM_Water_Tank", piece_water_tank),
        ("SM_Lamp_Post", piece_lamp_post),
    ]
    for name, fn in pieces:
        finish(fn(), name, coll)


# Material variants of kit pieces for the neighbouring buildings: same meshes,
# different facade materials (red / brown brick, buff terracotta).
VARIANTS = {
    "_BrickRed": {"stone": "brick_red", "stone_trim": "brownstone"},
    "_BrickBrown": {"stone": "brick_brown", "stone_trim": "buff"},
    "_Buff": {"stone": "buff", "stone_trim": "buff_trim"},
}
VARIANT_PIECES = ["SM_Wall_Ground_Shop", "SM_Wall_Win_Shaft", "SM_Wall_Win_Hood", "SM_Pier_Corner_Ground",
                  "SM_Pier_Corner_Shaft", "SM_Cornice_Mid", "SM_Cornice_Mid_Corner", "SM_String_Course",
                  "SM_String_Course_Corner", "SM_Mansard", "SM_Mansard_Corner"]


def build_variants(coll):
    for suffix, remap in VARIANTS.items():
        for name in VARIANT_PIECES:
            me = KIT[name].data.copy()
            me.name = name + suffix
            for i, mat in enumerate(me.materials):
                key = MAT_NAMES[i]
                if key in remap:
                    me.materials[i] = MATS[remap[key]]
            ob = bpy.data.objects.new(name + suffix, me)
            coll.objects.link(ob)
            ob.hide_render = True
            ob.location = (0, 0, -500)
            KIT[name + suffix] = ob


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------
class Assembler:
    def __init__(self, coll, root):
        self.coll, self.root, self.count = coll, root, 0

    def put(self, piece, M):
        ob = bpy.data.objects.new(f"{piece}.{self.count:04d}", KIT[piece].data)
        self.count += 1
        ob.matrix_basis = M
        ob.parent = self.root
        self.coll.objects.link(ob)
        return ob


def facades(ox, oy, nx, ny):
    w, d = 2 * P + nx * BAY, 2 * P + ny * BAY
    return [((ox, oy), 0, nx, "S"), ((ox + w, oy), 90, ny, "E"),
            ((ox + w, oy + d), 180, nx, "N"), ((ox, oy + d), 270, ny, "W")]


def ring(A, ox, oy, nx, ny, z, wall=None, pier=None, inserts=(), corner=None, straight=None,
         skip=(), extra=None, sides="SENW", var=""):
    """Place one storey (or one horizontal band) of modules around a rectangular block."""
    for (fx, fy), rot, n, name in facades(ox, oy, nx, ny):
        if name not in sides:
            continue
        F = TR(fx, fy, 0) @ RZ(rot)
        if pier:
            pname, dzs = pier if isinstance(pier, tuple) else (pier, (0.0,))
            for dz in dzs:
                A.put(pname + var, F @ TR(0, 0, z + dz))
        if corner:
            A.put(corner + var, F @ TR(0, 0, z))
        for i in range(n):
            if (name, i) in skip:
                continue
            B = F @ TR(P + i * BAY, 0, z)
            if wall:
                A.put(wall + var, B)
            if straight:
                A.put(straight + var, B)
            for piece, dy, dz in inserts:
                A.put(piece, B @ TR(0, dy, dz))
            if extra:
                extra(name, i, n, B)


def assemble(coll, root, seed=7):
    rnd = random.Random(seed)
    A = Assembler(coll, root)
    ox = oy = 0.0
    ENT = ("E", 7)
    SASH = [("SM_Window_Sash", 0, 0)]

    def awnings(p):
        def f(name, i, n, B):
            if rnd.random() < p:
                A.put("SM_Awning", B)
        return f

    # F0 ground floor (+ two-storey entrance on Nassau St)
    ring(A, ox, oy, NX, NY, 0.0, "SM_Wall_Ground_Shop", "SM_Pier_Corner_Ground",
         [("SM_Window_Shop", 0, 0)], skip={ENT})
    F = TR(W, 0, 0) @ RZ(90) @ TR(P + ENT[1] * BAY, 0, 0)
    A.put("SM_Wall_Ground_Entrance", F)
    A.put("SM_Door_Entrance", F)
    ring(A, ox, oy, NX, NY, GF - 0.3, corner="SM_String_Course_Corner", straight="SM_String_Course", skip={ENT})
    z = GF
    # F1-F2 rusticated base
    for f in range(2):
        ring(A, ox, oy, NX, NY, z, "SM_Wall_Base_Rustic", "SM_Pier_Corner_Rustic", SASH,
             skip={ENT} if f == 0 else (), extra=awnings(0.35))
        z += FL
    ring(A, ox, oy, NX, NY, z - 0.35, corner="SM_Cornice_Base_Corner", straight="SM_Cornice_Base")
    # F3 hooded windows
    ring(A, ox, oy, NX, NY, z, "SM_Wall_Win_Hood", "SM_Pier_Corner_Shaft", SASH, extra=awnings(0.4))
    z += FL
    ring(A, ox, oy, NX, NY, z - 0.12, corner="SM_String_Course_Corner", straight="SM_String_Course")
    # F4-F11 shaft, balconettes on two levels
    shaft_aw = awnings(0.45)
    for f in range(8):
        def extra(name, i, n, B, f=f):
            if f in (3, 6) and (name in "SN" or i in (0, n - 1)):
                A.put("SM_Balconette", B @ TR(0, 0, WIN[2] - 0.16))
            elif f not in (3, 6):
                shaft_aw(name, i, n, B)
        ring(A, ox, oy, NX, NY, z, "SM_Wall_Win_Shaft", "SM_Pier_Corner_Shaft", SASH, extra=extra)
        z += FL
    # F12-F13 arcade with continuous balcony
    ring(A, ox, oy, NX, NY, z, "SM_Wall_Arch_2F", ("SM_Pier_Corner_Shaft", (0.0, FL)), [("SM_Window_Arch_2F", 0, 0)])
    ring(A, ox, oy, NX, NY, z + 0.38, corner="SM_Balcony_Corner", straight="SM_Balcony")
    z += 2 * FL
    # F14
    ring(A, ox, oy, NX, NY, z, "SM_Wall_Win_Shaft", "SM_Pier_Corner_Shaft", SASH, extra=awnings(0.3))
    z += FL
    ring(A, ox, oy, NX, NY, z - 0.2, corner="SM_Cornice_Mid_Corner", straight="SM_Cornice_Mid")
    ctop = z - 0.2 + 0.86

    def columns(z0, h, dy=-0.3):
        def f(name, i, n, B):
            if i > 0:
                A.put("SM_Column_2F", B @ TR(0, dy, z0 - B.translation.z) @ Matrix.Diagonal((1, 1, h / COL_H, 1)))
        return f
    # F15-F16 colonnade crown
    ring(A, ox, oy, NX, NY, z, "SM_Wall_Colonnade_2F", ("SM_Pier_Corner_Rustic", (0.0, FL)),
         [("SM_Window_Sash", 0.25, 0.0), ("SM_Window_Sash", 0.25, FL)], extra=columns(ctop, z + 2 * FL - ctop))
    z += 2 * FL
    ring(A, ox, oy, NX, NY, z - 0.5, corner="SM_Cornice_Main_Corner", straight="SM_Cornice_Main")
    roof = z - 0.5 + 1.54
    A.put("SM_Roof_Slab", TR(0.05, 0.05, z - 1.0) @ Matrix.Diagonal((W - 0.1, D - 0.1, roof - z + 1.0, 1)))
    ring(A, ox, oy, NX, NY, roof, corner="SM_Balustrade_Corner", straight="SM_Balustrade")
    for (fx, fy), rot, n, name in facades(ox, oy, NX, NY):
        A.put("SM_Urn", TR(fx, fy, roof + 1.11) @ RZ(rot))

    # ---------------- tower: 3 storeys + cupola ----------------
    TN = 2
    TW = 2 * P + TN * BAY
    tx, ty = (W - TW) / 2, (W - TW) / 2
    z = roof
    A.put("SM_Roof_Slab", TR(tx + 0.05, ty + 0.05, z - 0.5) @ Matrix.Diagonal((TW - 0.1, TW - 0.1, 0.5, 1)))
    ring(A, tx, ty, TN, TN, z, "SM_Wall_Win_Shaft", "SM_Pier_Corner_Shaft", SASH)
    z += FL
    ring(A, tx, ty, TN, TN, z - 0.12, corner="SM_String_Course_Corner", straight="SM_String_Course")
    ring(A, tx, ty, TN, TN, z, "SM_Wall_Arch_2F", ("SM_Pier_Corner_Shaft", (0.0, FL)),
         [("SM_Window_Arch_2F", 0, 0)], extra=columns(z + 0.22, 2 * FL - 0.22))
    z += 2 * FL
    ring(A, tx, ty, TN, TN, z - 0.5, corner="SM_Cornice_Main_Corner", straight="SM_Cornice_Main")
    ttop = z - 0.5 + 1.54
    A.put("SM_Roof_Slab", TR(tx + 0.05, ty + 0.05, z - 1.0) @ Matrix.Diagonal((TW - 0.1, TW - 0.1, ttop - z + 1.0, 1)))
    ring(A, tx, ty, TN, TN, ttop, corner="SM_Balustrade_Corner", straight="SM_Balustrade")
    for (fx, fy), rot, n, name in facades(tx, ty, TN, TN):
        A.put("SM_Urn", TR(fx, fy, ttop + 1.11) @ RZ(rot))
    c = (tx + TW / 2, ty + TW / 2)
    A.put("SM_Tempietto", TR(c[0], c[1], ttop))
    zd = ttop + 7.42 * CUPOLA
    A.put("SM_Dome", TR(c[0], c[1], zd))
    dome_top = zd + CUPOLA * (0.18 + 3.1 * sin(math.acos(0.58 / 2.2)))
    A.put("SM_Lantern", TR(c[0], c[1], dome_top - 0.05 * CUPOLA))
    return A.count, dome_top + 4.75 * CUPOLA


def neighbour(A, rnd, ox, oy, nx, ny, floors, var, mansard=False, sides="SENW", tank=False, aw=0.2):
    """A plain commercial block built from material variants of the same kit."""
    w, d = 2 * P + nx * BAY, 2 * P + ny * BAY

    def awn(name, i, n, B):
        if rnd.random() < aw:
            A.put("SM_Awning", B)
    ring(A, ox, oy, nx, ny, 0.0, "SM_Wall_Ground_Shop", "SM_Pier_Corner_Ground", [("SM_Window_Shop", 0, 0)],
         var=var, sides=sides)
    ring(A, ox, oy, nx, ny, GF - 0.3, corner="SM_String_Course", straight="SM_String_Course", var=var, sides=sides)
    z = GF
    for f in range(floors):
        ring(A, ox, oy, nx, ny, z, "SM_Wall_Win_Hood" if f == 0 else "SM_Wall_Win_Shaft", "SM_Pier_Corner_Shaft",
             [("SM_Window_Sash", 0, 0)], extra=awn, var=var, sides=sides)
        z += FL
    ring(A, ox, oy, nx, ny, z - 0.2, corner="SM_Cornice_Mid_Corner", straight="SM_Cornice_Mid", var=var,
         sides=sides)
    top = z - 0.2 + 0.86
    A.put("SM_Roof_Slab", TR(ox + 0.05, oy + 0.05, z - 0.5) @ Matrix.Diagonal((w - 0.1, d - 0.1, top - z + 0.5, 1)))
    if mansard:
        ring(A, ox, oy, nx, ny, top, corner="SM_Mansard_Corner", straight="SM_Mansard", var=var, sides=sides)
        A.put("SM_Roof_Slab", TR(ox + 1.0, oy + 1.0, top) @ Matrix.Diagonal((w - 2.0, d - 2.0, MANSARD_H, 1)))
        top += MANSARD_H
    if tank:
        A.put("SM_Water_Tank", TR(ox + w * 0.65, oy + d * 0.6, top))
    for k in range(int(w // 6) + 1):
        A.put("SM_Roof_Slab", TR(ox + 0.3 + k * 5.5, oy + d - 1.2, top) @ Matrix.Diagonal((0.9, 0.7, 1.6, 1)))
    return top


def build_neighbours(coll, root, seed=11):
    rnd = random.Random(seed)
    A = Assembler(coll, root)
    nb = []
    # west of the Gillender along Wall St: red brick with a tiled mansard (as in the photo)
    nb.append(neighbour(A, rnd, -0.3 - (2 * P + 7 * BAY), 0.0, 7, 10, 6, "_BrickRed", mansard=True, aw=0.35))
    nb.append(neighbour(A, rnd, -0.6 - 2 * (2 * P + 7 * BAY) + 2.0, 0.0, 6, 10, 4, "_BrickBrown", mansard=True,
                        tank=True))
    # north along Nassau St
    nb.append(neighbour(A, rnd, 0.0, D + 0.3, NX + 1, 7, 10, "_BrickBrown", tank=True, sides="SEN"))
    nb.append(neighbour(A, rnd, 0.0, D + 0.3 + 2 * P + 7 * BAY + 0.3, NX + 2, 8, 7, "_Buff", tank=True))
    # across Nassau St
    nb.append(neighbour(A, rnd, W + 18.0, 4.0, 5, 8, 8, "_Buff", aw=0.3))
    nb.append(neighbour(A, rnd, W + 18.0, 4.0 + 2 * P + 8 * BAY + 0.3, 6, 7, 12, "_BrickRed", tank=True))
    # tall white office block behind, like the one behind the Gillender in the photo
    nb.append(neighbour(A, rnd, -24.0, 30.0, 6, 6, 15, "_Buff", tank=True))
    # fill the surrounding blocks so the street scene reads as a dense downtown
    x = -30.5
    for k, (nx, fl, var) in enumerate(((5, 9, "_Buff"), (6, 5, "_BrickRed"), (5, 12, "_BrickBrown"))):
        x -= 2 * P + nx * BAY + 0.3
        nb.append(neighbour(A, rnd, x, 0.0, nx, 10, fl, var, mansard=k == 1, tank=k != 1))
    y_s = -4.0 - 14.0 - 4.0 - 0.3 - (2 * P + 8 * BAY)
    x = -60.0
    for nx, fl, var in ((6, 7, "_BrickBrown"), (5, 10, "_Buff"), (6, 6, "_BrickRed"), (4, 13, "_Buff")):
        nb.append(neighbour(A, rnd, x, y_s, nx, 8, fl, var, tank=True, sides="NEW"))
        x += 2 * P + nx * BAY + 0.3
    for (x0, y0, nx, ny, fl, var) in ((-50, 30, 5, 6, 18, "_BrickBrown"), (-6, 50, 6, 6, 20, "_Buff"),
                                      (W + 22, 60, 6, 6, 16, "_Buff"), (-40, 55, 6, 5, 11, "_BrickRed")):
        nb.append(neighbour(A, rnd, x0, y0, nx, ny, fl, var, tank=True, aw=0.1))
    return A.count


# --------------------------------------------------------------------------
# Scene: context, lights, cameras, render
# --------------------------------------------------------------------------
def mesh_obj(name, mb, coll, mats):
    bm = mb.bm
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            lp[uv].uv = (lp.vert.co.x * 0.5, lp.vert.co.y * 0.5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mt in mats:
        me.materials.append(mt)
    me.set_sharp_from_angle(angle=radians(40))
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def build_context(coll, root):
    """Streets with stone setts, paved sidewalks with granite curbs, lamp posts."""
    road = MB()
    road.box(-20000, -20000, -0.3, 20000, 20000, 0.0, "roof")
    for f in road.bm.faces:
        f.material_index = 0
    mesh_obj("Street_Setts", road, coll, [MATS["setts"]])

    walk = MB()

    def paving(x0, y0, x1, y1, tile=1.5):
        nx_, ny_ = max(1, round((x1 - x0) / tile)), max(1, round((y1 - y0) / tile))
        tx_, ty_ = (x1 - x0) / nx_, (y1 - y0) / ny_
        for i in range(nx_):
            for j in range(ny_):
                walk.box(x0 + i * tx_ + 0.008, y0 + j * ty_ + 0.008, 0.0,
                         x0 + (i + 1) * tx_ - 0.008, y0 + (j + 1) * ty_ - 0.008, 0.15, "roof", bev=0.012)
        walk.box(x0, y0, -0.05, x1, y1, 0.13, "roof")

    def curb(x0, y0, x1, y1):
        walk.box(x0, y0, -0.05, x1, y1, 0.17, "granite", bev=0.025)

    SW = 4.0
    # Wall St (south) and Nassau St (east) sidewalks on the Gillender side
    paving(-80, -SW, W + SW, 0.0)
    paving(W, 0.0, W + SW, 90.0)
    curb(-80, -SW - 0.3, W + SW + 0.3, -SW)
    curb(W + SW, -SW - 0.3, W + SW + 0.3, 90.0)
    # opposite sidewalks
    paving(-80, -SW - 14.0 - SW, W + SW + 14.0, -SW - 14.0)
    paving(W + SW + 14.0, -SW - 14.0, W + SW + 14.0 + SW, 90.0)
    curb(-80, -SW - 14.0, W + SW + 14.0, -SW - 13.7)
    curb(W + SW + 13.7, -SW - 14.0, W + SW + 14.0, 90.0)
    ob = mesh_obj("Sidewalks", walk, coll, [MATS["paving"]] + [MATS["granite"]])
    for p in ob.data.polygons:
        p.material_index = 1 if p.material_index == MI["granite"] else 0

    A = Assembler(coll, root)
    for x in (-40, -22, -4, W + 0.5):
        A.put("SM_Lamp_Post", TR(x, -SW + 0.45, 0.15) @ RZ(90))
    for y in (8, 26, 44):
        A.put("SM_Lamp_Post", TR(W + SW - 0.45, y, 0.15))
    for x in (-30, -10, W + 8):
        A.put("SM_Lamp_Post", TR(x, -SW - 13.55, 0.15) @ RZ(90))


def setup_world(kind):
    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    if kind == "sky":
        sky = nt.nodes.new("ShaderNodeTexSky")
        sky.sky_type = "NISHITA"
        sky.sun_disc = False
        sky.sun_elevation = radians(39)
        sky.sun_rotation = radians(67)
        sky.air_density = 1.2
        sky.dust_density = 2.5
        nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 0.17
    else:
        bg.inputs["Color"].default_value = (0.045, 0.047, 0.05, 1)
        bg.inputs["Strength"].default_value = 1.0
        bpy.context.scene.use_nodes = False


def setup_haze(scene, on, color=(0.66, 0.72, 0.8), amount=0.32):
    """Aerial perspective: blend the render toward a haze colour using the mist pass."""
    scene.use_nodes = on
    if not on:
        return
    scene.view_layers[0].use_pass_mist = True
    ms = scene.world.mist_settings
    ms.start, ms.depth, ms.falloff = 25.0, 900.0, "LINEAR"
    nt = scene.node_tree
    nt.nodes.clear()
    rl = nt.nodes.new("CompositorNodeRLayers")
    mul = nt.nodes.new("CompositorNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = amount
    nt.links.new(rl.outputs["Mist"], mul.inputs[0])
    mix = nt.nodes.new("CompositorNodeMixRGB")
    mix.inputs[2].default_value = (*color, 1)
    nt.links.new(mul.outputs[0], mix.inputs[0])
    nt.links.new(rl.outputs["Image"], mix.inputs[1])
    comp = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(mix.outputs[0], comp.inputs["Image"])


def add_sun(coll):
    sd = bpy.data.lights.new("Sun", "SUN")
    sd.energy = 6.0
    sd.angle = radians(1.5)
    sd.color = (1.0, 0.95, 0.88)
    sun = bpy.data.objects.new("Sun", sd)
    coll.objects.link(sun)
    d = Vector((-0.72, -0.3, -0.62)).normalized()   # from the east-north-east, raking the long facade
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return sun


def add_camera(name, loc, target, lens, coll):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_end = 2000
    cam = bpy.data.objects.new(name, cd)
    coll.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return cam


def layout_kit(kit_objs, x_right, target_h, gap=0.9):
    """Stack kit pieces into columns (like a kit sheet) ending at x_right."""
    items = []
    for ob in kit_objs:
        vs = [v.co for v in ob.data.vertices]
        mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
        mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
        items.append((ob, mn, mx))
    cols, cur, h = [], [], 0.0
    for it in items:
        hh = it[2].z - it[1].z + gap
        if cur and h + hh > target_h:
            cols.append(cur)
            cur, h = [], 0.0
        cur.append(it)
        h += hh
    cols.append(cur)
    widths = [max(it[2].x - it[1].x for it in c) for c in cols]
    x = x_right - sum(widths) - gap * (len(cols) - 1)
    for c, wdt in zip(cols, widths):
        z = 0.0
        for ob, mn, mx in c:
            ob.location = (x + (wdt - (mx.x - mn.x)) / 2 - mn.x, -mn.y * 0.0, z - mn.z)
            z += mx.z - mn.z + gap
        x += wdt + gap
    return x_right - sum(widths) - gap * (len(cols) - 1)


def export_glb(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    swaps = {}
    for mat in bpy.data.materials:
        if "export_color" in mat:
            em = bpy.data.materials.new(mat.name + "_gltf")
            em.use_nodes = True
            b = em.node_tree.nodes["Principled BSDF"]
            b.inputs["Base Color"].default_value = (*mat["export_color"], 1)
            b.inputs["Roughness"].default_value = mat.get("export_rough", 0.8)
            b.inputs["Metallic"].default_value = mat.get("export_metal", 0.0)
            swaps[mat] = em
    meshes = {ob.data for ob in objects if ob.type == "MESH"}
    saved = {}
    for me in meshes:
        saved[me] = list(me.materials)
        for i, m in enumerate(me.materials):
            if m in swaps:
                me.materials[i] = swaps[m]
    for ob in objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True)
    for me, mats in saved.items():
        for i, m in enumerate(mats):
            me.materials[i] = m
    for em in swaps.values():
        bpy.data.materials.remove(em)
    bpy.ops.object.select_all(action="DESELECT")


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--samples", type=int, default=128)
    ap.add_argument("--scale", type=int, default=100, help="resolution percentage")
    ap.add_argument("--ref", default="", help="optional reference photo for the breakdown render")
    ap.add_argument("--only", default="", help="render only: hero, breakdown, kit")
    args, _ = ap.parse_known_args(argv)
    os.makedirs(args.out, exist_ok=True)

    reset_scene()
    scene = bpy.context.scene
    scene.name = "Gillender"
    scene.unit_settings.system = "METRIC"
    make_materials()

    def new_coll(name, parent=None):
        c = bpy.data.collections.new(name)
        (parent or scene.collection).children.link(c)
        return c

    c_kit = new_coll("Gillender_Kit")
    c_bld = new_coll("Gillender_Building")
    c_ctx = new_coll("Context")
    c_rig = new_coll("Lights_Cameras")

    c_var = new_coll("Kit_Variants")
    build_kit(c_kit)
    build_variants(c_var)
    root = bpy.data.objects.new("Gillender_Root", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 5
    c_bld.objects.link(root)
    count, top = assemble(c_bld, root)
    print(f"[gillender] kit pieces: {len(c_kit.objects)}  instances: {count}  height: {top:.1f} m")

    ctx_root = bpy.data.objects.new("Context_Root", None)
    c_ctx.objects.link(ctx_root)
    n_ctx = build_neighbours(c_ctx, ctx_root)
    build_context(c_ctx, ctx_root)
    print(f"[gillender] context instances: {n_ctx}")
    add_sun(c_rig)
    hero = add_camera("CAM_Hero", (W + 44, -46, 27), (W * 0.45, D * 0.3, 40.5), 30, c_rig)
    add_camera("CAM_Photo", (W + 30, -36, 34), (W * 0.3, D * 0.35, 43), 28, c_rig)
    add_camera("CAM_Detail_Mid", (W + 13.5, -14, 47), (W - 0.5, 0, 50.5), 40, c_rig)
    add_camera("CAM_Detail_Top", (W / 2 + 14, -13, 75), (W / 2, 3.9, 72.5), 40, c_rig)
    scene.camera = hero

    # kit sheet column layout, parked away from the street scene
    kit_objs = list(c_kit.objects)
    layout_kit(kit_objs, -150.0, 34.0)

    if args.ref and os.path.exists(args.ref):
        img = bpy.data.images.load(args.ref)
        img.pack()
        w, h = img.size
        ph = 80.0
        pw = ph * w / h
        mat = bpy.data.materials.new("M_Reference")
        mat.use_nodes = True
        nt = mat.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(tex.outputs["Color"], em.inputs["Color"])
        em.inputs["Strength"].default_value = 1.0
        out = nt.nodes["Material Output"]
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        nt.nodes.remove(nt.nodes["Principled BSDF"])
        mb = MB()
        bm = mb.bm
        vs = [bm.verts.new(c) for c in ((0, 0, 0), (pw, 0, 0), (pw, 0, ph), (0, 0, ph))]
        f = bm.faces.new(vs)
        uvl = bm.loops.layers.uv.new("UVMap")
        for lp, uvc in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            lp[uvl].uv = uvc
        me = bpy.data.meshes.new("Reference_Photo")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        ref = bpy.data.objects.new("Reference_Photo", me)
        c_rig.objects.link(ref)
        kit_left = min(o.location.x for o in kit_objs)
        ref.location = (kit_left - 6.0 - pw, 0.4, 0.0)
        ref.hide_render = True

    if args.render:
        render_all(args)
        scene = bpy.context.scene
        scene.camera = bpy.data.objects["CAM_Hero"]
        setup_world("sky")
        for ob in bpy.data.objects:
            ob.hide_render = ob.name == "Reference_Photo" or ob.name in bpy.data.collections["Kit_Variants"].objects
        setup_haze(scene, True)

    blend = os.path.join(args.out, "gillender_modular.blend")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    print("[gillender] saved", blend)

    kit_objs = list(bpy.data.collections["Gillender_Kit"].objects)
    root = bpy.data.objects["Gillender_Root"]
    export_glb(os.path.join(args.out, "gillender_kit.glb"), kit_objs)
    export_glb(os.path.join(args.out, "gillender_building.glb"), [root] + list(root.children))
    print("[gillender] exported glb")


def world_bounds(objs):
    pts = [ob.matrix_world @ Vector(c) for ob in objs if ob.type == "MESH" for c in ob.bound_box]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


def frame_camera(name, mn, mx, res, lens, coll, margin=1.08, ortho=False, elev=0.0):
    """Front (-Y) camera that fits the XZ bounds mn..mx at resolution res."""
    cx, cz = (mn.x + mx.x) / 2, (mn.z + mx.z) / 2
    hw, hh = (mx.x - mn.x) / 2 * margin, (mx.z - mn.z) / 2 * margin
    aspect = res[0] / res[1]
    hw = max(hw, hh * aspect)
    if ortho:
        cam = add_camera(name, (cx, mn.y - 150, cz), (cx, 0, cz), lens, coll)
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 2 * hw
        return cam
    dist = hw / (18.0 / lens) + (0 - mn.y)
    cam = add_camera(name, (cx, mn.y - dist, cz + elev), (cx, 0, cz + elev * 0.2), lens, coll)
    return cam


def render_all(args):
    # re-fetch everything by name: saving/exporting can invalidate python ID references
    scene = bpy.context.scene
    c_kit, c_bld, c_ctx, c_rig = (bpy.data.collections[n] for n in
                                  ("Gillender_Kit", "Gillender_Building", "Context", "Lights_Cameras"))
    root = bpy.data.objects["Gillender_Root"]
    ref = bpy.data.objects.get("Reference_Photo")
    bpy.context.view_layer.update()
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.device = "CPU"
    cy.samples = args.samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.max_bounces = 8
    cy.transmission_bounces = 6
    cy.glossy_bounces = 4
    cy.sample_clamp_indirect = 8.0
    scene.render.resolution_percentage = args.scale
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    only = set(args.only.split(",")) if args.only else {"hero", "photo", "detail", "breakdown", "kit"}

    def show(kit, bld, ctx, refv):
        for c, v in ((c_kit, kit), (c_bld, bld), (c_ctx, ctx)):
            for ob in c.objects:
                ob.hide_render = not v
        if ref:
            ref.hide_render = not refv

    def shot(cam, res, path):
        scene.camera = cam
        scene.render.resolution_x, scene.render.resolution_y = res
        scene.render.filepath = os.path.join(args.out, path)
        bpy.ops.render.render(write_still=True)
        print("[gillender] rendered", path)

    if only & {"hero", "photo", "detail"}:
        setup_world("sky")
        setup_haze(scene, True)
        show(False, True, True, False)
        if "hero" in only:
            shot(bpy.data.objects["CAM_Hero"], (1200, 1600), "render_hero.png")
        if "photo" in only:
            shot(bpy.data.objects["CAM_Photo"], (1200, 1600), "render_photo_match.png")
        if "detail" in only:
            setup_haze(scene, False)
            shot(bpy.data.objects["CAM_Detail_Mid"], (1200, 1200), "render_detail_mid.png")
            shot(bpy.data.objects["CAM_Detail_Top"], (1200, 1200), "render_detail_top.png")
        setup_haze(scene, False)

    if "breakdown" in only:
        setup_world("studio")
        show(True, True, False, True)
        kit_objs = list(c_kit.objects)
        saved_locs = [ob.location.copy() for ob in kit_objs]
        left = layout_kit(kit_objs, 2.0, 55.0, gap=1.0)
        if ref:
            ref.location.x = left - 8.0 - ref.dimensions.x
        root.rotation_euler = (0, 0, radians(-32))
        root.location = (8.0, 0, 0)
        bpy.context.view_layer.update()
        objs = list(c_kit.objects) + list(root.children) + ([ref] if ref else [])
        mn, mx = world_bounds(objs)
        cam = frame_camera("CAM_Breakdown", mn, mx, (2000, 1300), 85, c_rig, margin=1.06, elev=12)
        shot(cam, (2000, 1300), "render_breakdown.png")
        root.rotation_euler = (0, 0, 0)
        root.location = (0, 0, 0)
        for ob, loc in zip(kit_objs, saved_locs):
            ob.location = loc
        bpy.context.view_layer.update()

    if "kit" in only:
        setup_world("studio")
        show(True, False, False, False)
        mn, mx = world_bounds(list(c_kit.objects))
        cam = frame_camera("CAM_KitSheet", mn, mx, (1800, 1500), 50, c_rig, margin=1.06, ortho=True)
        shot(cam, (1800, 1500), "render_kit_sheet.png")

def reset_scene():
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        return
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                 bpy.data.cameras, bpy.data.collections, bpy.data.images):
        for item in list(coll):
            coll.remove(item)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
