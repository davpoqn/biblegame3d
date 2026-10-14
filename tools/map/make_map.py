# 게임 지도 자료: Natural Earth(퍼블릭 도메인)의 땅·호수·강에서 로마~하란~애굽 영역만 잘라 줄인다 → src/mapdata.json
# 자료 받기(처음 한 번):
#   git clone --depth 1 --filter=blob:none --no-checkout https://github.com/nvkelso/natural-earth-vector /opt/ne
#   cd /opt/ne && git sparse-checkout init --no-cone && git sparse-checkout set geojson/ne_50m_land.geojson geojson/ne_10m_lakes.geojson geojson/ne_10m_rivers_lake_centerlines.geojson && git checkout
# python3 tools/map/make_map.py [/opt/ne/geojson]
import json, sys, pathlib

NE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/opt/ne/geojson')
OUT = pathlib.Path(__file__).resolve().parents[2] / 'src/mapdata.json'
BOX = (3.0, 23.0, 51.0, 47.5)  # 경도·위도 (로마 서쪽 ~ 우르 동쪽, 애굽 남쪽 ~ 마게도냐 북쪽, 화면 비율 때문에 넉넉히)


def clip(poly, box):
    """사각형으로 다각형 자르기 (Sutherland–Hodgman)"""
    x0, y0, x1, y1 = box
    edges = [(lambda p: p[0] >= x0, lambda a, b: (x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0]))),
             (lambda p: p[0] <= x1, lambda a, b: (x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0]))),
             (lambda p: p[1] >= y0, lambda a, b: (a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0)),
             (lambda p: p[1] <= y1, lambda a, b: (a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1))]
    out = poly
    for inside, cross in edges:
        if not out: break
        src, out = out, []
        for i, cur in enumerate(src):
            prev = src[i - 1]
            if inside(cur):
                if not inside(prev): out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev): out.append(cross(prev, cur))
    return out


def simplify(pts, tol):
    """Douglas–Peucker"""
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]; L = (dx * dx + dy * dy) ** .5 or 1e-9
    i, dmax = 0, -1
    for k in range(1, len(pts) - 1):
        p = pts[k]; d = abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / L
        if d > dmax: i, dmax = k, d
    if dmax <= tol: return [a, b]
    return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol)


def simplify_ring(pts, tol):
    """닫힌 고리는 시작점에서 가장 먼 점에서 둘로 나눠 줄인다 (시작=끝이면 거리가 0이 되어 다 지워지므로)"""
    k = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    return simplify(pts[:k + 1], tol)[:-1] + simplify(pts[k:], tol)


def rings(geom):
    if geom['type'] == 'Polygon': return [geom['coordinates'][0]]
    if geom['type'] == 'MultiPolygon': return [p[0] for p in geom['coordinates']]
    return []


def lines(geom):
    if geom['type'] == 'LineString': return [geom['coordinates']]
    if geom['type'] == 'MultiLineString': return geom['coordinates']
    return []


def inbox(pts, box, pad=0):
    return any(box[0] - pad <= x <= box[2] + pad and box[1] - pad <= y <= box[3] + pad for x, y in pts)


flat = lambda pts: [round(v, 3) for p in pts for v in p]
data = {'box': BOX, 'land': [], 'lakes': [], 'rivers': []}
for f in json.load(open(NE / 'ne_50m_land.geojson'))['features']:
    for r in rings(f['geometry']):
        if not inbox(r, BOX, 2): continue
        c = clip([tuple(p) for p in r], BOX)
        if len(c) < 3: continue
        s = simplify_ring(c + [c[0]], .025)
        if len(s) >= 4: data['land'].append(flat(s))
for f in json.load(open(NE / 'ne_10m_lakes.geojson'))['features']:
    if f['properties'].get('name') not in ('Sea of Galilee', 'Dead Sea'): continue
    for r in rings(f['geometry']): data['lakes'].append(flat(simplify_ring([tuple(p) for p in r], .004)))
for f in json.load(open(NE / 'ne_10m_rivers_lake_centerlines.geojson'))['features']:
    n = f['properties'].get('name')
    if n not in ('Jordan', 'Nile', 'Euphrates', 'Tigris'): continue
    for ln in lines(f['geometry']):
        if not inbox(ln, BOX): continue
        data['rivers'].append({'n': n, 'p': flat(simplify([tuple(p) for p in ln], .004 if n == 'Jordan' else .03))})
OUT.write_text(json.dumps(data, separators=(',', ':')))
print(OUT, OUT.stat().st_size, 'bytes', {k: len(v) for k, v in data.items() if k != 'box'}, 'points', sum(len(r) // 2 for r in data['land']))
