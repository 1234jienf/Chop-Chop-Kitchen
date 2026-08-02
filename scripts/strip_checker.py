"""Remove checkerboard / light gray-white backdrop via edge flood-fill."""
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def is_backdrop(r: int, g: int, b: int, a: int) -> bool:
    if a < 8:
        return True
    mx, mn = max(r, g, b), min(r, g, b)
    sat = mx - mn
    # checker / near-white / light gray
    if sat <= 35 and mx >= 175:
        return True
    if r >= 245 and g >= 245 and b >= 245:
        return True
    return False


def strip_file(path: Path) -> None:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def try_seed(x: int, y: int) -> None:
        r, g, b, a = px[x, y]
        if is_backdrop(r, g, b, a):
            q.append((x, y))
            visited[y][x] = True

    for x in range(w):
        try_seed(x, 0)
        try_seed(x, h - 1)
    for y in range(h):
        try_seed(0, y)
        try_seed(w - 1, y)

    removed = 0
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        removed += 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= w or ny >= h or visited[ny][nx]:
                continue
            r, g, b, a = px[nx, ny]
            if is_backdrop(r, g, b, a):
                visited[ny][nx] = True
                q.append((nx, ny))

    im.save(path)
    print(f"{path.relative_to(ROOT)}: removed {removed}")


def main() -> None:
    targets = [
        ROOT / "src/assets/재료/토마토.png",
        ROOT / "src/assets/재료/토마토_단면.png",
        ROOT / "src/assets/도구/오른손_칼.png",
        ROOT / "src/assets/도구/오른손.png",
    ]
    # also common cutting ingredients
    for p in (ROOT / "src/assets/재료").glob("*.png"):
        if p not in targets:
            targets.append(p)

    for path in targets:
        if path.exists():
            strip_file(path)


if __name__ == "__main__":
    main()
