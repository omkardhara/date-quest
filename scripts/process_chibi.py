import sys, numpy as np
from PIL import Image
from collections import deque

src = sys.argv[1]
img = Image.open(src).convert("RGBA")
a = np.array(img)
h, w = a.shape[:2]
bright = a[:, :, :3].max(axis=2)        # brightness per pixel
THRESH = 30                              # pure-black background only
bg = np.zeros((h, w), bool)
visited = np.zeros((h, w), bool)
dq = deque()
for x in range(w):
    for y in (0, h - 1):
        dq.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        dq.append((y, x))
while dq:
    y, x = dq.popleft()
    if y < 0 or y >= h or x < 0 or x >= w or visited[y, x]:
        continue
    visited[y, x] = True
    if bright[y, x] <= THRESH:
        bg[y, x] = True
        dq.extend([(y+1,x),(y-1,x),(y,x+1),(y,x-1)])
a[bg, 3] = 0
# feather edge a touch
out = Image.fromarray(a)
out.save(sys.argv[2])
print("saved", sys.argv[2], "transparent px:", int(bg.sum()))
