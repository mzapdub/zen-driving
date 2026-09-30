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
BAY, P, T = 2.6, 1.0, 0.40
FL, GF = 3.6, 5.0
NX, NY = 4, 9                      # bays on the short (front) and long side
W, D = 2 * P + NX * BAY, 2 * P + NY * BAY
WIN = (0.70, 1.90, 0.85, 3.10)     # standard window opening (x0, x1, z0, z1)
SHOP = (0.35, 2.25, 0.55, 4.35)
ATT = (0.80, 1.80, 0.55, 1.95)
ARCH = (0.55, 2.05, 0.85, 5.75)    # x0, x1, sill, springing (r = 0.75)
DOOR = (0.40, 2.20, 0.0, 5.20)
COL_H = 6.6

MAT_NAMES = ["stone", "stone_trim", "granite", "glass", "frame", "iron",
             "copper", "awning", "roof", "void", "gilt"]
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

    def window(self, x0, x1, z0, z1, y=0.2, fw=0.07, rail=True, mull=False):
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
        self.box(x0 + fw * 0.5, y + 0.005, z0 + fw * 0.5, x1 - fw * 0.5, y + 0.02, z1 - fw * 0.5, "glass")


# --------------------------------------------------------------------------
# Kit pieces
# --------------------------------------------------------------------------
def dentils(m, x0, x1, u0, u1, v0, v1, step=BAY / 16, w=0.09):
    n = int(round((x1 - x0) / step))
    for i in range(n):
        c = x0 + (i + 0.5) * step
        m.box(c - w / 2, -u1, v0, c + w / 2, -u0 + 0.02, v1, "stone_trim")


def modillion(m, x, w=0.16):
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
            xs = [0.5] if corner else [0.325 + 0.65 * i for i in range(4)]
            for x in xs:
                modillion(m, x)
        elif kind == "mid":
            dentils(m, 0.0 if not corner else 0.2, L, 0.20, 0.28, 0.30, 0.42, step=BAY / 18, w=0.08)
        m.pop()
    if corner and kind == "main":
        m.push(RZ(-45) @ TR(0, 0, 0))
        m.push(Matrix.Scale(1.35, 4, Vector((0, 1, 0))))
        modillion(m, 0.0, w=0.2)
        m.pop()
        m.pop()
    return m


def piece_cornice(kind, corner=False):
    prof = {"main": PROF_MAIN, "mid": PROF_MID, "base": PROF_BASE, "string": PROF_STRING}[kind]
    return cornice_piece(prof, BAY, 0.0, kind, corner)


def piece_wall_ground_shop():
    m = MB()
    m.coursed(0, BAY, 0, GF, [SHOP], GF / 8, "granite", block=1.3, recess=0.06, bev=0.025)
    m.box(0, -0.12, 0, BAY, T, 0.38, "granite", bev=0.02)
    m.box(SHOP[0] - 0.1, -0.08, SHOP[3], SHOP[1] + 0.1, 0.2, SHOP[3] + 0.36, "granite", bev=0.02)
    cx = (SHOP[0] + SHOP[1]) / 2
    m.prism([(cx - 0.16, SHOP[3] - 0.05), (cx + 0.16, SHOP[3] - 0.05), (cx + 0.22, SHOP[3] + 0.5),
             (cx - 0.22, SHOP[3] + 0.5)], -0.14, 0.12, "granite", bev=0.015)
    return m


def piece_wall_entrance():
    m = MB()
    ox0, ox1, sill, spring = DOOR
    cx, r = (ox0 + ox1) / 2, (ox1 - ox0) / 2
    m.arch_wall(0, BAY, 0, GF + FL, DOOR, "granite")
    m.box(0, -0.12, 0, ox0, T, 0.38, "granite", bev=0.02)
    m.box(ox1, -0.12, 0, BAY, T, 0.38, "granite", bev=0.02)
    # rusticated jamb blocks
    k = 0
    z = 0.38
    while z < spring - 0.1:
        h = min(0.6, spring - z)
        wid = 0.34 if k % 2 == 0 else 0.22
        m.box(ox0 - wid, -0.07, z + 0.015, ox0, 0.05, z + h - 0.015, "granite", bev=0.02)
        m.box(ox1, -0.07, z + 0.015, ox1 + wid, 0.05, z + h - 0.015, "granite", bev=0.02)
        z += h
        k += 1
    m.box(ox0 - 0.38, -0.12, spring - 0.2, ox0 + 0.02, 0.1, spring, "stone_trim", bev=0.02)
    m.box(ox1 - 0.02, -0.12, spring - 0.2, ox1 + 0.38, 0.1, spring, "stone_trim", bev=0.02)
    m.voussoirs(cx, spring, r, r + 0.36, 11, "granite", key=0.45)
    # soffit panel above the arch and a bracketed hood
    m.box(0.15, -0.12, GF + FL - 1.05, BAY - 0.15, 0.1, GF + FL - 0.85, "stone_trim", bev=0.02)
    return m


def piece_door_entrance():
    m = MB()
    ox0, ox1, sill, spring = DOOR
    cx, r = (ox0 + ox1) / 2, (ox1 - ox0) / 2
    y = 0.22
    tr = 3.5
    fw = 0.09
    # doors
    for a, b in ((ox0, cx), (cx, ox1)):
        m.box(a, y - 0.04, 0, b, y + 0.06, tr, "frame")
        m.box(a + 0.12, y - 0.06, 1.6, b - 0.12, y - 0.04, tr - 0.2, "glass")
        m.box(a + 0.14, y - 0.07, 0.2, b - 0.14, y - 0.05, 1.3, "frame", bev=0.02)
    m.box(ox0, y - 0.08, tr, ox1, y + 0.08, tr + 0.18, "frame")
    # transom + fanlight
    poly = [(ox0, tr + 0.18), (ox1, tr + 0.18), (ox1, spring)] + arc(cx, spring, r, 0, pi, 24)[1:-1] + [(ox0, spring)]
    m.prism(poly, y, y + 0.02, "glass")
    m.box(ox0, y - 0.05, spring - 0.04, ox1, y + 0.05, spring + 0.04, "frame")
    for x in (ox0 + (ox1 - ox0) / 3, ox0 + 2 * (ox1 - ox0) / 3):
        m.box(x - 0.035, y - 0.05, tr, x + 0.035, y + 0.05, spring, "frame")
    for i in range(1, 6):
        a = pi * i / 6
        m.push(TR(cx, 0, spring) @ RY(-math.degrees(a)))
        m.box(0, y - 0.04, -0.03, r, y + 0.04, 0.03, "frame")
        m.pop()
    m.vsweep([(-0.26, -fw), (-0.16, -fw), (-0.16, 0.0), (-0.26, 0.0)],
             [(ox0, 0.0), (ox0, spring)] + arc(cx, spring, r, pi, 0, 24)[1:-1] + [(ox1, spring), (ox1, 0.0)],
             "frame")
    return m


def piece_wall_base():
    m = MB()
    m.coursed(0, BAY, 0, FL, [WIN], 0.6, "stone", block=1.3, recess=0.06, bev=0.025)
    m.box(WIN[0] - 0.14, -0.14, WIN[2] - 0.15, WIN[1] + 0.14, 0.25, WIN[2], "stone_trim", bev=0.015)
    m.jack_arch(WIN[0], WIN[1], WIN[3], 0.45, "stone_trim")
    return m


def piece_wall_hood():
    m = MB()
    x0, x1, z0, z1 = WIN
    m.coursed(0, BAY, 0, FL, [WIN], 0.45, "stone", recess=0.03)
    m.vsweep(PROF_ARCHITRAVE, [(x0, z0), (x0, z1), (x1, z1), (x1, z0)], "stone_trim")
    m.box(x0 - 0.24, -0.1, z1 + 0.22, x1 + 0.24, 0.1, z1 + 0.5, "stone_trim", bev=0.015)
    m.hsweep(PROF_HOOD, [(x0 - 0.34, 0.12), (x0 - 0.34, -0.1), (x1 + 0.34, -0.1), (x1 + 0.34, 0.12)],
             z1 + 0.5, "stone_trim")
    for xa in (x0 - 0.36, x1 + 0.22):
        m.push(TR(0, -0.0, z1 - 0.35))
        m.prism(console_poly(0.85, 0.24), xa, xa + 0.14, "stone_trim", axis="x", bev=0.01)
        m.pop()
    m.box(x0 - 0.16, -0.16, z0 - 0.15, x1 + 0.16, 0.25, z0, "stone_trim", bev=0.015)
    for xa in (x0 - 0.1, x1 - 0.02):
        m.push(TR(0, 0, z0 - 0.5))
        m.prism(console_poly(0.35, 0.14), xa, xa + 0.12, "stone_trim", axis="x", bev=0.008)
        m.pop()
    return m


def piece_wall_shaft():
    m = MB()
    x0, x1, z0, z1 = WIN
    m.coursed(0, BAY, 0, FL, [WIN], 0.45, "stone", recess=0.03)
    m.box(x0 - 0.12, -0.12, z0 - 0.13, x1 + 0.12, 0.25, z0, "stone_trim", bev=0.015)
    m.box(x0 - 0.1, -0.04, z1, x1 + 0.1, 0.1, z1 + 0.34, "stone_trim", bev=0.012)
    cx = (x0 + x1) / 2
    m.prism([(cx - 0.12, z1 - 0.06), (cx + 0.12, z1 - 0.06), (cx + 0.16, z1 + 0.4), (cx - 0.16, z1 + 0.4)],
            -0.09, 0.1, "stone_trim", bev=0.01)
    return m


def piece_wall_arch():
    m = MB()
    ox0, ox1, sill, spring = ARCH
    cx, r = (ox0 + ox1) / 2, (ox1 - ox0) / 2
    m.coursed(0, BAY, 0, sill, [], sill, "stone", recess=0.03)
    m.arch_wall(0, BAY, sill, 2 * FL, (ox0, ox1, sill, spring), "stone")
    # rusticated channels on the piers of the arch bay
    for z in [sill + 0.45 * i for i in range(1, 11)]:
        for a, b in ((0.0, ox0 - 0.24), (ox1 + 0.24, BAY)):
            m.box(a, -0.012, z - 0.015, b, 0.02, z + 0.015, "stone")
    m.vsweep(PROF_ARCHIVOLT, [(ox0, sill), (ox0, spring)] + arc(cx, spring, r, pi, 0, 24)[1:-1]
             + [(ox1, spring), (ox1, sill)], "stone_trim")
    m.box(0, -0.12, sill - 0.14, BAY, 0.25, sill, "stone_trim", bev=0.015)
    top = spring + r
    m.prism([(cx - 0.14, top - 0.05), (cx + 0.14, top - 0.05), (cx + 0.22, top + 0.55), (cx - 0.22, top + 0.55)],
            -0.16, 0.1, "stone_trim", bev=0.015)
    m.box(ox0 - 0.3, -0.1, spring - 0.18, ox0 + 0.02, 0.1, spring, "stone_trim", bev=0.015)
    m.box(ox1 - 0.02, -0.1, spring - 0.18, ox1 + 0.3, 0.1, spring, "stone_trim", bev=0.015)
    # spandrel roundels
    for x in (0.28, BAY - 0.28):
        m.push(TR(x, -0.02, spring + 0.75) @ RX(90))
        m.lathe([(0.0, 0.0), (0.16, 0.0), (0.18, 0.03), (0.16, 0.06), (0.0, 0.07)], 24, "stone_trim")
        m.pop()
    return m


def piece_window_arch():
    m = MB()
    ox0, ox1, sill, spring = ARCH
    cx, r = (ox0 + ox1) / 2, (ox1 - ox0) / 2
    y = 0.2
    outline = [(ox0, sill), (ox0, spring)] + arc(cx, spring, r, pi, 0, 24)[1:-1] + [(ox1, spring), (ox1, sill)]
    m.vsweep(PROF_FRAME, outline, "frame", closed=True)
    m.prism(outline, y + 0.01, y + 0.025, "glass")
    m.box(ox0, y - 0.07, 3.3, ox1, y + 0.04, 3.95, "iron", bev=0.02)
    m.box(ox0 + 0.12, y - 0.09, 3.4, ox1 - 0.12, y - 0.06, 3.85, "iron", bev=0.015)
    m.box(ox0, y - 0.05, spring - 0.05, ox1, y + 0.05, spring + 0.05, "frame")
    m.box(cx - 0.035, y - 0.05, sill, cx + 0.035, y + 0.05, spring, "frame")
    m.box(ox0, y - 0.05, 2.05, ox1, y + 0.03, 2.13, "frame")
    m.box(ox0, y - 0.05, 4.8, ox1, y + 0.03, 4.88, "frame")
    for ang in (45, 135):
        m.push(TR(cx, 0, spring) @ RY(-ang))
        m.box(0, y - 0.04, -0.03, r, y + 0.04, 0.03, "frame")
        m.pop()
    return m


def piece_wall_colonnade():
    m = MB()
    dy = 0.25
    hi = (WIN[0], WIN[1], WIN[2] + FL, WIN[3] + FL)
    m.coursed(0, BAY, 0, 2 * FL, [WIN, hi], 0.6, "stone", recess=0.03, y0=dy, depth=T)
    for (x0, x1, z0, z1) in (WIN, hi):
        m.box(x0 - 0.12, dy - 0.12, z0 - 0.13, x1 + 0.12, dy + 0.25, z0, "stone_trim", bev=0.015)
        m.vsweep(PROF_ARCHITRAVE, [(x0, z0), (x0, z1), (x1, z1), (x1, z0)], "stone_trim", y=dy)
    m.box(WIN[0] - 0.05, dy - 0.05, WIN[3] + 0.3, WIN[1] + 0.05, dy + 0.1, hi[2] - 0.3, "stone_trim", bev=0.03)
    m.box(WIN[0] + 0.1, dy - 0.08, WIN[3] + 0.42, WIN[1] - 0.1, dy + 0.1, hi[2] - 0.42, "stone_trim", bev=0.03)
    m.box(0, dy - 0.1, 2 * FL - 0.45, BAY, dy + 0.2, 2 * FL, "stone_trim", bev=0.015)
    return m


def piece_column():
    m = MB()
    m.column(0, 0, 0, COL_H, 0.26, ped=0.75)
    return m


def piece_wall_attic():
    m = MB()
    x0, x1, z0, z1 = ATT
    m.coursed(0, BAY, 0, 2.8, [ATT], 0.7, "stone", recess=0.03)
    m.vsweep(PROF_ARCHITRAVE, [(x0, z0), (x0, z1), (x1, z1), (x1, z0)], "stone_trim")
    m.box(x0 - 0.14, -0.14, z0 - 0.12, x1 + 0.14, 0.25, z0, "stone_trim", bev=0.015)
    for x in (0.18, x1 + 0.34):
        m.box(x, -0.05, 0.6, x + 0.44, 0.1, 1.9, "stone_trim", bev=0.02)
        m.box(x + 0.08, -0.08, 0.72, x + 0.36, 0.1, 1.78, "stone_trim", bev=0.02)
    return m


def piece_window_sash():
    m = MB()
    m.window(*WIN)
    return m


def piece_window_attic():
    m = MB()
    m.window(*ATT, rail=False, mull=True)
    return m


def piece_window_shop():
    m = MB()
    x0, x1, z0, z1 = SHOP
    y = 0.14
    m.box(x0, y - 0.05, z0, x1, y + 0.08, 1.05, "frame", bev=0.02)
    m.box(x0 + 0.1, y - 0.08, z0 + 0.1, x1 - 0.1, y - 0.04, 0.95, "frame", bev=0.02)
    m.window(x0, x1, 1.05, 3.55, y=y, fw=0.09, rail=False, mull=True)
    m.box(x0, y - 0.07, 3.55, x1, y + 0.08, 3.7, "frame")
    m.window(x0, x1, 3.7, z1, y=y, fw=0.08, rail=False)
    for x in (x0 + (x1 - x0) / 3, x0 + 2 * (x1 - x0) / 3):
        m.box(x - 0.03, y - 0.04, 3.7, x + 0.03, y + 0.05, z1, "frame")
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
    L = BAY
    if corner:
        m.hsweep(PROF_BALC, [(0.0, P), (0.0, 0.0), (P, 0.0)], 0.0, "stone_trim")
        m.push(TR(0, -o, 0.4))
        m.balustrade_run(-o, P, post0=True, post1=False)
        m.pop()
        m.push(TR(0, P, 0) @ RZ(-90) @ TR(0, -o, 0.4))
        m.balustrade_run(0.0, P + o - 0.22, post0=False, post1=False)
        m.pop()
        arms = [Matrix.Identity(4), TR(0, P, 0) @ RZ(-90)]
        xs = [0.5]
    else:
        m.hsweep(PROF_BALC, [(0.0, 0.0), (L, 0.0)], 0.0, "stone_trim")
        m.push(TR(0, -o, 0.4))
        m.balustrade_run(0.0, L, post0=True)
        m.pop()
        arms = [Matrix.Identity(4)]
        xs = [0.65, 1.95]
    for A in arms:
        m.push(A @ TR(0, 0, -0.75))
        for x in xs:
            m.prism(console_poly(0.8, 0.75), x - 0.09, x + 0.09, "stone_trim", axis="x", bev=0.012)
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
    x0, x1, d = WIN[0] - 0.3, WIN[1] + 0.3, 0.62
    m.box(x0, -d, 0.0, x1, 0.2, 0.16, "stone_trim", bev=0.03)
    m.box(x0 + 0.04, -d + 0.04, -0.12, x1 - 0.04, 0.2, 0.0, "stone_trim", bev=0.03)
    for xa in (x0 + 0.1, x1 - 0.26):
        m.push(TR(0, 0, -0.72))
        m.prism(console_poly(0.6, 0.55), xa, xa + 0.16, "stone_trim", axis="x", bev=0.01)
        m.pop()
    m.push(TR(0, -d + 0.06, 0.16))
    m.balustrade_run(x0, x1, post0=True, post1=True, h=0.95, pw=0.28, spacing=0.26)
    m.pop()
    for xa, rot in ((x0 + 0.0, 90), (x1, 90)):
        m.push(TR(xa + (0.14 if xa == x0 else -0.14), 0.12, 0.16) @ RZ(rot))
        m.balustrade_run(0.0, d - 0.34, post0=False, post1=False, h=0.95, pw=0.28, spacing=0.26)
        m.pop()
    return m


def piece_awning():
    m = MB()
    x0, x1 = WIN[0] - 0.08, WIN[1] + 0.08
    zt, zb, d = WIN[3] + 0.12, WIN[3] - 0.75, 0.78
    m.prism([(0.0, zt), (d, zb), (d, zb - 0.02), (0.0, zt - 0.03)], x0, x1, "awning", axis="x")
    n = 10
    for i in range(n):
        a = x0 + (x1 - x0) * i / n
        b = x0 + (x1 - x0) * (i + 1) / n
        m.prism([(a, zb), (b, zb), (b, zb - 0.12), ((a + b) / 2, zb - 0.2), (a, zb - 0.12)],
                -d - 0.01, -d + 0.005, "awning")
    for x in (x0, x1 - 0.015):
        m.prism([(0.0, zt), (d, zb), (d, zb - 0.12), (0.0, zb + 0.3)], x, x + 0.015, "awning", axis="x")
    m.push(TR(0, 0, 0))
    m.box(x0 - 0.02, -0.06, zt - 0.02, x1 + 0.02, 0.02, zt + 0.06, "iron")
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


def piece_tempietto():
    m = MB()
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


def mat_stone(name, c_dark, c_light, rough=0.8, speckle=False):
    mat, nt, bsdf = _base(name)
    L = nt.links
    geo = _n(nt, "ShaderNodeNewGeometry", (-1400, 0))
    n1 = _n(nt, "ShaderNodeTexNoise", (-1100, 200), Scale=0.35, Detail=5.0, Roughness=0.6)
    L.new(geo.outputs["Position"], n1.inputs["Vector"])
    ramp = _ramp(nt, (-850, 200), c_dark, c_light, 0.35, 0.65)
    L.new(n1.outputs["Fac"], ramp.inputs["Fac"])
    mp = _n(nt, "ShaderNodeMapping", (-1100, -150))
    mp.inputs["Scale"].default_value = (2.5, 2.5, 0.12)
    L.new(geo.outputs["Position"], mp.inputs["Vector"])
    n2 = _n(nt, "ShaderNodeTexNoise", (-900, -150), Scale=1.6, Detail=3.0)
    L.new(mp.outputs["Vector"], n2.inputs["Vector"])
    sr = _ramp(nt, (-700, -150), (0.72, 0.7, 0.66), (1, 1, 1), 0.38, 0.62)
    L.new(n2.outputs["Fac"], sr.inputs["Fac"])
    mul = _n(nt, "ShaderNodeMixRGB", (-450, 150), blend_type="MULTIPLY", Fac=0.7)
    L.new(ramp.outputs["Color"], mul.inputs["Color1"])
    L.new(sr.outputs["Color"], mul.inputs["Color2"])
    col = mul
    if speckle:
        vor = _n(nt, "ShaderNodeTexVoronoi", (-900, -400), Scale=90.0)
        L.new(geo.outputs["Position"], vor.inputs["Vector"])
        vr = _ramp(nt, (-700, -400), (0.35, 0.35, 0.35), (1, 1, 1), 0.0, 0.25)
        L.new(vor.outputs["Distance"], vr.inputs["Fac"])
        m2 = _n(nt, "ShaderNodeMixRGB", (-300, 0), blend_type="MULTIPLY", Fac=0.5)
        L.new(col.outputs["Color"], m2.inputs["Color1"])
        L.new(vr.outputs["Color"], m2.inputs["Color2"])
        col = m2
    ao = _n(nt, "ShaderNodeAmbientOcclusion", (-450, -250), Distance=0.35)
    aor = _ramp(nt, (-250, -250), (0.5, 0.48, 0.45), (1, 1, 1), 0.0, 1.0)
    L.new(ao.outputs["AO"], aor.inputs["Fac"])
    m3 = _n(nt, "ShaderNodeMixRGB", (-100, 100), blend_type="MULTIPLY", Fac=1.0)
    L.new(col.outputs["Color"], m3.inputs["Color1"])
    L.new(aor.outputs["Color"], m3.inputs["Color2"])
    L.new(m3.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    n3 = _n(nt, "ShaderNodeTexNoise", (-700, -600), Scale=14.0, Detail=8.0, Roughness=0.7)
    L.new(geo.outputs["Position"], n3.inputs["Vector"])
    bump = _n(nt, "ShaderNodeBump", (-250, -600), Strength=0.25, Distance=0.01)
    L.new(n3.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    mat["export_color"] = [(a + b) / 2 for a, b in zip(c_dark, c_light)]
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
    MATS["stone"] = mat_stone("M_Limestone", (0.54, 0.51, 0.45), (0.74, 0.71, 0.63))
    MATS["stone_trim"] = mat_stone("M_Limestone_Trim", (0.60, 0.57, 0.50), (0.79, 0.76, 0.68), 0.75)
    MATS["granite"] = mat_stone("M_Granite", (0.28, 0.26, 0.25), (0.42, 0.39, 0.37), 0.6, speckle=True)

    mat, nt, bsdf = mat_simple("M_Glass", (0.012, 0.016, 0.02), 0.04)
    L = nt.links
    tc = _n(nt, "ShaderNodeTexCoord", (-1000, 0))
    oi = _n(nt, "ShaderNodeObjectInfo", (-1000, -300))
    sep = _n(nt, "ShaderNodeSeparateXYZ", (-800, 0))
    L.new(tc.outputs["Object"], sep.inputs["Vector"])
    # blind line = 3.1 - random*2.0 ; show blinds on ~55% of windows
    mr = _n(nt, "ShaderNodeMath", (-800, -300), operation="MULTIPLY_ADD")
    L.new(oi.outputs["Random"], mr.inputs[0])
    mr.inputs[1].default_value = -2.2
    mr.inputs[2].default_value = 3.3
    gt = _n(nt, "ShaderNodeMath", (-600, 0), operation="GREATER_THAN")
    L.new(sep.outputs["Z"], gt.inputs[0])
    L.new(mr.outputs[0], gt.inputs[1])
    r2 = _n(nt, "ShaderNodeMath", (-600, -300), operation="GREATER_THAN")
    L.new(oi.outputs["Random"], r2.inputs[0])
    r2.inputs[1].default_value = 0.68
    fac = _n(nt, "ShaderNodeMath", (-400, -100), operation="MULTIPLY")
    L.new(gt.outputs[0], fac.inputs[0])
    L.new(r2.outputs[0], fac.inputs[1])
    mix = _n(nt, "ShaderNodeMixRGB", (-200, 100), Color1=(0.012, 0.016, 0.02, 1), Color2=(0.46, 0.43, 0.36, 1))
    L.new(fac.outputs[0], mix.inputs["Fac"])
    L.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    rm = _n(nt, "ShaderNodeMapRange", (-200, -200))
    rm.inputs["To Min"].default_value = 0.04
    rm.inputs["To Max"].default_value = 0.85
    L.new(fac.outputs[0], rm.inputs["Value"])
    L.new(rm.outputs["Result"], bsdf.inputs["Roughness"])
    MATS["glass"] = mat

    MATS["frame"] = mat_simple("M_Frame_Paint", (0.03, 0.04, 0.035), 0.45)[0]
    MATS["iron"] = mat_simple("M_Iron", (0.05, 0.055, 0.05), 0.5, 0.6)[0]
    MATS["roof"] = mat_simple("M_Roof_Tar", (0.09, 0.09, 0.09), 0.9)[0]
    MATS["void"] = mat_simple("M_Interior_Void", (0.004, 0.004, 0.004), 1.0)[0]
    MATS["gilt"] = mat_simple("M_Gilt", (0.83, 0.62, 0.27), 0.28, 1.0)[0]

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
    s1.inputs[1].default_value = 2 * pi / 0.28
    s2 = _n(nt, "ShaderNodeMath", (-450, 0), operation="SINE")
    L.new(s1.outputs[0], s2.inputs[0])
    s3 = _n(nt, "ShaderNodeMath", (-300, 0), operation="GREATER_THAN")
    L.new(s2.outputs[0], s3.inputs[0])
    s3.inputs[1].default_value = 0.0
    stripe = _n(nt, "ShaderNodeMixRGB", (-150, 0), Color1=(0.78, 0.74, 0.64, 1), Color2=(0.5, 0.08, 0.06, 1))
    L.new(s3.outputs[0], stripe.inputs["Fac"])
    pick = _n(nt, "ShaderNodeMath", (-450, -300), operation="GREATER_THAN")
    L.new(oi.outputs["Random"], pick.inputs[0])
    pick.inputs[1].default_value = 0.55
    final = _n(nt, "ShaderNodeMixRGB", (0, 0), Color1=(0.8, 0.77, 0.68, 1))
    L.new(pick.outputs[0], final.inputs["Fac"])
    L.new(stripe.outputs["Color"], final.inputs["Color2"])
    L.new(final.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Subsurface Weight"].default_value = 0.0
    MATS["awning"] = mat


def mat_context():
    """Facade material with a procedural window grid for background buildings."""
    mat, nt, bsdf = _base("M_Context_Facade")
    L = nt.links
    geo = _n(nt, "ShaderNodeNewGeometry", (-1400, 0))
    sep = _n(nt, "ShaderNodeSeparateXYZ", (-1200, 0))
    L.new(geo.outputs["Position"], sep.inputs["Vector"])
    add = _n(nt, "ShaderNodeMath", (-1000, 100), operation="ADD")
    L.new(sep.outputs["X"], add.inputs[0])
    L.new(sep.outputs["Y"], add.inputs[1])

    def band(src, period, lo, hi, loc):
        dv = _n(nt, "ShaderNodeMath", loc, operation="DIVIDE")
        L.new(src, dv.inputs[0])
        dv.inputs[1].default_value = period
        fr = _n(nt, "ShaderNodeMath", (loc[0] + 150, loc[1]), operation="FRACT")
        L.new(dv.outputs[0], fr.inputs[0])
        a = _n(nt, "ShaderNodeMath", (loc[0] + 300, loc[1]), operation="GREATER_THAN")
        L.new(fr.outputs[0], a.inputs[0])
        a.inputs[1].default_value = lo
        b = _n(nt, "ShaderNodeMath", (loc[0] + 300, loc[1] - 150), operation="LESS_THAN")
        L.new(fr.outputs[0], b.inputs[0])
        b.inputs[1].default_value = hi
        m = _n(nt, "ShaderNodeMath", (loc[0] + 450, loc[1]), operation="MULTIPLY")
        L.new(a.outputs[0], m.inputs[0])
        L.new(b.outputs[0], m.inputs[1])
        return m.outputs[0]
    bx = band(add.outputs[0], 2.4, 0.28, 0.72, (-900, 100))
    bz = band(sep.outputs["Z"], 3.5, 0.3, 0.82, (-900, -300))
    win = _n(nt, "ShaderNodeMath", (-300, 0), operation="MULTIPLY")
    L.new(bx, win.inputs[0])
    L.new(bz, win.inputs[1])
    nrm = _n(nt, "ShaderNodeSeparateXYZ", (-600, -600))
    L.new(geo.outputs["Normal"], nrm.inputs["Vector"])
    up = _n(nt, "ShaderNodeMath", (-400, -600), operation="LESS_THAN")
    L.new(nrm.outputs["Z"], up.inputs[0])
    up.inputs[1].default_value = 0.5
    win2 = _n(nt, "ShaderNodeMath", (-150, -200), operation="MULTIPLY")
    L.new(win.outputs[0], win2.inputs[0])
    L.new(up.outputs[0], win2.inputs[1])
    oi = _n(nt, "ShaderNodeObjectInfo", (-600, 400))
    wall = _n(nt, "ShaderNodeMixRGB", (-300, 400), Color1=(0.15, 0.075, 0.055, 1), Color2=(0.33, 0.31, 0.28, 1))
    L.new(oi.outputs["Random"], wall.inputs["Fac"])
    mix = _n(nt, "ShaderNodeMixRGB", (0, 200), Color2=(0.02, 0.022, 0.025, 1))
    L.new(win2.outputs[0], mix.inputs["Fac"])
    L.new(wall.outputs["Color"], mix.inputs["Color1"])
    L.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    rr = _n(nt, "ShaderNodeMapRange", (0, -200))
    rr.inputs["To Min"].default_value = 0.85
    rr.inputs["To Max"].default_value = 0.1
    L.new(win2.outputs[0], rr.inputs["Value"])
    L.new(rr.outputs["Result"], bsdf.inputs["Roughness"])
    return mat


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
        ("SM_Wall_Attic", piece_wall_attic),
        ("SM_Pier_Corner_Ground", piece_pier_ground),
        ("SM_Pier_Corner_Rustic", lambda: pier(FL, 0.6, "stone", 0.06)),
        ("SM_Pier_Corner_Shaft", lambda: pier(FL, 0.45, "stone", 0.03)),
        ("SM_Pier_Corner_Attic", lambda: pier(2.8, 0.7, "stone", 0.03)),
        ("SM_Window_Shop", piece_window_shop),
        ("SM_Door_Entrance", piece_door_entrance),
        ("SM_Window_Sash", piece_window_sash),
        ("SM_Window_Arch_2F", piece_window_arch),
        ("SM_Window_Attic", piece_window_attic),
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
    ]
    for name, fn in pieces:
        finish(fn(), name, coll)


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------
class Assembler:
    def __init__(self, coll, root):
        self.coll, self.root, self.count = coll, root, 0

    def put(self, piece, M, tag=""):
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


def assemble(coll, root, seed=7):
    rnd = random.Random(seed)
    A = Assembler(coll, root)

    def ring(ox, oy, nx, ny, z, wall=None, pier=None, inserts=(), corner=None, straight=None,
             sz=1.0, skip=(), extra=None):
        for (fx, fy), rot, n, name in facades(ox, oy, nx, ny):
            F = TR(fx, fy, 0) @ RZ(rot)
            if pier:
                for dz in (pier[1] if isinstance(pier, tuple) else (0.0,)):
                    A.put(pier[0] if isinstance(pier, tuple) else pier, F @ TR(0, 0, z + dz))
            if corner:
                A.put(corner, F @ TR(0, 0, z))
            for i in range(n):
                if (name, i) in skip:
                    continue
                B = F @ TR(P + i * BAY, 0, z)
                if wall:
                    A.put(wall, B)
                if straight:
                    A.put(straight, B)
                for piece, dy, dz in inserts:
                    A.put(piece, B @ TR(0, dy, dz))
                if extra:
                    extra(name, i, n, B)

    ENT = ("E", 6)
    ox = oy = 0.0
    # ground floor + entrance
    ring(ox, oy, NX, NY, 0.0, "SM_Wall_Ground_Shop", "SM_Pier_Corner_Ground",
         [("SM_Window_Shop", 0, 0)], skip={ENT})
    F = TR(W, 0, 0) @ RZ(90) @ TR(P + ENT[1] * BAY, 0, 0)
    A.put("SM_Wall_Ground_Entrance", F)
    A.put("SM_Door_Entrance", F)
    ring(ox, oy, NX, NY, GF - 0.3, corner="SM_String_Course_Corner", straight="SM_String_Course", skip={ENT})
    z = GF
    for f in range(2):
        ring(ox, oy, NX, NY, z, "SM_Wall_Base_Rustic", "SM_Pier_Corner_Rustic", [("SM_Window_Sash", 0, 0)],
             skip={ENT} if f == 0 else ())
        z += FL
    ring(ox, oy, NX, NY, z - 0.35, corner="SM_Cornice_Base_Corner", straight="SM_Cornice_Base")

    def awnings(name, i, n, B):
        if rnd.random() < 0.3:
            A.put("SM_Awning", B)

    ring(ox, oy, NX, NY, z, "SM_Wall_Win_Hood", "SM_Pier_Corner_Shaft", [("SM_Window_Sash", 0, 0)])
    z += FL
    ring(ox, oy, NX, NY, z - 0.12, corner="SM_String_Course_Corner", straight="SM_String_Course")
    for f in range(8):
        def extra(name, i, n, B, f=f):
            if f in (3, 6) and (name in "SN" or i in (0, n - 1)):
                A.put("SM_Balconette", B @ TR(0, 0, WIN[2] - 0.16))
            elif f not in (3, 6):
                awnings(name, i, n, B)
        ring(ox, oy, NX, NY, z, "SM_Wall_Win_Shaft", "SM_Pier_Corner_Shaft", [("SM_Window_Sash", 0, 0)],
             extra=extra)
        z += FL
    # two-storey arcade with continuous balcony
    ring(ox, oy, NX, NY, z, "SM_Wall_Arch_2F", ("SM_Pier_Corner_Shaft", (0.0, FL)), [("SM_Window_Arch_2F", 0, 0)])
    ring(ox, oy, NX, NY, z + 0.42, corner="SM_Balcony_Corner", straight="SM_Balcony")
    z += 2 * FL
    ring(ox, oy, NX, NY, z, "SM_Wall_Win_Shaft", "SM_Pier_Corner_Shaft", [("SM_Window_Sash", 0, 0)],
         extra=awnings)
    z += FL
    ring(ox, oy, NX, NY, z - 0.2, corner="SM_Cornice_Mid_Corner", straight="SM_Cornice_Mid")
    ctop = z - 0.2 + 0.86
    # colonnade
    def cols(name, i, n, B, z0=ctop, h=z + 2 * FL - ctop):
        if i > 0:
            A.put("SM_Column_2F", B @ TR(0, 0.02, z0 - B.translation.z) @ Matrix.Diagonal((1, 1, h / COL_H, 1)))
    ring(ox, oy, NX, NY, z, "SM_Wall_Colonnade_2F", ("SM_Pier_Corner_Rustic", (0.0, FL)),
         [("SM_Window_Sash", 0.25, 0.0), ("SM_Window_Sash", 0.25, FL)], extra=cols)
    z += 2 * FL
    ring(ox, oy, NX, NY, z, "SM_Wall_Attic", "SM_Pier_Corner_Attic", [("SM_Window_Attic", 0, 0)])
    z += 2.8
    ring(ox, oy, NX, NY, z - 0.5, corner="SM_Cornice_Main_Corner", straight="SM_Cornice_Main")
    roof = z - 0.5 + 1.54
    A.put("SM_Roof_Slab", TR(0.05, 0.05, z - 1.0) @ Matrix.Diagonal((W - 0.1, D - 0.1, roof - z + 1.0, 1)))
    ring(ox, oy, NX, NY, roof, corner="SM_Balustrade_Corner", straight="SM_Balustrade")
    for (fx, fy), rot, n, name in facades(ox, oy, NX, NY):
        A.put("SM_Urn", TR(fx, fy, roof + 1.11) @ RZ(rot))

    # ---------------- tower ----------------
    TN = 2
    TW = 2 * P + TN * BAY
    tx, ty = (W - TW) / 2, 1.6
    z = roof
    A.put("SM_Roof_Slab", TR(tx + 0.05, ty + 0.05, z - 0.5) @ Matrix.Diagonal((TW - 0.1, TW - 0.1, 0.5, 1)))
    ring(tx, ty, TN, TN, z, "SM_Wall_Win_Shaft", "SM_Pier_Corner_Shaft", [("SM_Window_Sash", 0, 0)])
    z += FL
    ring(tx, ty, TN, TN, z - 0.12, corner="SM_String_Course_Corner", straight="SM_String_Course")

    def tcols(name, i, n, B, z0=z + 0.22, h=2 * FL - 0.22):
        if i > 0:
            A.put("SM_Column_2F", B @ TR(0, -0.3, z0 - B.translation.z) @ Matrix.Diagonal((1, 1, h / COL_H, 1)))
    ring(tx, ty, TN, TN, z, "SM_Wall_Arch_2F", ("SM_Pier_Corner_Shaft", (0.0, FL)),
         [("SM_Window_Arch_2F", 0, 0)], extra=tcols)
    z += 2 * FL
    ring(tx, ty, TN, TN, z - 0.5, corner="SM_Cornice_Main_Corner", straight="SM_Cornice_Main")
    ttop = z - 0.5 + 1.54
    A.put("SM_Roof_Slab", TR(tx + 0.05, ty + 0.05, z - 1.0) @ Matrix.Diagonal((TW - 0.1, TW - 0.1, ttop - z + 1.0, 1)))
    ring(tx, ty, TN, TN, ttop, corner="SM_Balustrade_Corner", straight="SM_Balustrade")
    for (fx, fy), rot, n, name in facades(tx, ty, TN, TN):
        A.put("SM_Urn", TR(fx, fy, ttop + 1.11) @ RZ(rot))
    c = (tx + TW / 2, ty + TW / 2)
    A.put("SM_Tempietto", TR(c[0], c[1], ttop))
    A.put("SM_Dome", TR(c[0], c[1], ttop + 7.42))
    dome_top = ttop + 7.42 + 0.18 + 3.1 * sin(math.acos(0.58 / 2.2))
    A.put("SM_Lantern", TR(c[0], c[1], dome_top - 0.05))
    return A.count, dome_top + 4.75


# --------------------------------------------------------------------------
# Scene: context, lights, cameras, render
# --------------------------------------------------------------------------
def add_box_obj(name, x0, y0, z0, x1, y1, z1, mat, coll):
    mb = MB()
    mb.box(x0, y0, z0, x1, y1, z1, "roof")
    bm = mb.bm
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.material_index = 0
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def build_context(coll):
    asphalt = mat_simple("M_Asphalt", (0.045, 0.045, 0.047), 0.7)[0]
    walk = mat_stone("M_Sidewalk", (0.3, 0.3, 0.29), (0.42, 0.41, 0.4), 0.85)
    ctx = mat_context()
    add_box_obj("Ground_Street", -20000, -20000, -0.3, 20000, 20000, 0.0, asphalt, coll)
    add_box_obj("Sidewalk_S", -60, -5.0, 0.0, W + 5.0, 0.0, 0.16, walk, coll)
    add_box_obj("Sidewalk_E", W, -5.0, 0.0, W + 5.0, 90, 0.16, walk, coll)
    add_box_obj("Sidewalk_Opp_S", -60, -30, 0.0, W + 5.0, -19, 0.16, walk, coll)
    add_box_obj("Sidewalk_Opp_E", W + 19, -30, 0.0, W + 30, 90, 0.16, walk, coll)
    blocks = [(-22, 0.0, -0.3, D * 0.9, 22), (-46, -2, -22.5, 26, 30), (0.0, D + 0.3, W, D + 18, 19),
              (-34, 36, -12, 62, 70), (W + 21, 46, W + 42, 76, 34), (-4, 58, 20, 80, 56)]
    for i, (x0, y0, x1, y1, h) in enumerate(blocks):
        add_box_obj(f"Context_Block_{i}", x0, y0, 0.0, x1, y1, h, ctx, coll)
        add_box_obj(f"Context_Cornice_{i}", x0 - 0.5, y0 - 0.5, h - 0.2, x1 + 0.5, y1 + 0.5, h + 0.6, walk, coll)


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
        sky.sun_elevation = radians(38)
        sky.sun_rotation = radians(215)
        sky.air_density = 1.2
        sky.dust_density = 2.5
        nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 0.17
    else:
        bg.inputs["Color"].default_value = (0.045, 0.047, 0.05, 1)
        bg.inputs["Strength"].default_value = 1.0


def add_sun(coll):
    sd = bpy.data.lights.new("Sun", "SUN")
    sd.energy = 5.0
    sd.angle = radians(1.5)
    sd.color = (1.0, 0.95, 0.88)
    sun = bpy.data.objects.new("Sun", sd)
    coll.objects.link(sun)
    d = Vector((0.55, 0.8, -0.62)).normalized()
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

    build_kit(c_kit)
    root = bpy.data.objects.new("Gillender_Root", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 5
    c_bld.objects.link(root)
    count, top = assemble(c_bld, root)
    print(f"[gillender] kit pieces: {len(KIT)}  instances: {count}  height: {top:.1f} m")

    build_context(c_ctx)
    add_sun(c_rig)
    hero = add_camera("CAM_Hero", (W + 56, -50, 32), (W * 0.5, D * 0.3, 46.5), 30, c_rig)
    add_camera("CAM_Detail_Mid", (W + 17.6, -18, 52), (W, 0, 54), 40, c_rig)
    add_camera("CAM_Detail_Top", (W / 2 + 19, -17, 87), (W / 2, 5.2, 83.5), 40, c_rig)
    scene.camera = hero

    # kit sheet column layout to the left of the building (used by the breakdown shot)
    kit_objs = list(c_kit.objects)
    layout_kit(kit_objs, 2.0, 34.0)

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
            ob.hide_render = ob.name == "Reference_Photo"

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
    cy.max_bounces = 6
    scene.render.resolution_percentage = args.scale
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    only = set(args.only.split(",")) if args.only else {"hero", "detail", "breakdown", "kit"}

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

    if "hero" in only or "detail" in only:
        setup_world("sky")
        show(False, True, True, False)
        if "hero" in only:
            shot(bpy.data.objects["CAM_Hero"], (1200, 1600), "render_hero.png")
        if "detail" in only:
            shot(bpy.data.objects["CAM_Detail_Mid"], (1200, 1200), "render_detail_mid.png")
            shot(bpy.data.objects["CAM_Detail_Top"], (1200, 1200), "render_detail_top.png")

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
