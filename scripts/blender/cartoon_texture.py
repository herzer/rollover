"""The cartoon Minka's coat (2026-10-02): her real markings, from the Minka v2 bake (art/minka/v2/minka-color.png, in the
toon mesh's UV layout), turned painterly — edge-preserving smoothing melts the photo grain into soft color and keeps the stripes — then warmed,
lightened and given a little more color. Writes art/minka/toon/minka-cartoon-color.png for build_minka_cartoon.py.
   blender -b --python scripts/blender/cartoon_texture.py"""
import bpy, os
import numpy as np
P = lambda *a: os.path.join(os.path.abspath('.'), *a)
OUT = P('art/minka/toon')
src = bpy.data.images.load(P('art/minka/v2/minka-color.png'))
src.scale(2048, 1024)
px = np.empty(2048 * 1024 * 4, np.float32); src.pixels.foreach_get(px)
A_ = px.reshape(1024, 2048, 4)[..., :3].copy()          # Blender keeps rows bottom-up; the filter does not care
def kuwahara(img, r):
    """Each pixel takes the mean of the calmest of its four (r+1)² corner windows: flat painted areas, crisp edges."""
    H_, W_ = img.shape[:2]
    lum = img @ np.array([0.299, 0.587, 0.114], np.float32)
    pad = lambda a: np.pad(a, ((r, r), (r, r)) + ((0, 0),) * (a.ndim - 2), mode='edge')
    I = pad(img); Lm = pad(lum)
    def box(a):
        c = np.cumsum(np.cumsum(np.pad(a, ((1, 0), (1, 0)) + ((0, 0),) * (a.ndim - 2)), 0), 1)
        k = r + 1
        return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
    m, mm, mi = box(I), box(Lm), box(Lm * Lm)
    var = mi - mm * mm
    best = np.full((H_, W_), np.inf, np.float32); out = np.zeros_like(img)
    for dy in (0, r):
        for dx in (0, r):
            v = var[dy:dy + H_, dx:dx + W_]; mu = m[dy:dy + H_, dx:dx + W_]
            sel = v < best; best[sel] = v[sel]; out[sel] = mu[sel]
    return out
def diffuse(img, iters=40, K=0.07, lam=0.2):
    """Edge-preserving smoothing (Perona–Malik): flat areas melt into soft painted color, stripe edges stay."""
    I = img.copy()
    for _ in range(iters):
        acc = np.zeros_like(I)
        for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
            d = np.roll(I, sh, ax) - I
            g = np.exp(-(np.abs(d).sum(-1, keepdims=True) / K) ** 2)
            acc += g * d
        I += lam * acc
    return I
C = diffuse(A_)
# a warmer, lighter, cleaner coat: lift the shadows, a little more color
lum = C @ np.array([0.299, 0.587, 0.114], np.float32)
C = lum[..., None] + (C - lum[..., None]) * 1.18
C = np.clip(C, 0, 1) ** 0.86
C = np.clip(C * np.array([1.03, 1.0, 0.95], np.float32), 0, 1)
out = bpy.data.images.new('minka-cartoon-color', 2048, 1024, alpha=False)
o4 = np.ones((1024, 2048, 4), np.float32); o4[..., :3] = C
out.pixels.foreach_set(o4.ravel())
out.filepath_raw = os.path.join(OUT, 'minka-cartoon-color.png'); out.file_format = 'PNG'; out.save()
print('WROTE minka-cartoon-color.png')
