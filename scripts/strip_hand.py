"""Strip checkerboard from hand assets while keeping white shirt cuff."""
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]


def is_skin(r: int, g: int, b: int) -> bool:
    return r >= 170 and g >= 110 and b >= 80 and r >= g >= b - 15 and (r - b) >= 25


def is_dark(r: int, g: int, b: int) -> bool:
    return max(r, g, b) <= 70


def is_metal(r: int, g: int, b: int) -> bool:
    mx, mn = max(r, g, b), min(r, g, b)
    return mx - mn <= 25 and 90 <= mx <= 210


def is_light_backdrop(r: int, g: int, b: int, a: int) -> bool:
    if a < 8:
        return True
    mx, mn = max(r, g, b), min(r, g, b)
    return mx - mn <= 32 and mx >= 175


def strip_hand(path: Path) -> None:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()

    # 1) subject core: skin / dark sleeve-handle / metal blade
    subject = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            if is_skin(r, g, b) or is_dark(r, g, b) or is_metal(r, g, b):
                subject[y][x] = True

    # 2) dilate subject so white cuff near wrist is protected
    protect = [row[:] for row in subject]
    radius = 28
    for y in range(h):
        for x in range(w):
            if not subject[y][x]:
                continue
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    if dx * dx + dy * dy > radius * radius:
                        continue
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        protect[ny][nx] = True

    # white shirt pixels inside protect zone stay
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            if protect[y][x] and mx - mn <= 20 and mx >= 200:
                subject[y][x] = True  # keep shirt

    # 3) flood-fill backdrop from edges, never into subject/protect-shirt
    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        r, g, b, a = px[x, y]
        if subject[y][x]:
            return
        if is_light_backdrop(r, g, b, a):
            visited[y][x] = True
            q.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    removed = 0
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        removed += 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= w or ny >= h or visited[ny][nx]:
                continue
            if subject[ny][nx]:
                continue
            r, g, b, a = px[nx, ny]
            if is_light_backdrop(r, g, b, a):
                visited[ny][nx] = True
                q.append((nx, ny))

    # light fringe cleanup only outside shirt protect
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0 or subject[y][x]:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            if mx - mn <= 40 and mx >= 200:
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                        px[x, y] = (0, 0, 0, 0)
                        removed += 1
                        break

    im.save(path)
    print(f"{path.name}: removed {removed}, kept shirt protected")


def main() -> None:
    for name in ("오른손_칼.png", "오른손.png"):
        path = ROOT / "src/assets/도구" / name
        if path.exists():
            strip_hand(path)


if __name__ == "__main__":
    main()
