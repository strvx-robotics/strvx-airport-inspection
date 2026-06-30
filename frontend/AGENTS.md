<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Map policy (hard rule)

**Do not add unapproved map overlays.** Issue pins, runway polygons, inferred
geometry, and ad-hoc markers on `/map` or `/runway/[id]` are forbidden.

**Approved map polygons only:**
- **Keep-out zones** (red) — inspector-plotted
- **Inspection zones** (blue) — admin-plotted, tied to a runway

Runway threshold anchors may center the camera only. See `frontend/docs.md` § Map
policy before touching anything under `components/map/`.
