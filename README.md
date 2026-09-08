# CircleCam

> Circular webcam overlay for Linux

```bash
npm install
```

```bash
node circlecam.js
```

## Fields

Settings are in `config.json` next to `circlecam.js`.

- `camera` — `auto`, V4L2 device (`/dev/video0`), index (`0`, `1`, …),
  or name substring (default: `auto`)
- `position` — `top-right`, `top-left`, `bottom-right`,
  `bottom-left`, `center` (default: `top-right`)
- `shape` — `circle` or `rectangle` (default: `circle`)
- `width` — window width in pixels (default: `430`)
- `height` — window height in pixels (default: `430`)
- `radius` — rectangle corner radius in pixels; `0` is a strict
  rectangle. Unused for `circle` (default: `0`)
- `margin` — screen-border margin in pixels (default: `15`)
- `monitor` — monitor index; primary is `0` (default: `0`)
- `minFps` — prefer max resolution at >= this FPS (default: `30`)
- `mirror` — `true` to flip the preview (default: `false`)
- `nativeWayland` — `true` to skip the XWayland workaround
  (default: `false`)

```json
{
  "camera": "Logitech",
  "position": "bottom-right",
  "shape": "rectangle",
  "width": 320,
  "height": 240,
  "radius": 24,
  "margin": 15,
  "monitor": 1,
  "minFps": 30,
  "mirror": false,
  "nativeWayland": false
}
```

On Linux Wayland, native Electron cannot reliably position the window
or keep it always-on-top, so CircleCam uses XWayland/X11 when
`DISPLAY` is set. Set `nativeWayland` to `true` to skip that.

Hardware GL often crashes on Linux XWayland. Turning GL off entirely
uses a software bitmap presenter that cannot paint transparency, so the
overlay would stay invisible. CircleCam uses SwiftShader (ANGLE)
instead.

Linux waits briefly after Electron is ready so the first transparent
frameless window gets an ARGB visual.

The overlay stays on top. Drag anywhere on the window. Close with Alt+F4
or Escape.

## License

Copyright (c) 2026 Timur Shemsedinov.
This is [MIT](./LICENSE) licensed software.
