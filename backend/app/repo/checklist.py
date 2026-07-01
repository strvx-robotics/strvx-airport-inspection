from app import db
from app.deps import Actor
from app.errors import AppError
from app.models import ChecklistResponse
from app.repo.helpers import actor_name, actor_role, gid, now
from app.repo import images as images_repo

# Standard daily self-inspection items (PRD §6). Fixed for P0 so every airport
# gets a consistent Part 139-style list; per-airport custom templates are P1
# (#10). Keys are STABLE — they are persisted in checklist_responses.item_key.
STANDARD_CHECKLIST_ITEMS = [
    {"key": "pavement_surface", "label": "Pavement surface — cracks, spalling, joints", "category": "pavement"},
    {"key": "pavement_edges", "label": "Pavement edges, shoulders & blast pads", "category": "pavement"},
    {"key": "fod", "label": "FOD / debris on the surface", "category": "fod"},
    {"key": "markings", "label": "Zone markings legible & unobscured", "category": "marking"},
    {"key": "lighting", "label": "Zone / edge lighting & signage operational", "category": "lighting"},
    {"key": "drainage", "label": "Drainage / standing water", "category": "pavement"},
    {"key": "safety_areas", "label": "Zone safety areas clear", "category": "fod"},
    {"key": "obstructions", "label": "Obstructions / construction / unserviceable areas", "category": "fod"},
]
VALID_ITEM_KEYS = {i["key"] for i in STANDARD_CHECKLIST_ITEMS}
VALID_RESULTS = {"pass", "fail", "na"}


def _to_response(r) -> ChecklistResponse:
    return ChecklistResponse(
        id=r["id"], inspection_id=r["inspection_id"], item_key=r["item_key"],
        result=r["result"], notes=r["notes"], image_id=r["image_id"],
        created_by=r["created_by"], actor_role=r["actor_role"],
        updated_at=r["updated_at"], created_at=r["created_at"],
    )


async def list_responses(inspection_id: str) -> list[ChecklistResponse]:
    rows = await db.all(
        "SELECT * FROM checklist_responses WHERE inspection_id = $1", inspection_id)
    return [_to_response(r) for r in rows]


async def get_checklist(inspection_id: str) -> list[dict]:
    """The standard item set merged with any stored response for this inspection
    (camelCase, ready to serialize — result is null until the inspector sets it)."""
    by_key = {r.item_key: r for r in await list_responses(inspection_id)}
    out: list[dict] = []
    for item in STANDARD_CHECKLIST_ITEMS:
        r = by_key.get(item["key"])
        out.append({
            "itemKey": item["key"],
            "label": item["label"],
            "category": item["category"],
            "result": r.result if r else None,
            "notes": r.notes if r else "",
            "imageId": r.image_id if r else None,
            "updatedAt": r.updated_at if r else None,
        })
    return out


async def save_response(
    inspection_id: str, item_key: str, result: str,
    notes: str | None, image_id: str | None, actor: Actor | None,
) -> ChecklistResponse:
    if item_key not in VALID_ITEM_KEYS:
        raise AppError(f"Unknown checklist item: {item_key}")
    if result not in VALID_RESULTS:
        raise AppError("result must be one of: pass, fail, na")
    insp = await db.one("SELECT id FROM inspections WHERE id = $1", inspection_id)
    if insp is None:
        raise AppError(f"Inspection not found: {inspection_id}")
    if image_id and not await images_repo.belongs_to_inspection(image_id, inspection_id):
        raise AppError("imageId must reference evidence from this inspection")
    ts = now()
    await db.run(
        "INSERT INTO checklist_responses "
        "(id, inspection_id, item_key, result, notes, image_id, created_by, actor_role, updated_at, created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) "
        "ON CONFLICT (inspection_id, item_key) DO UPDATE SET "
        "result = EXCLUDED.result, notes = EXCLUDED.notes, image_id = EXCLUDED.image_id, "
        "created_by = EXCLUDED.created_by, actor_role = EXCLUDED.actor_role, updated_at = EXCLUDED.updated_at",
        gid("clr"), inspection_id, item_key, result, notes or "", image_id,
        await actor_name(actor), actor_role(actor), ts,
    )
    r = await db.one(
        "SELECT * FROM checklist_responses WHERE inspection_id = $1 AND item_key = $2",
        inspection_id, item_key,
    )
    return _to_response(r)
