from pydantic import BaseModel


def dump(model: BaseModel) -> dict:
    """Serialize to the frontend's exact JSON: camelCase aliases, null fields omitted."""
    return model.model_dump(by_alias=True, exclude_none=True)
