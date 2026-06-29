from app.repo.runways import get_runway
from app.repo.issues import ISSUE_SELECT, _to_issue
from app import db


async def list_issues_by_runway(runway_id: str, inspection_id: str | None = None) -> list:
    if inspection_id:
        rows = await db.all(
            f"{ISSUE_SELECT} WHERE ic.runway_id = $1 AND ic.inspection_id = $2 ORDER BY ic.confidence DESC",
            runway_id, inspection_id)
    else:
        rows = await db.all(
            f"{ISSUE_SELECT} WHERE ic.runway_id = $1 ORDER BY ic.confidence DESC", runway_id)
    return [_to_issue(r) for r in rows]


async def get_runway_with_issues(runway_id: str, inspection_id: str | None = None) -> dict | None:
    runway = await get_runway(runway_id)
    if runway is None:
        return None
    return {"runway": runway, "issues": await list_issues_by_runway(runway_id, inspection_id)}
